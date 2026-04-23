from __future__ import annotations

from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import utcnow


class Diary(Base):
    __tablename__ = "diary"
    __table_args__ = (
        Index("idx_diary_create_user", "create_user"),
        Index("idx_diary_diary_date", "diary_date"),
        Index("idx_diary_mood", "mood"),
        Index("idx_diary_archived", "archived"),
    )

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text(), nullable=False)
    diary_date: Mapped[date] = mapped_column(Date(), nullable=False, index=True)
    mood: Mapped[str] = mapped_column(String(20), nullable=False, default="CALM", index=True)
    weather: Mapped[str | None] = mapped_column(String(64))
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        index=True,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)
