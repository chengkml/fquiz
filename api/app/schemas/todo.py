from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .user import UserPublic

TodoStatus = Literal["TODO", "IN_PROGRESS", "DONE"]
TodoPriority = Literal["low", "medium", "high", "urgent"]


class TodoSummary(BaseModel):
    id: str
    title: str
    description: str
    status: TodoStatus
    priority: TodoPriority
    assignee_user_id: str | None = None
    creator_user_id: str | None = None
    due_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    creator: UserPublic | None = None
    assignee: UserPublic | None = None


class TodoListResponse(BaseModel):
    items: list[TodoSummary]
    total: int


class TodoCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=20000)
    status: TodoStatus = "TODO"
    priority: TodoPriority = "medium"
    assignee_user_id: str | None = Field(default=None, max_length=36)
    due_at: datetime | None = None


class TodoUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    priority: TodoPriority | None = None
    assignee_user_id: str | None = Field(default=None, max_length=36)
    due_at: datetime | None = None


class TodoTransitionRequest(BaseModel):
    status: TodoStatus
    note: str | None = Field(default=None, max_length=2000)
