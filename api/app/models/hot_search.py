from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .user import User


class HotSearchRecord(Base):
    __tablename__ = "hot_search_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32), default="TOUTIAO", index=True)
    external_id: Mapped[str | None] = mapped_column(String(128), default=None, index=True)
    title: Mapped[str] = mapped_column(String(512), index=True)
    url: Mapped[str | None] = mapped_column(Text(), default=None)
    hot_value: Mapped[str | None] = mapped_column(String(128), default=None)
    rank_index: Mapped[int | None] = mapped_column(Integer, default=None, index=True)
    crawl_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    batch_no: Mapped[str | None] = mapped_column(String(64), default=None, index=True)
    detail_markdown: Mapped[str | None] = mapped_column(Text(), default=None)
    extra_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    matched_topics_json: Mapped[list[str] | None] = mapped_column(JSON, default=None)
    creator_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        index=True,
    )
    updater_user_id: Mapped[str | None] = mapped_column(
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


class HotSearchFollowTopic(Base):
    __tablename__ = "hot_search_follow_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    topic_name: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    keywords: Mapped[str | None] = mapped_column(Text(), default=None)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    seq: Mapped[int] = mapped_column(Integer, default=0, index=True)
    creator_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        index=True,
    )
    updater_user_id: Mapped[str | None] = mapped_column(
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
