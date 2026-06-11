from __future__ import annotations

from ..core.celery_app import celery_app
from ..services.atp_asset_service import execute_asset_run_job


@celery_app.task(name="app.tasks.atp_asset_tasks.execute_atp_asset_run_job")
def execute_atp_asset_run_job(
    run_id: str,
    payload_data: dict,
    actor_user_id: str | None,
) -> None:
    execute_asset_run_job(run_id=run_id, payload_data=payload_data, actor_user_id=actor_user_id)
