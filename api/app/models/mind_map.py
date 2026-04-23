from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import utcnow


class MindMap(Base):
    __tablename__ = "mind_map"
    __table_args__ = (
        Index("idx_mind_map_name", "map_name"),
        Index("idx_mind_map_create_date", "create_date"),
    )

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    map_name: Mapped[str] = mapped_column(String(255), nullable=False)
    descr: Mapped[str | None] = mapped_column(Text(), default="")
    map_data: Mapped[str | None] = mapped_column(Text(), default="")
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)
