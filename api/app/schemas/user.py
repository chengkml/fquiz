from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    username: str
    status: str
    role_codes: list[str]
    permission_codes: list[str]
    created_at: datetime
    last_login_at: datetime | None = None


class UserListResponse(BaseModel):
    items: list[UserPublic]
    total: int


class UserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64)
    status: Literal["active", "disabled"] | None = None


class UserRoleUpdateRequest(BaseModel):
    role_codes: list[str] = Field(min_length=1)
