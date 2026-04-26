from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

try:
    import redis
except Exception:  # pragma: no cover - optional dependency in non-runtime environments
    redis = None

from ..core.celery_app import celery_app
from ..core.config import get_settings
from ..models.base import utcnow
from ..schemas.task_monitor import (
    TaskMonitorBucketItem,
    TaskMonitorOverviewResponse,
    TaskMonitorQueueItem,
    TaskMonitorTaskItem,
    TaskMonitorWorkerItem,
)

STATE_LABELS = {
    "PENDING": "待执行",
    "RECEIVED": "已接收",
    "STARTED": "执行中",
    "SCHEDULED": "定时中",
    "RETRY": "重试中",
    "SUCCESS": "成功",
    "FAILURE": "失败",
    "REVOKED": "已撤销",
}

STATE_PRIORITY = {
    "STARTED": 0,
    "RECEIVED": 1,
    "SCHEDULED": 2,
    "RETRY": 3,
    "FAILURE": 4,
    "SUCCESS": 5,
    "REVOKED": 6,
    "PENDING": 7,
}


def build_task_monitor_overview(*, task_limit: int, history_limit: int) -> TaskMonitorOverviewResponse:
    settings = get_settings()
    now = utcnow()
    overview = TaskMonitorOverviewResponse(
        generated_at=now,
        broker_url=_mask_url(settings.resolved_celery_broker_url),
        result_backend=_mask_url(settings.resolved_celery_result_backend),
    )

    inspector = celery_app.control.inspect(timeout=1.0)
    stats = _safe_inspect_call(inspector.stats)
    active = _safe_inspect_call(inspector.active)
    reserved = _safe_inspect_call(inspector.reserved)
    scheduled = _safe_inspect_call(inspector.scheduled)
    active_queues = _safe_inspect_call(inspector.active_queues)
    ping = _safe_inspect_call(inspector.ping)

    worker_names = sorted(set(stats) | set(active) | set(reserved) | set(scheduled) | set(active_queues) | set(ping))
    overview.workers = [
        _build_worker_item(
            worker,
            stats=stats.get(worker) or {},
            active_tasks=active.get(worker) or [],
            reserved_tasks=reserved.get(worker) or [],
            scheduled_tasks=scheduled.get(worker) or [],
            queues=active_queues.get(worker) or [],
            online=worker in ping if ping else True,
        )
        for worker in worker_names
    ]
    overview.workers_online = sum(1 for item in overview.workers if item.online)
    overview.worker_concurrency_total = sum(item.max_concurrency for item in overview.workers)

    runtime_tasks = [
        *_build_task_items(active, state="STARTED", now=now),
        *_build_task_items(reserved, state="RECEIVED", now=now),
        *_build_task_items(scheduled, state="SCHEDULED", now=now),
    ]
    runtime_tasks_by_id = {item.task_id: item for item in runtime_tasks if item.task_id}

    history_tasks = _load_history_task_items(settings.resolved_celery_result_backend, limit=history_limit)
    for item in history_tasks:
        if not item.task_id or item.task_id in runtime_tasks_by_id:
            continue
        runtime_tasks_by_id[item.task_id] = item

    all_tasks = sorted(
        runtime_tasks_by_id.values(),
        key=lambda item: (
            STATE_PRIORITY.get(item.state, 99),
            -_task_sort_timestamp(item).timestamp(),
            item.task_id,
        ),
    )
    overview.tasks = all_tasks[:task_limit]
    overview.task_state_buckets = _build_state_buckets(runtime_tasks_by_id.values())

    queue_names = _collect_queue_names(active_queues, runtime_tasks_by_id.values())
    queue_pending_counts = _load_queue_pending_counts(settings.resolved_celery_broker_url, queue_names)
    overview.queues = _build_queue_items(
        active_queues=active_queues,
        tasks=runtime_tasks_by_id.values(),
        pending_counts=queue_pending_counts,
    )
    overview.queue_pending_total = sum(item.pending_count for item in overview.queues)

    return overview


def _safe_inspect_call(call):
    try:
        result = call()
    except Exception:
        return {}
    if not isinstance(result, dict):
        return {}
    return result


def _build_worker_item(
    worker: str,
    *,
    stats: dict,
    active_tasks: list[dict],
    reserved_tasks: list[dict],
    scheduled_tasks: list[dict],
    queues: list[dict],
    online: bool,
) -> TaskMonitorWorkerItem:
    pool = stats.get("pool") if isinstance(stats.get("pool"), dict) else {}
    max_concurrency = _to_int(
        pool.get("max-concurrency")
        or pool.get("max_concurrency")
        or len(pool.get("processes") or [])
    )
    total = stats.get("total") if isinstance(stats.get("total"), dict) else {}

    return TaskMonitorWorkerItem(
        worker=worker,
        online=online,
        queue_names=sorted({_queue_name_from_queue(item) for item in queues if _queue_name_from_queue(item)}),
        max_concurrency=max_concurrency,
        prefetch_count=_to_int(stats.get("prefetch_count")),
        uptime_seconds=_to_int(stats.get("uptime")),
        processed_total=sum(_to_int(value) for value in total.values()),
        active_count=len(active_tasks),
        reserved_count=len(reserved_tasks),
        scheduled_count=len(scheduled_tasks),
    )


def _build_task_items(tasks_by_worker: dict, *, state: str, now: datetime) -> list[TaskMonitorTaskItem]:
    items: list[TaskMonitorTaskItem] = []
    for worker, raw_tasks in tasks_by_worker.items():
        for raw_item in raw_tasks or []:
            task = raw_item.get("request") if state == "SCHEDULED" else raw_item
            if not isinstance(task, dict):
                continue
            task_id = str(task.get("id") or "").strip()
            if not task_id:
                continue

            eta = _parse_datetime(raw_item.get("eta")) if state == "SCHEDULED" else _parse_datetime(task.get("eta"))
            started_at = _timestamp_to_datetime(task.get("time_start"))
            runtime_seconds = None
            if started_at and state == "STARTED":
                runtime_seconds = max(0.0, round((now - started_at).total_seconds(), 3))

            items.append(
                TaskMonitorTaskItem(
                    task_id=task_id,
                    name=str(task.get("name") or task.get("task") or "-"),
                    state=state,
                    queue_name=_queue_name_from_task(task),
                    worker=str(worker),
                    retries=_to_int(task.get("retries")),
                    eta=eta,
                    started_at=started_at,
                    runtime_seconds=runtime_seconds,
                )
            )
    return items


def _build_queue_items(
    *,
    active_queues: dict,
    tasks: Iterable[TaskMonitorTaskItem],
    pending_counts: dict[str, int],
) -> list[TaskMonitorQueueItem]:
    queue_names: set[str] = set()
    consumer_counts: dict[str, int] = {}
    active_counts: dict[str, int] = {}
    reserved_counts: dict[str, int] = {}
    scheduled_counts: dict[str, int] = {}

    for queues in active_queues.values():
        for queue in queues or []:
            name = _queue_name_from_queue(queue)
            if not name:
                continue
            queue_names.add(name)
            consumer_counts[name] = consumer_counts.get(name, 0) + 1

    for task in tasks:
        if not task.queue_name:
            continue
        queue_names.add(task.queue_name)
        if task.state == "STARTED":
            active_counts[task.queue_name] = active_counts.get(task.queue_name, 0) + 1
        elif task.state == "RECEIVED":
            reserved_counts[task.queue_name] = reserved_counts.get(task.queue_name, 0) + 1
        elif task.state == "SCHEDULED":
            scheduled_counts[task.queue_name] = scheduled_counts.get(task.queue_name, 0) + 1

    return sorted(
        [
            TaskMonitorQueueItem(
                name=name,
                pending_count=max(0, _to_int(pending_counts.get(name))),
                consumer_count=consumer_counts.get(name, 0),
                active_count=active_counts.get(name, 0),
                reserved_count=reserved_counts.get(name, 0),
                scheduled_count=scheduled_counts.get(name, 0),
            )
            for name in queue_names
        ],
        key=lambda item: (-item.pending_count, item.name),
    )


def _build_state_buckets(tasks: Iterable[TaskMonitorTaskItem]) -> list[TaskMonitorBucketItem]:
    counts: dict[str, int] = {}
    for task in tasks:
        counts[task.state] = counts.get(task.state, 0) + 1
    return [
        TaskMonitorBucketItem(key=state, label=STATE_LABELS.get(state, state), count=count)
        for state, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def _collect_queue_names(active_queues: dict, tasks: Iterable[TaskMonitorTaskItem]) -> list[str]:
    queue_names: set[str] = set()

    for queues in active_queues.values():
        for queue in queues or []:
            name = _queue_name_from_queue(queue)
            if name:
                queue_names.add(name)

    for task in tasks:
        if task.queue_name:
            queue_names.add(task.queue_name)

    return sorted(queue_names)


def _load_queue_pending_counts(broker_url: str, queue_names: list[str]) -> dict[str, int]:
    if not queue_names or not _is_redis_url(broker_url):
        return {name: 0 for name in queue_names}

    client = _build_redis_client(broker_url)
    if client is None:
        return {name: 0 for name in queue_names}

    counts: dict[str, int] = {}
    try:
        for queue_name in queue_names:
            counts[queue_name] = _to_int(client.llen(queue_name))
    except Exception:
        return {name: 0 for name in queue_names}
    return counts


def _load_history_task_items(result_backend_url: str, *, limit: int) -> list[TaskMonitorTaskItem]:
    if limit <= 0 or not _is_redis_url(result_backend_url):
        return []

    client = _build_redis_client(result_backend_url)
    if client is None:
        return []

    scan_max = max(200, limit * 20)
    keys: list[str] = []
    cursor = 0

    try:
        while True:
            cursor, batch = client.scan(cursor=cursor, match="celery-task-meta-*", count=200)
            keys.extend(str(key) for key in batch)
            if cursor == 0 or len(keys) >= scan_max:
                break
    except Exception:
        return []

    items: list[TaskMonitorTaskItem] = []
    for key in keys[:scan_max]:
        try:
            payload_raw = client.get(key)
        except Exception:
            continue
        if not payload_raw:
            continue

        try:
            payload = json.loads(payload_raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(payload, dict):
            continue

        state = str(payload.get("status") or "").strip().upper()
        if not state:
            continue

        task_id = str(payload.get("task_id") or key.removeprefix("celery-task-meta-")).strip()
        if not task_id:
            continue

        done_at = _parse_datetime(payload.get("date_done"))
        error = _build_error(payload.get("result"), payload.get("traceback")) if state in {"FAILURE", "RETRY", "REVOKED"} else None

        items.append(
            TaskMonitorTaskItem(
                task_id=task_id,
                name=str(payload.get("name") or "-"),
                state=state,
                done_at=done_at,
                error=error,
            )
        )

    items.sort(key=lambda item: -_task_sort_timestamp(item).timestamp())
    return items[:limit]


def _queue_name_from_queue(queue: dict) -> str:
    if not isinstance(queue, dict):
        return ""
    return str(queue.get("name") or queue.get("routing_key") or "").strip()


def _queue_name_from_task(task: dict) -> str | None:
    delivery_info = task.get("delivery_info") if isinstance(task.get("delivery_info"), dict) else {}
    queue_name = delivery_info.get("routing_key") or task.get("queue")
    if not queue_name:
        return None
    return str(queue_name)


def _is_redis_url(value: str) -> bool:
    scheme = urlsplit(value).scheme
    return scheme in {"redis", "rediss"}


def _build_redis_client(redis_url: str):
    if redis is None:
        return None
    try:
        return redis.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1,
        )
    except Exception:
        return None


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _timestamp_to_datetime(value: object) -> datetime | None:
    try:
        timestamp = float(value)
    except (TypeError, ValueError):
        return None
    if timestamp <= 0:
        return None
    try:
        return datetime.fromtimestamp(timestamp, timezone.utc)
    except (OSError, OverflowError, ValueError):
        return None


def _task_sort_timestamp(item: TaskMonitorTaskItem) -> datetime:
    for candidate in [item.started_at, item.done_at, item.eta]:
        if candidate is None:
            continue
        if candidate.tzinfo is None:
            return candidate.replace(tzinfo=timezone.utc)
        return candidate.astimezone(timezone.utc)
    return datetime.fromtimestamp(0, timezone.utc)


def _build_error(result, traceback_value) -> str | None:
    result_text = None
    if result is not None:
        result_text = str(result).strip()

    traceback_text = None
    if isinstance(traceback_value, str):
        traceback_text = traceback_value.strip()

    for candidate in [result_text, traceback_text]:
        if not candidate:
            continue
        if len(candidate) <= 400:
            return candidate
        return f"{candidate[:397]}..."
    return None


def _to_int(value: object) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _mask_url(value: str) -> str:
    parsed = urlsplit(value)
    if not parsed.password:
        return value
    username = parsed.username or ""
    hostname = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{username}:***@{hostname}{port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))
