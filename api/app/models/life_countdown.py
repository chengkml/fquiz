from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Date, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .user import User


class LifeCountdownProfile(Base):
    __tablename__ = "life_countdown_profiles"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    death_date: Mapped[date | None] = mapped_column(Date, index=True)
    today_warning_date: Mapped[date | None] = mapped_column(Date, index=True)
    today_warning_text: Mapped[str | None] = mapped_column(Text())
    today_warning_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    today_warning_model: Mapped[str | None] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    user: Mapped[User] = relationship("User", lazy="selectin")
