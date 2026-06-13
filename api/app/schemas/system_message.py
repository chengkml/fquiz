from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SystemMessagePublic(BaseModel):
    id: str
    title: str
    content: str
    message_type: str
    target_user_id: str | None
    is_read: bool
    created_at: datetime
    read_at: datetime | None


class SystemMessageListResponse(BaseModel):
    items: list[SystemMessagePublic]
    total: int
    unread_count: int


class SystemMessageCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1)
    message_type: Literal["info", "warning", "error", "success"] = Field(default="info")
    target_user_id: str | None = Field(default=None, description="发送给特定用户，为空则全员广播")


class SystemMessageMarkReadRequest(BaseModel):
    message_ids: list[str] = Field(min_length=1, description="要标记为已读的消息ID列表")
