from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

TodoStatus = Literal["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"]
TodoPriority = Literal["LOW", "MEDIUM", "HIGH"]


class TodoSummary(BaseModel):
    id: str
    title: str
    descr: str | None = None
    status: TodoStatus
    priority: TodoPriority
    start_time: datetime | None = None
    due_date: datetime | None = None
    expire_time: datetime | None = None
    calendar_event_id: str | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class TodoListResponse(BaseModel):
    items: list[TodoSummary]
    total: int


class TodoCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    descr: str = Field(default="", max_length=20000)
    status: TodoStatus = "SCHEDULED"
    priority: TodoPriority = "MEDIUM"
    start_time: datetime | None = None
    due_date: datetime | None = None
    expire_time: datetime | None = None
    is_sync: bool = False
    calendar_event_id: str | None = Field(default=None, max_length=32)


class TodoUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=256)
    descr: str | None = Field(default=None, max_length=20000)
    status: TodoStatus | None = None
    priority: TodoPriority | None = None
    start_time: datetime | None = None
    due_date: datetime | None = None
    expire_time: datetime | None = None
    calendar_event_id: str | None = Field(default=None, max_length=32)
    is_sync: bool = False


class TodoTransitionRequest(BaseModel):
    status: TodoStatus
    note: str | None = Field(default=None, max_length=2000)
    is_sync: bool = False
