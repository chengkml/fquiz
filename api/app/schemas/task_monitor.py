from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TaskMonitorBucketItem(BaseModel):
    key: str
    label: str
    count: int


class TaskMonitorRequirementRiskItem(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    updated_at: datetime
    stale_hours: int


class TaskMonitorTodoRiskItem(BaseModel):
    id: str
    title: str
    status: str
    priority: str
    due_date: datetime | None = None
    expire_time: datetime | None = None
    overdue_hours: int


class TaskMonitorOverviewResponse(BaseModel):
    generated_at: datetime

    requirement_total: int = 0
    requirement_active: int = 0
    requirement_completed: int = 0
    requirement_status_buckets: list[TaskMonitorBucketItem] = Field(default_factory=list)
    requirement_priority_buckets: list[TaskMonitorBucketItem] = Field(default_factory=list)
    high_priority_requirements: list[TaskMonitorRequirementRiskItem] = Field(default_factory=list)
    stale_requirements: list[TaskMonitorRequirementRiskItem] = Field(default_factory=list)

    todo_total: int = 0
    todo_active: int = 0
    todo_completed: int = 0
    todo_overdue: int = 0
    todo_status_buckets: list[TaskMonitorBucketItem] = Field(default_factory=list)
    todo_priority_buckets: list[TaskMonitorBucketItem] = Field(default_factory=list)
    overdue_todos: list[TaskMonitorTodoRiskItem] = Field(default_factory=list)
