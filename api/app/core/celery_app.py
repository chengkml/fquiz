from __future__ import annotations

from celery import Celery

from .config import get_settings

settings = get_settings()

celery_app = Celery(
    "fquiz",
    broker=settings.resolved_celery_broker_url,
    backend=settings.resolved_celery_result_backend,
    include=["app.tasks.schedule_tasks"],
)

celery_app.conf.update(
    accept_content=["json"],
    beat_schedule={
        "expire-overdue-schedule-items": {
            "task": "app.tasks.schedule_tasks.expire_overdue_schedule_items",
            "schedule": settings.scheduler_expire_interval_seconds,
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
