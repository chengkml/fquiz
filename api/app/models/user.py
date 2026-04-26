from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..core.database import Base
from .base import utcnow

if TYPE_CHECKING:
    from .auth_session import AuthSession
    from .audit_log import AuditLog
    from .rbac import Role


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        "user_id",
        String(36),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column("user_name", String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column("password", String(255))
    status: Mapped[str] = mapped_column("state", String(32), default="ENABLED", index=True)
    created_at: Mapped[datetime] = mapped_column(
        "create_date",
        DateTime(timezone=False),
        default=utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        "update_date",
        DateTime(timezone=False),
        default=utcnow,
        onupdate=utcnow,
    )
    create_user: Mapped[str | None] = mapped_column(String(64), nullable=True)
    update_user: Mapped[str | None] = mapped_column(String(64), nullable=True)

    @property
    def last_login_at(self) -> datetime | None:
        return self.updated_at

    @last_login_at.setter
    def last_login_at(self, value: datetime | None) -> None:
        if value is not None:
            self.updated_at = value

    roles: Mapped[list[Role]] = relationship(
        "Role",
        secondary="user_roles",
        back_populates="users",
        lazy="selectin",
    )
    sessions: Mapped[list[AuthSession]] = relationship(
        "AuthSession",
        back_populates="user",
        lazy="selectin",
    )
    audit_logs: Mapped[list[AuditLog]] = relationship(
        "AuditLog",
        back_populates="user",
        lazy="selectin",
    )
