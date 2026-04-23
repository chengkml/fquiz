from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import utcnow


class CalendarEvent(Base):
    __tablename__ = "calendar_event"

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    title: Mapped[str] = mapped_column(String(256), index=True)
    descr: Mapped[str] = mapped_column(Text(), default="")
    status: Mapped[str] = mapped_column(String(20), default="SCHEDULED", index=True)
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM", index=True)

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    expire_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    todo_id: Mapped[str | None] = mapped_column(String(32), index=True)

    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)
