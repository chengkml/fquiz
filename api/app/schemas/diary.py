from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

DiaryMood = Literal["HAPPY", "CALM", "SAD", "ANGRY", "TIRED", "EXCITED"]


class DiarySummary(BaseModel):
    id: str
    title: str
    content: str
    diary_date: date
    mood: DiaryMood
    weather: str | None = None
    archived: bool = False
    create_date: datetime
    create_user: str | None = None
    update_date: datetime
    update_user: str | None = None


class DiaryPageResponse(BaseModel):
    items: list[DiarySummary]
    total: int
    page_num: int
    page_size: int


class DiaryQueryRequest(BaseModel):
    title: str | None = Field(default=None, max_length=256)
    mood: DiaryMood | None = None
    diary_date_start: date | None = None
    diary_date_end: date | None = None
    archived: bool | None = None
    page_num: int = Field(default=0, ge=0)
    page_size: int = Field(default=20, ge=1, le=200)


class DiaryCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=200000)
    diary_date: date = Field(default_factory=date.today)
    mood: DiaryMood = "CALM"
    weather: str | None = Field(default=None, max_length=64)
    archived: bool = False


class DiaryUpdateRequest(BaseModel):
    id: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1, max_length=200000)
    diary_date: date
    mood: DiaryMood
    weather: str | None = Field(default=None, max_length=64)
    archived: bool = False
