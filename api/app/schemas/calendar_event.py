from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ScheduleStatus = Literal["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"]
SchedulePriority = Literal["LOW", "MEDIUM", "HIGH"]


class CalendarEventSummary(BaseModel):
    id: str
    title: str
    descr: str
    status: ScheduleStatus
    priority: SchedulePriority
    start_time: datetime
    end_time: datetime
    expire_time: datetime | None = None
    all_day: bool = False
    completed_at: datetime | None = None
    todo_id: str | None = None
    create_date: datetime
    create_user: str
    update_date: datetime
    update_user: str | None = None


class CalendarEventPageResponse(BaseModel):
    items: list[CalendarEventSummary]
    total: int
    page_num: int
    page_size: int


class CalendarEventCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    descr: str = Field(default="", max_length=100000)
    status: ScheduleStatus = "SCHEDULED"
    priority: SchedulePriority = "MEDIUM"
    start_time: datetime
    end_time: datetime
    expire_time: datetime | None = None
    all_day: bool = False

    # Internal sync flags (used by services, not by UI directly).
    is_sync: bool = False
    todo_id: str | None = Field(default=None, max_length=32)


class CalendarEventUpdateRequest(BaseModel):
    id: str = Field(min_length=1, max_length=32)
    title: str | None = Field(default=None, min_length=1, max_length=256)
    descr: str | None = Field(default=None, max_length=100000)
    status: ScheduleStatus | None = None
    priority: SchedulePriority | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    expire_time: datetime | None = None
    all_day: bool | None = None
    completed_at: datetime | None = None

    # Internal sync flag.
    is_sync: bool = False


class CalendarEventQueryRequest(BaseModel):
    title: str | None = Field(default=None, max_length=256)
    status: ScheduleStatus | None = None
    priority: SchedulePriority | None = None
    start_time_from: datetime | None = None
    start_time_to: datetime | None = None
    page_num: int = Field(default=0, ge=0)
    page_size: int = Field(default=50, ge=1, le=500)
