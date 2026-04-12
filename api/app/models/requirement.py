from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .user import User


class Requirement(Base):
    __tablename__ = "requirements"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text(), default="")
    status: Mapped[str] = mapped_column(String(32), default="PENDING_ANALYSIS", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    project_name: Mapped[str | None] = mapped_column(String(128), index=True)
    module_name: Mapped[str | None] = mapped_column(String(128), index=True)
    source: Mapped[str | None] = mapped_column(String(128), index=True)
    creator_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    assignee_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    reviewer_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
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
    assignee: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[assignee_user_id],
        lazy="selectin",
    )
    reviewer: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[reviewer_user_id],
        lazy="selectin",
    )
    comments: Mapped[list[RequirementComment]] = relationship(
        "RequirementComment",
        back_populates="requirement",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="RequirementComment.created_at.desc()",
    )
    events: Mapped[list[RequirementEvent]] = relationship(
        "RequirementEvent",
        back_populates="requirement",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="RequirementEvent.created_at.desc()",
    )


class RequirementComment(Base):
    __tablename__ = "requirement_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    requirement_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("requirements.id", ondelete="CASCADE"),
        index=True,
    )
    author_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    content: Mapped[str] = mapped_column(Text())
    kind: Mapped[str] = mapped_column(String(32), default="comment", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    requirement: Mapped[Requirement] = relationship("Requirement", back_populates="comments")
    author: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[author_user_id],
        lazy="selectin",
    )


class RequirementEvent(Base):
    __tablename__ = "requirement_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    requirement_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("requirements.id", ondelete="CASCADE"),
        index=True,
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    from_status: Mapped[str | None] = mapped_column(String(32), index=True)
    to_status: Mapped[str | None] = mapped_column(String(32), index=True)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    requirement: Mapped[Requirement] = relationship("Requirement", back_populates="events")
    actor: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[actor_user_id],
        lazy="selectin",
    )
