from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


class LifeCountdownProfileDto(BaseModel):
    id: str | None = None
    deathDate: date | None = None
    todayWarningDate: date | None = None
    todayWarningText: str | None = None
    todayWarningGeneratedAt: datetime | None = None
    todayWarningModel: str | None = None
    createDate: datetime | None = None
    updateDate: datetime | None = None


class LifeCountdownSaveDto(BaseModel):
    deathDate: date | None = Field(default=None)


class LifeCountdownGenerateWarningDto(BaseModel):
    forceRefresh: bool | None = False
    modelName: str | None = None


class LifeCountdownWarningDto(BaseModel):
    warningText: str | None = None
    warningDate: date | None = None
    generatedAt: datetime | None = None
    modelName: str | None = None
    cached: bool = False
