from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base
from app.models.atp_model import AtpModel, AtpModelVersion, AtpSimulationRun
from app.services.atp_model_service import delete_model


def _build_sessionmaker():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            AtpModel.__table__,
            AtpModelVersion.__table__,
            AtpSimulationRun.__table__,
        ],
    )
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


def test_delete_model_cascades_hidden_versions_and_runs() -> None:
    testing_session = _build_sessionmaker()
    session: Session = testing_session()
    try:
        model = AtpModel(
            code="ATP-001",
            name="示例模型",
            source_type="atp",
            status="enabled",
            latest_version_no=1,
            active_version_no=1,
        )
        session.add(model)
        session.flush()

        version = AtpModelVersion(
            model_id=model.id,
            version_no=1,
            status="released",
            atp_text="sample",
            content_hash="hash-v1",
        )
        session.add(version)
        session.flush()

        session.add(
            AtpSimulationRun(
                model_id=model.id,
                version_id=version.id,
                status="success",
                engine_mode="native",
                timeout_seconds=60,
            )
        )
        session.commit()

        assert delete_model(session, model.id) is True

        assert session.execute(select(AtpModel).where(AtpModel.id == model.id)).scalar_one_or_none() is None
        assert session.execute(select(AtpModelVersion).where(AtpModelVersion.model_id == model.id)).scalar_one_or_none() is None
        assert session.execute(select(AtpSimulationRun).where(AtpSimulationRun.model_id == model.id)).scalar_one_or_none() is None
    finally:
        session.close()
