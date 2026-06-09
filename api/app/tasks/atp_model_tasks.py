from __future__ import annotations

from typing import Any

from ..core.celery_app import celery_app
from ..services.atp_model_service import execute_model_run_job


@celery_app.task(name="app.tasks.atp_model_tasks.execute_atp_model_run_job")
def execute_atp_model_run_job(
    run_id: str,
    payload_data: dict[str, Any],
    actor_user_id: str | None,
) -> dict[str, str]:
    execute_model_run_job(
        run_id=run_id,
        payload_data=payload_data,
        actor_user_id=actor_user_id,
    )
    return {"run_id": run_id, "status": "done"}
