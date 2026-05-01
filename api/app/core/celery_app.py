from __future__ import annotations

from celery import Celery

from .config import get_settings

settings = get_settings()

celery_app = Celery(
    "fquiz",
    broker=settings.resolved_celery_broker_url,
    backend=settings.resolved_celery_result_backend,
    include=[
        "app.tasks.schedule_tasks",
        "app.tasks.elevation_tasks",
        "app.tasks.worker_registry_tasks",
    ],
)

celery_app.conf.update(
    accept_content=["json"],
    beat_schedule={
        "expire-overdue-schedule-items": {
            "task": "app.tasks.schedule_tasks.expire_overdue_schedule_items",
            "schedule": settings.scheduler_expire_interval_seconds,
        },
        "sweep-worker-registry-offline": {
            "task": "app.tasks.worker_registry_tasks.sweep_worker_registry_offline",
            "schedule": 30.0,
        },
    },
    enable_utc=True,
    result_serializer="json",
    task_acks_late=True,
    task_serializer="json",
    task_track_started=True,
    timezone=settings.celery_timezone,
    worker_prefetch_multiplier=1,
)

# Register worker lifecycle signals for auto-registration/heartbeat/offline states.
from . import worker_signals as _worker_signals  # noqa: F401,E402
