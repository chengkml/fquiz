from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .user import UserPublic

RequirementStatus = Literal[
    "PENDING_ANALYSIS",
    "PENDING_REVISION",
    "OPEN",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
]
RequirementPriority = Literal["low", "medium", "high", "urgent"]
RequirementCommentKind = Literal["comment", "analysis", "revision", "system"]


class RequirementSummary(BaseModel):
    id: str
    code: str
    title: str
    description: str
    status: RequirementStatus
    priority: RequirementPriority
    project_name: str | None = None
    module_name: str | None = None
    source: str | None = None
    creator_user_id: str | None = None
    assignee_user_id: str | None = None
    reviewer_user_id: str | None = None
    due_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    creator: UserPublic | None = None
    assignee: UserPublic | None = None
    reviewer: UserPublic | None = None


class RequirementListResponse(BaseModel):
    items: list[RequirementSummary]
    total: int


class RequirementCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: str = Field(default="", max_length=20000)
    status: RequirementStatus = "PENDING_ANALYSIS"
    priority: RequirementPriority = "medium"
    project_name: str | None = Field(default=None, max_length=128)
    module_name: str | None = Field(default=None, max_length=128)
    source: str | None = Field(default=None, max_length=128)
    assignee_user_id: str | None = Field(default=None, max_length=36)
    due_at: datetime | None = None


class RequirementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    priority: RequirementPriority | None = None
    project_name: str | None = Field(default=None, max_length=128)
    module_name: str | None = Field(default=None, max_length=128)
    source: str | None = Field(default=None, max_length=128)
    assignee_user_id: str | None = Field(default=None, max_length=36)
    due_at: datetime | None = None


class RequirementAssignRequest(BaseModel):
    assignee_user_id: str | None = Field(default=None, max_length=36)


class RequirementTransitionRequest(BaseModel):
    status: RequirementStatus
    note: str | None = Field(default=None, max_length=2000)


class RequirementCommentCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    kind: RequirementCommentKind = "comment"


class RequirementCommentPublic(BaseModel):
    id: int
    requirement_id: str
    author_user_id: str | None = None
    content: str
    kind: RequirementCommentKind
    created_at: datetime
    author: UserPublic | None = None


class RequirementEventPublic(BaseModel):
    id: int
    requirement_id: str
    actor_user_id: str | None = None
    event_type: str
    from_status: str | None = None
    to_status: str | None = None
    payload_json: dict | None = None
    created_at: datetime
    actor: UserPublic | None = None
