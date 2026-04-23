from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..core.database import Base
from .base import utcnow


class MermaidDiagram(Base):
    __tablename__ = "mermaid_diagram"
    __table_args__ = (
        Index("idx_mermaid_diagram_name", "diagram_name"),
        Index("idx_mermaid_diagram_create_date", "create_date"),
    )

    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    diagram_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text(), default="")
    diagram_data: Mapped[str | None] = mapped_column(Text(), default="")
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
    update_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    update_user: Mapped[str | None] = mapped_column(String(64), index=True)


class MermaidDiagramHistory(Base):
    __tablename__ = "mermaid_diagram_history"
    __table_args__ = (
        Index("idx_mermaid_history_diagram_id", "diagram_id"),
        Index("idx_mermaid_history_create_date", "create_date"),
    )

    id: Mapped[str] = mapped_column(
        "history_id",
        String(32),
        primary_key=True,
        default=lambda: uuid4().hex,
    )
    diagram_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    version_num: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    diagram_data: Mapped[str | None] = mapped_column(Text(), default="")
    description: Mapped[str | None] = mapped_column(String(255))
    create_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    create_user: Mapped[str | None] = mapped_column(String(64), index=True)
