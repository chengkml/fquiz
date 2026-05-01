from __future__ import annotations

from ..core.celery_app import celery_app
from ..services.elevation_service import execute_apply_job


@celery_app.task(name="app.tasks.elevation_tasks.apply_elevation_for_line_job")
def apply_elevation_for_line_job(job_id: str) -> dict[str, str]:
    execute_apply_job(job_id)
    return {"job_id": job_id, "status": "done"}
