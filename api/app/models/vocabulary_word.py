from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .user import User


class VocabularyWord(Base):
    __tablename__ = "vocabulary_words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    word: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    phonetic: Mapped[str | None] = mapped_column(String(128), default=None)
    meaning: Mapped[str] = mapped_column(Text(), default="")
    example: Mapped[str | None] = mapped_column(Text(), default=None)
    status: Mapped[str] = mapped_column(String(16), default="enabled", index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        index=True,
    )
    updated_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    created_by: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[created_by_user_id],
        lazy="selectin",
    )
    updated_by: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[updated_by_user_id],
        lazy="selectin",
    )
