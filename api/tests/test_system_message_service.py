from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.system_message import SystemMessage
from app.schemas.system_message import SystemMessageCreateRequest
from app.services.system_message_service import create_system_message, delete_system_message


def test_delete_system_message_removes_existing_message() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(bind=engine, tables=[SystemMessage.__table__])

    with Session(engine) as db:
        message = create_system_message(
            db,
            SystemMessageCreateRequest(
                title="系统通知",
                content="测试内容",
                message_type="info",
            ),
        )

        deleted = delete_system_message(db, message.id)

        assert deleted is True
        assert db.scalar(select(SystemMessage).where(SystemMessage.id == message.id)) is None


def test_delete_system_message_returns_false_when_missing() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(bind=engine, tables=[SystemMessage.__table__])

    with Session(engine) as db:
        deleted = delete_system_message(db, "missing-message-id")

        assert deleted is False
