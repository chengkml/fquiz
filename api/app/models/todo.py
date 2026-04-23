from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import utcnow


class Todo(Base):
    __tablename__ = "todo"
    __table_args__ = (
        Index("idx_todo_status", "status"),
        Index("idx_todo_priority", "priority"),
        Index("idx_todo_due_date", "due_date"),
        Index("idx_todo_expire_time", "expire_time"),
    )

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    descr: Mapped[str | None] = mapped_column(Text(), default="")
    status: Mapped[str] = mapped_column(String(20), default="SCHEDULED", nullable=False)
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM", nullable=False)
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expire_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    calendar_event_id: Mapped[str | None] = mapped_column(String(32))
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)
