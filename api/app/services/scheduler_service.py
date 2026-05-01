from __future__ import annotations

from fastapi import HTTPException, status

from ..core.celery_app import celery_app
from ..core.config import get_settings
from ..schemas.scheduler import (
    SchedulerEnqueueTaskRequest,
    SchedulerEnqueueTaskResponse,
    SchedulerRevokeTaskRequest,
    SchedulerRevokeTaskResponse,
)


def enqueue_task(payload: SchedulerEnqueueTaskRequest) -> SchedulerEnqueueTaskResponse:
    settings = get_settings()
    task_name = payload.task_name.strip()
    if not task_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="taskName is required")

    queue_name = (payload.queue_name or "").strip() or settings.resolved_scheduler_default_queue
    task_id = (payload.task_id or "").strip() or None

    try:
        result = celery_app.send_task(
            task_name,
            args=list(payload.args),
            kwargs=dict(payload.kwargs),
            task_id=task_id,
            queue=queue_name,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"scheduler enqueue failed: {exc}") from exc

    return SchedulerEnqueueTaskResponse(
        queued=True,
        taskId=result.id,
        queueName=queue_name,
        taskName=task_name,
    )


def revoke_task(payload: SchedulerRevokeTaskRequest) -> SchedulerRevokeTaskResponse:
    task_id = payload.task_id.strip()
    if not task_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="taskId is required")

    signal = (payload.signal or "").strip() or "SIGTERM"
    terminate = bool(payload.terminate)

    try:
        celery_app.control.revoke(task_id, terminate=terminate, signal=signal)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"scheduler revoke failed: {exc}") from exc

    return SchedulerRevokeTaskResponse(
        revoked=True,
        taskId=task_id,
        terminate=terminate,
        signal=signal,
    )
