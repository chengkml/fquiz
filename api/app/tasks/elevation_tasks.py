from __future__ import annotations

from ..core.celery_app import celery_app
from ..services.elevation_service import (
    execute_apply_job,
    execute_dataset_analysis_job,
    execute_dataset_data_import_job,
    execute_dataset_terrain_build_job,
)


@celery_app.task(name="app.tasks.elevation_tasks.apply_elevation_for_line_job")
def apply_elevation_for_line_job(job_id: str, actor_user_id: str | None = None) -> dict[str, str]:
    execute_apply_job(job_id=job_id, actor_user_id=actor_user_id)
    return {"job_id": job_id, "status": "done"}


@celery_app.task(name="app.tasks.elevation_tasks.analyze_elevation_dataset_job")
def analyze_elevation_dataset_job(dataset_id: str, actor_user_id: str | None) -> dict[str, str]:
    execute_dataset_analysis_job(dataset_id=dataset_id, actor_user_id=actor_user_id)
    return {"dataset_id": dataset_id, "status": "done"}


@celery_app.task(name="app.tasks.elevation_tasks.import_elevation_dataset_data_job")
def import_elevation_dataset_data_job(import_job_id: str, actor_user_id: str | None) -> dict[str, str]:
    execute_dataset_data_import_job(import_job_id=import_job_id, actor_user_id=actor_user_id)
    return {"import_job_id": import_job_id, "status": "done"}


@celery_app.task(name="app.tasks.elevation_tasks.build_elevation_dataset_terrain_job")
def build_elevation_dataset_terrain_job(dataset_id: str, actor_user_id: str | None) -> dict[str, str]:
    execute_dataset_terrain_build_job(dataset_id=dataset_id, actor_user_id=actor_user_id)
    return {"dataset_id": dataset_id, "status": "done"}
