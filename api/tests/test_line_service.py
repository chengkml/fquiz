from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base
from app.models.line import Line
from app.models.line_tower import LineTower
from app.schemas.line import LineCreateRequest
from app.services import line_service


def _build_session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(bind=engine, tables=[Line.__table__, LineTower.__table__])
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    return testing_session()


def test_create_line_generates_code_automatically(monkeypatch) -> None:
    session = _build_session()
    try:
        monkeypatch.setattr(line_service, "_publish_line_change", lambda *args, **kwargs: None)
        monkeypatch.setattr(line_service, "uuid4", lambda: SimpleNamespace(hex="abc123fedcba"))

        created = line_service.create_line(
            session,
            LineCreateRequest(name="示例线路", voltage_kv=500),
            actor_user_id="tester",
        )

        expected_code = f"PL-{line_service.utcnow().strftime('%Y%m%d')}-ABC123"
        saved = line_service.get_line_by_id(session, created.id)

        assert created.code == expected_code
        assert saved is not None
        assert saved.code == expected_code
        assert saved.name == "示例线路"
    finally:
        session.close()


def test_generate_line_code_skips_existing_code(monkeypatch) -> None:
    session = _build_session()
    try:
        existing_code = f"PL-{line_service.utcnow().strftime('%Y%m%d')}-ABC123"
        session.add(
            Line(
                code=existing_code,
                name="已有线路",
                status="enabled",
            )
        )
        session.commit()

        codes = iter(
            [
                SimpleNamespace(hex="abc123000000"),
                SimpleNamespace(hex="def456000000"),
            ]
        )
        monkeypatch.setattr(line_service, "uuid4", lambda: next(codes))

        generated = line_service._generate_line_code(session)

        assert generated == f"PL-{line_service.utcnow().strftime('%Y%m%d')}-DEF456"
    finally:
        session.close()
