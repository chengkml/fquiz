from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .user import User


class QuestionBank(Base):
    __tablename__ = "question_bank"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_type: Mapped[str] = mapped_column(String(32), default="single_choice", index=True)
    stem: Mapped[str] = mapped_column(Text())
    options_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    answer: Mapped[str] = mapped_column(Text())
    analysis: Mapped[str | None] = mapped_column(Text(), default="")
    difficulty: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    tags_json: Mapped[list[str] | None] = mapped_column(JSON)
    creator_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    updater_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    creator: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[creator_user_id],
        lazy="selectin",
    )
    updater: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[updater_user_id],
        lazy="selectin",
    )
