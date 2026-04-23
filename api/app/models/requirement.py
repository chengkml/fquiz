from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .user import User


class Requirement(Base):
    __tablename__ = "project_requirement"

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    title: Mapped[str] = mapped_column(String(256), index=True)
    project_name: Mapped[str | None] = mapped_column(String(128), index=True)
    git_url: Mapped[str | None] = mapped_column(String(512))
    branch: Mapped[str | None] = mapped_column(String(128), default="main")
    descr: Mapped[str] = mapped_column(Text(), default="")
    result_msg: Mapped[str | None] = mapped_column(Text())
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(30), default="PENDING_ANALYSIS", index=True)
    priority: Mapped[str] = mapped_column(String(20), default="MEDIUM", index=True)
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)

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
        order_by="RequirementEvent.create_date.desc()",
    )


class RequirementComment(Base):
    __tablename__ = "requirement_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    requirement_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("project_requirement.id", ondelete="CASCADE"),
        index=True,
    )
    author_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.user_id", ondelete="SET NULL"),
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
    __tablename__ = "project_requirement_log"

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    requirement_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("project_requirement.id", ondelete="CASCADE"),
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(30), index=True)
    from_status: Mapped[str | None] = mapped_column(String(30), index=True)
    to_status: Mapped[str | None] = mapped_column(String(30), index=True)
    before_descr: Mapped[str | None] = mapped_column(Text())
    after_descr: Mapped[str | None] = mapped_column(Text())
    remark: Mapped[str | None] = mapped_column(Text())
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)

    requirement: Mapped[Requirement] = relationship("Requirement", back_populates="events")
