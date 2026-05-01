from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status

from ...core.config import get_settings
from ...schemas.scheduler import (
    SchedulerEnqueueTaskRequest,
    SchedulerEnqueueTaskResponse,
    SchedulerRevokeTaskRequest,
    SchedulerRevokeTaskResponse,
)
from ...services.scheduler_service import enqueue_task, revoke_task

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


def _require_scheduler_token(
    x_scheduler_token: str | None = Header(default=None, alias="x-scheduler-token"),
) -> None:
    expected = get_settings().resolved_scheduler_api_token
    if not expected:
        return
    provided = (x_scheduler_token or "").strip()
    if provided == expected:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized scheduler request")


@router.get("/healthz")
def scheduler_healthz() -> dict[str, object]:
    return {
        "success": True,
        "status": "ok",
        "service": "fquiz-scheduler",
    }


@router.post("/v1/tasks/enqueue", response_model=SchedulerEnqueueTaskResponse)
def enqueue_scheduler_task(
    payload: SchedulerEnqueueTaskRequest,
    _: None = Depends(_require_scheduler_token),
) -> SchedulerEnqueueTaskResponse:
    return enqueue_task(payload)


@router.post("/v1/tasks/revoke", response_model=SchedulerRevokeTaskResponse)
def revoke_scheduler_task(
    payload: SchedulerRevokeTaskRequest,
    _: None = Depends(_require_scheduler_token),
) -> SchedulerRevokeTaskResponse:
    return revoke_task(payload)
