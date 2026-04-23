from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class MindMapSummary(BaseModel):
    id: str
    map_name: str
    descr: str | None = None
    map_data: str | None = None
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class MindMapPageResponse(BaseModel):
    items: list[MindMapSummary]
    total: int
    page_num: int
    page_size: int


class MindMapQueryRequest(BaseModel):
    map_name: str | None = Field(default=None, max_length=255)
    page_num: int = Field(default=0, ge=0)
    page_size: int = Field(default=20, ge=1, le=200)


class MindMapCreateRequest(BaseModel):
    map_name: str = Field(min_length=1, max_length=255)
    descr: str | None = Field(default="", max_length=20000)
    map_data: str | None = Field(default=None)


class MindMapBasicInfoUpdateRequest(BaseModel):
    id: str = Field(min_length=1, max_length=32)
    map_name: str = Field(min_length=1, max_length=255)
    descr: str | None = Field(default="", max_length=20000)


class MindMapDataUpdateRequest(BaseModel):
    id: str = Field(min_length=1, max_length=32)
    map_data: str
