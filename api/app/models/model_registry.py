from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .user import User


class ModelRegistry(Base):
    __tablename__ = "llm_models"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    provider: Mapped[str] = mapped_column(String(64), index=True)
    provider_model: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)
    capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text(), default="")
    base_url: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    route_rules: Mapped[list[ModelRouteRule]] = relationship(
        "ModelRouteRule",
        back_populates="target_model",
        lazy="selectin",
        primaryjoin="ModelRegistry.code == ModelRouteRule.target_model_code",
    )
    api_keys: Mapped[list[ModelApiKey]] = relationship(
        "ModelApiKey",
        back_populates="model",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="ModelApiKey.version.desc()",
    )
    health_checks: Mapped[list[ModelHealthCheck]] = relationship(
        "ModelHealthCheck",
        back_populates="model",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="ModelHealthCheck.created_at.desc()",
    )
    test_runs: Mapped[list[ModelTestRun]] = relationship(
        "ModelTestRun",
        back_populates="model",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="ModelTestRun.created_at.desc()",
    )


class ModelRouteRule(Base):
    __tablename__ = "model_route_rules"
    __table_args__ = (
        UniqueConstraint("route_type", "route_key", name="uq_model_route_type_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    route_type: Mapped[str] = mapped_column(String(16), index=True)
    route_key: Mapped[str] = mapped_column(String(128), index=True)
    target_model_code: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("llm_models.code", ondelete="RESTRICT"),
        index=True,
    )
    priority: Mapped[int] = mapped_column(Integer, default=100, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )

    target_model: Mapped[ModelRegistry] = relationship(
        "ModelRegistry",
        back_populates="route_rules",
        lazy="selectin",
        primaryjoin="ModelRouteRule.target_model_code == ModelRegistry.code",
    )


class ModelApiKey(Base):
    __tablename__ = "model_api_keys"
    __table_args__ = (
        UniqueConstraint("model_id", "version", name="uq_model_key_model_version"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(
        ForeignKey("llm_models.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, index=True)
    secret_hash: Mapped[str] = mapped_column(String(128))
    secret_masked: Mapped[str] = mapped_column(String(64))
    secret_fingerprint: Mapped[str] = mapped_column(String(32), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    rotation_note: Mapped[str | None] = mapped_column(String(255))
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    model: Mapped[ModelRegistry] = relationship("ModelRegistry", back_populates="api_keys", lazy="selectin")
    created_by: Mapped[User | None] = relationship("User", lazy="selectin")


class ModelHealthCheck(Base):
    __tablename__ = "model_health_checks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(
        ForeignKey("llm_models.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(16), index=True)
    reason: Mapped[str] = mapped_column(String(255))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    detail_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    model: Mapped[ModelRegistry] = relationship("ModelRegistry", back_populates="health_checks", lazy="selectin")


class ModelTestRun(Base):
    __tablename__ = "model_test_runs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(
        ForeignKey("llm_models.id", ondelete="CASCADE"),
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(32), default="SMOKE", index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text())
    created_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    model: Mapped[ModelRegistry] = relationship("ModelRegistry", back_populates="test_runs", lazy="selectin")
    created_by: Mapped[User | None] = relationship("User", lazy="selectin")


class ModelUsageLog(Base):
    __tablename__ = "model_usage_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_code: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(32), default="RUNTIME", index=True)
    request_count: Mapped[int] = mapped_column(Integer, default=1)
    success_count: Mapped[int] = mapped_column(Integer, default=1)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal("0"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
