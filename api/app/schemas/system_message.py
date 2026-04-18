from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from .user import UserPublic


class SystemMessageSummary(BaseModel):
    id: int
    title: str
    content: str
    level: str
    status: str
    start_at: datetime | None = None
    end_at: datetime | None = None
    created_by_user_id: str | None = None
    updated_by_user_id: str | None = None
    created_at: datetime
    updated_at: datetime
    created_by: UserPublic | None = None
    updated_by: UserPublic | None = None


class SystemMessageListResponse(BaseModel):
    items: list[SystemMessageSummary]
    total: int


class SystemMessageCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20000)
    level: str = Field(default="info", pattern="^(info|success|warning|error)$")
    status: str = Field(default="draft", pattern="^(draft|published|archived)$")
    start_at: datetime | None = None
    end_at: datetime | None = None

    @model_validator(mode="after")
    def validate_time_range(self) -> "SystemMessageCreateRequest":
        if self.start_at and self.end_at and self.start_at > self.end_at:
            raise ValueError("start_at must be <= end_at")
        return self


class SystemMessageUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=20000)
    level: str | None = Field(default=None, pattern="^(info|success|warning|error)$")
    status: str | None = Field(default=None, pattern="^(draft|published|archived)$")
    start_at: datetime | None = None
    end_at: datetime | None = None

    @model_validator(mode="after")
    def validate_time_range(self) -> "SystemMessageUpdateRequest":
        if self.start_at and self.end_at and self.start_at > self.end_at:
            raise ValueError("start_at must be <= end_at")
        return self
