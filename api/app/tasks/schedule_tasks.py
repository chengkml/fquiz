from __future__ import annotations

import logging

from ..core.celery_app import celery_app
from ..core.database import SessionLocal
from ..services.calendar_event_service import expire_overdue_events
from ..services.todo_service import expire_overdue_todos

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.schedule_tasks.expire_overdue_schedule_items")
def expire_overdue_schedule_items() -> dict[str, int]:
    with SessionLocal() as db:
        expired_events = expire_overdue_events(db)
        expired_todos = expire_overdue_todos(db)

    logger.info(
        "Expired schedule items: calendar_events=%s todos=%s",
        expired_events,
        expired_todos,
    )
    return {
        "expired_calendar_events": expired_events,
        "expired_todos": expired_todos,
    }
