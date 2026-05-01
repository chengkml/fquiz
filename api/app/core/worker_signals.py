from __future__ import annotations

from celery import signals

from ..services.worker_registry_service import mark_worker_offline, register_worker


def _normalize_worker_name(sender: object | None) -> str:
    if sender is None:
        return ""
    text = str(sender).strip()
    return text


def _extract_queue_names(sender: object | None) -> list[str]:
    consumer = getattr(sender, "consumer", None)
    if consumer is None:
        return []
    queues = getattr(consumer, "queues", None)
    if queues is None:
        return []
    names: list[str] = []
    try:
        iterator = list(queues)
    except TypeError:
        iterator = []
    for item in iterator:
        name = getattr(item, "name", None)
        if name is None:
            continue
        value = str(name).strip()
        if value:
            names.append(value)
    return names


@signals.worker_ready.connect
def on_worker_ready(sender=None, **kwargs):  # type: ignore[no-untyped-def]
    worker_name = _normalize_worker_name(sender)
    if not worker_name:
        return
    queues = _extract_queue_names(sender)
    register_worker(
        worker_name=worker_name,
        status="online",
        queues=queues,
        heartbeat_increment=False,
        metadata={"event": "worker_ready"},
    )


@signals.heartbeat_sent.connect
def on_worker_heartbeat(sender=None, **kwargs):  # type: ignore[no-untyped-def]
    worker_name = _normalize_worker_name(sender)
    if not worker_name:
        return
    register_worker(
        worker_name=worker_name,
        status="online",
        heartbeat_increment=True,
        metadata={"event": "heartbeat_sent"},
    )


@signals.worker_shutdown.connect
def on_worker_shutdown(sender=None, **kwargs):  # type: ignore[no-untyped-def]
    worker_name = _normalize_worker_name(sender)
    if not worker_name:
        return
    mark_worker_offline(worker_name)
