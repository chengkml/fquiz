from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ChatRole = Literal["system", "user", "assistant"]


class ChatSessionCreateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    system_prompt: str | None = Field(default=None, max_length=4000)


class ChatSessionPublic(BaseModel):
    id: str
    owner_user_id: str
    title: str
    system_prompt: str
    model_code: str | None = None
    last_message_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ChatSessionListResponse(BaseModel):
    items: list[ChatSessionPublic]
    total: int


class ChatMessageCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=20000)


class ChatMessagePublic(BaseModel):
    id: int
    session_id: str
    author_user_id: str | None = None
    role: ChatRole
    content: str
    is_error: bool
    model_code: str | None = None
    provider: str | None = None
    provider_model: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int | None = None
    error_message: str | None = None
    created_at: datetime


class ChatMessageListResponse(BaseModel):
    items: list[ChatMessagePublic]
    total: int


class ChatSendResponse(BaseModel):
    session: ChatSessionPublic
    user_message: ChatMessagePublic
    assistant_message: ChatMessagePublic
