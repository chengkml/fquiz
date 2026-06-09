from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

class AtpModel(Base):
    __tablename__ = "atp_model"
    __table_args__ = (
        UniqueConstraint("code", name="uq_atp_model_code"),
        Index("idx_atp_model_status", "status"),
        Index("idx_atp_model_source", "source_type"),
    )

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), default="atpdraw", index=True)
    description: Mapped[str] = mapped_column(Text(), default="")
    status: Mapped[str] = mapped_column(String(20), default="enabled", index=True)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    latest_version_no: Mapped[int] = mapped_column(Integer, default=0)
    active_version_no: Mapped[int | None] = mapped_column(Integer)
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)

    versions: Mapped[list[AtpModelVersion]] = relationship(
        "AtpModelVersion",
        back_populates="model",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="AtpModelVersion.version_no.desc()",
    )
    runs: Mapped[list[AtpSimulationRun]] = relationship(
        "AtpSimulationRun",
        back_populates="model",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="AtpSimulationRun.create_date.desc()",
    )


class AtpModelVersion(Base):
    __tablename__ = "atp_model_version"
    __table_args__ = (
        UniqueConstraint("model_id", "version_no", name="uq_atp_model_version_model_no"),
        Index("idx_atp_model_version_status", "status"),
        Index("idx_atp_model_version_model_status", "model_id", "status"),
        Index("idx_atp_model_version_content_hash", "content_hash"),
    )

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    model_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("atp_model.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    version_tag: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    entry_file: Mapped[str | None] = mapped_column(String(255))
    change_note: Mapped[str] = mapped_column(Text(), default="")
    artifact_manifest_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    graph_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    atp_text: Mapped[str] = mapped_column(Text(), default="")
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)

    model: Mapped[AtpModel] = relationship("AtpModel", back_populates="versions", lazy="selectin")
    runs: Mapped[list[AtpSimulationRun]] = relationship(
        "AtpSimulationRun",
        back_populates="version",
        lazy="selectin",
        order_by="AtpSimulationRun.create_date.desc()",
    )


class AtpSimulationRun(Base):
    __tablename__ = "atp_simulation_run"
    __table_args__ = (
        Index("idx_atp_simulation_run_status", "status"),
        Index("idx_atp_simulation_run_model", "model_id", "create_date"),
    )

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    model_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("atp_model.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[str | None] = mapped_column(
        String(32),
        ForeignKey("atp_model_version.id", ondelete="SET NULL"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    engine_mode: Mapped[str] = mapped_column(String(20), default="wine", index=True)
    task_id: Mapped[str | None] = mapped_column(String(128), index=True)
    engine_command: Mapped[str | None] = mapped_column(String(1000))
    working_dir: Mapped[str | None] = mapped_column(String(1000))
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=600)
    exit_code: Mapped[int | None] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    stdout_text: Mapped[str | None] = mapped_column(Text())
    stderr_text: Mapped[str | None] = mapped_column(Text())
    error_message: Mapped[str | None] = mapped_column(Text())
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)

    model: Mapped[AtpModel] = relationship("AtpModel", back_populates="runs", lazy="selectin")
    version: Mapped[AtpModelVersion | None] = relationship("AtpModelVersion", back_populates="runs", lazy="selectin")
