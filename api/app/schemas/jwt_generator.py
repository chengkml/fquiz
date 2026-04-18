from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class JwtGeneratorUserItem(BaseModel):
    id: str
    email: str
    username: str
    status: str
    role_codes: list[str]


class JwtGeneratorUserListResponse(BaseModel):
    items: list[JwtGeneratorUserItem]
    total: int
    limit: int
    offset: int


class JwtGenerateRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    expires_minutes: int | None = Field(default=None, ge=1, le=7 * 24 * 60)

    @field_validator("user_id")
    @classmethod
    def validate_user_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("user_id cannot be empty")
        return normalized


class JwtGenerateResponse(BaseModel):
    token_type: str = "bearer"
    access_token: str
    expires_in: int
    expires_at: datetime
    user_id: str
    role_codes: list[str]
    permission_codes: list[str]
