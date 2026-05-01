from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SchedulerEnqueueTaskRequest(BaseModel):
    task_name: str = Field(min_length=1, max_length=255, alias="taskName")
    queue_name: str | None = Field(default=None, max_length=255, alias="queueName")
    task_id: str | None = Field(default=None, max_length=255, alias="taskId")
    args: list[Any] = Field(default_factory=list)
    kwargs: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class SchedulerEnqueueTaskResponse(BaseModel):
    queued: bool = True
    task_id: str = Field(alias="taskId")
    queue_name: str = Field(alias="queueName")
    task_name: str = Field(alias="taskName")

    model_config = {"populate_by_name": True}


class SchedulerRevokeTaskRequest(BaseModel):
    task_id: str = Field(min_length=1, max_length=255, alias="taskId")
    terminate: bool = True
    signal: str = Field(default="SIGTERM", max_length=32)

    model_config = {"populate_by_name": True}


class SchedulerRevokeTaskResponse(BaseModel):
    revoked: bool = True
    task_id: str = Field(alias="taskId")
    terminate: bool
    signal: str

    model_config = {"populate_by_name": True}
