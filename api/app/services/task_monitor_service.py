from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.requirement import Requirement
from ..models.todo import Todo
from ..models.user import User
from ..schemas.task_monitor import (
    TaskMonitorBucketItem,
    TaskMonitorOverviewResponse,
    TaskMonitorRequirementRiskItem,
    TaskMonitorTodoRiskItem,
)

REQUIREMENT_STATUS_LABELS: dict[str, str] = {
    "PENDING_ANALYSIS": "待分析",
    "PENDING_REVIEW": "待评审",
    "PENDING_REVISION": "待修订",
    "OPEN": "待处理",
    "IN_PROGRESS": "处理中",
    "COMPLETED": "已完成",
    "CLOSED": "已关闭",
    "CANCELLED": "已取消",
}
REQUIREMENT_DONE_STATUSES = {"COMPLETED", "CLOSED", "CANCELLED"}
HIGH_PRIORITY_VALUES = {"HIGH", "URGENT"}

TODO_STATUS_LABELS: dict[str, str] = {
    "SCHEDULED": "已计划",
    "IN_PROGRESS": "处理中",
    "COMPLETED": "已完成",
    "CANCELLED": "已取消",
    "EXPIRED": "已过期",
}
TODO_ACTIVE_STATUSES = {"SCHEDULED", "IN_PROGRESS"}

PRIORITY_LABELS: dict[str, str] = {
    "LOW": "低",
    "MEDIUM": "中",
    "HIGH": "高",
    "URGENT": "紧急",
}


def build_task_monitor_overview(
    db: Session,
    *,
    actor: User,
    can_read_requirements: bool,
    can_read_todos: bool,
    can_manage_todos: bool,
    risk_limit: int,
    stale_hours: int,
) -> TaskMonitorOverviewResponse:
    now = utcnow()
    overview = TaskMonitorOverviewResponse(generated_at=now)

    if can_read_requirements:
        _fill_requirement_metrics(
            db,
            overview=overview,
            now=now,
            risk_limit=risk_limit,
            stale_hours=stale_hours,
        )

    if can_read_todos:
        _fill_todo_metrics(
            db,
            overview=overview,
            now=now,
            actor=actor,
            can_manage_todos=can_manage_todos,
            risk_limit=risk_limit,
        )

    return overview


def _fill_requirement_metrics(
    db: Session,
    *,
    overview: TaskMonitorOverviewResponse,
    now: datetime,
    risk_limit: int,
    stale_hours: int,
) -> None:
    status_rows = db.execute(
        select(Requirement.status, func.count(Requirement.id))
        .group_by(Requirement.status)
        .order_by(Requirement.status.asc())
    ).all()

    status_counts: dict[str, int] = {}
    for raw_status, raw_count in status_rows:
        status = _normalize_requirement_status(raw_status)
        status_counts[status] = status_counts.get(status, 0) + int(raw_count or 0)

    overview.requirement_status_buckets = _build_buckets(
        status_counts,
        label_map=REQUIREMENT_STATUS_LABELS,
    )
    overview.requirement_total = sum(status_counts.values())
    overview.requirement_completed = sum(
        count for status, count in status_counts.items() if status in REQUIREMENT_DONE_STATUSES
    )
    overview.requirement_active = max(0, overview.requirement_total - overview.requirement_completed)

    priority_rows = db.execute(
        select(Requirement.priority, func.count(Requirement.id))
        .group_by(Requirement.priority)
        .order_by(Requirement.priority.asc())
    ).all()
    priority_counts: dict[str, int] = {}
    for raw_priority, raw_count in priority_rows:
        priority = _normalize_priority(raw_priority)
        priority_counts[priority] = priority_counts.get(priority, 0) + int(raw_count or 0)
    overview.requirement_priority_buckets = _build_buckets(priority_counts, label_map=PRIORITY_LABELS)

    high_priority_rows = db.execute(
        select(Requirement)
        .where(
            Requirement.status.notin_(sorted(REQUIREMENT_DONE_STATUSES)),
            Requirement.priority.in_(sorted(HIGH_PRIORITY_VALUES)),
        )
        .order_by(Requirement.update_date.asc(), Requirement.id.asc())
        .limit(risk_limit)
    ).scalars().all()
    overview.high_priority_requirements = [
        TaskMonitorRequirementRiskItem(
            id=item.id,
            title=item.title,
            status=_normalize_requirement_status(item.status),
            priority=_normalize_priority(item.priority),
            updated_at=item.update_date,
            stale_hours=_hours_between(now, item.update_date),
        )
        for item in high_priority_rows
    ]

    stale_before = now - timedelta(hours=stale_hours)
    stale_rows = db.execute(
        select(Requirement)
        .where(
            Requirement.status.notin_(sorted(REQUIREMENT_DONE_STATUSES)),
            Requirement.update_date <= stale_before,
        )
        .order_by(Requirement.update_date.asc(), Requirement.id.asc())
        .limit(risk_limit)
    ).scalars().all()
    overview.stale_requirements = [
        TaskMonitorRequirementRiskItem(
            id=item.id,
            title=item.title,
            status=_normalize_requirement_status(item.status),
            priority=_normalize_priority(item.priority),
            updated_at=item.update_date,
            stale_hours=_hours_between(now, item.update_date),
        )
        for item in stale_rows
    ]


def _fill_todo_metrics(
    db: Session,
    *,
    overview: TaskMonitorOverviewResponse,
    now: datetime,
    actor: User,
    can_manage_todos: bool,
    risk_limit: int,
) -> None:
    filters = []
    if not can_manage_todos:
        filters.append(Todo.create_user == actor.username)

    status_rows = db.execute(
        select(Todo.status, func.count(Todo.id))
        .where(*filters)
        .group_by(Todo.status)
        .order_by(Todo.status.asc())
    ).all()
    status_counts: dict[str, int] = {}
    for raw_status, raw_count in status_rows:
        status = _normalize_todo_status(raw_status)
        status_counts[status] = status_counts.get(status, 0) + int(raw_count or 0)

    overview.todo_status_buckets = _build_buckets(status_counts, label_map=TODO_STATUS_LABELS)
    overview.todo_total = sum(status_counts.values())
    overview.todo_completed = status_counts.get("COMPLETED", 0)
    overview.todo_active = sum(count for status, count in status_counts.items() if status in TODO_ACTIVE_STATUSES)

    priority_rows = db.execute(
        select(Todo.priority, func.count(Todo.id))
        .where(*filters)
        .group_by(Todo.priority)
        .order_by(Todo.priority.asc())
    ).all()
    priority_counts: dict[str, int] = {}
    for raw_priority, raw_count in priority_rows:
        priority = _normalize_priority(raw_priority)
        priority_counts[priority] = priority_counts.get(priority, 0) + int(raw_count or 0)
    overview.todo_priority_buckets = _build_buckets(priority_counts, label_map=PRIORITY_LABELS)

    overdue_filters = [
        *filters,
        Todo.status.in_(sorted(TODO_ACTIVE_STATUSES)),
        _build_todo_overdue_clause(now),
    ]
    overview.todo_overdue = int(
        db.scalar(
            select(func.count(Todo.id)).where(*overdue_filters),
        )
        or 0
    )

    overdue_rows = db.execute(
        select(Todo)
        .where(*overdue_filters)
        .order_by(func.coalesce(Todo.expire_time, Todo.due_date, Todo.update_date).asc(), Todo.id.asc())
        .limit(risk_limit)
    ).scalars().all()
    overview.overdue_todos = [
        TaskMonitorTodoRiskItem(
            id=item.id,
            title=item.title,
            status=_normalize_todo_status(item.status),
            priority=_normalize_priority(item.priority),
            due_date=item.due_date,
            expire_time=item.expire_time,
            overdue_hours=_hours_between(now, _resolve_todo_deadline(item)),
        )
        for item in overdue_rows
    ]


def _build_todo_overdue_clause(now: datetime):
    return or_(
        and_(Todo.due_date.is_not(None), Todo.due_date <= now),
        and_(Todo.expire_time.is_not(None), Todo.expire_time <= now),
    )


def _build_buckets(counts: dict[str, int], *, label_map: dict[str, str]) -> list[TaskMonitorBucketItem]:
    return [
        TaskMonitorBucketItem(
            key=key,
            label=label_map.get(key, key),
            count=count,
        )
        for key, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def _resolve_todo_deadline(todo: Todo) -> datetime:
    candidates = [value for value in [todo.due_date, todo.expire_time] if value is not None]
    if not candidates:
        return todo.update_date
    return min(candidates)


def _hours_between(now: datetime, then: datetime) -> int:
    now_utc = _to_utc(now)
    then_utc = _to_utc(then)
    diff_seconds = max(0, (now_utc - then_utc).total_seconds())
    return int(max(1, math.ceil(diff_seconds / 3600)))


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _normalize_requirement_status(raw_status: str | None) -> str:
    normalized = (raw_status or "").strip().upper()
    if not normalized:
        return "PENDING_ANALYSIS"
    if normalized == "CANCELLED":
        return "CANCELLED"
    return normalized


def _normalize_todo_status(raw_status: str | None) -> str:
    normalized = (raw_status or "").strip().upper()
    return normalized or "SCHEDULED"


def _normalize_priority(raw_priority: str | None) -> str:
    normalized = (raw_priority or "").strip().upper()
    if normalized == "URGENT":
        return "URGENT"
    if normalized in {"LOW", "MEDIUM", "HIGH"}:
        return normalized
    return "MEDIUM"
