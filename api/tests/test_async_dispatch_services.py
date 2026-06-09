from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base
from app.models.atp_model import AtpModel, AtpModelVersion, AtpSimulationRun
from app.models.elevation import ElevationDataset
from app.models.user import User
from app.models.wine import WineRun
from app.schemas.atp_model import AtpSimulationRunRequest
from app.schemas.wine import WineRunRequest
from app.services import atp_model_service, elevation_service, wine_service


def _build_sessionmaker(*tables):
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(bind=engine, tables=list(tables))
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


def test_run_model_version_queues_celery_task(monkeypatch) -> None:
    testing_session = _build_sessionmaker(
        AtpModel.__table__,
        AtpModelVersion.__table__,
        AtpSimulationRun.__table__,
    )
    session: Session = testing_session()
    try:
        model = AtpModel(
            code="ATP-ASYNC-001",
            name="异步仿真模型",
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
        session.commit()

        monkeypatch.setattr(
            atp_model_service,
            "_dispatch_atp_model_run_task",
            lambda **_: SimpleNamespace(id="celery-atp-1"),
        )

        result = atp_model_service.run_model_version(
            session,
            model_id=model.id,
            payload=AtpSimulationRunRequest(version_id=version.id),
            actor_user_id="tester",
        )

        assert result.status == "pending"
        assert result.task_id == "celery-atp-1"

        saved = session.execute(select(AtpSimulationRun).where(AtpSimulationRun.id == result.id)).scalar_one()
        assert saved.task_id == "celery-atp-1"
        assert saved.status == "pending"
        assert saved.started_at is None
    finally:
        session.close()


def test_queue_dataset_analysis_reuses_existing_running_task(monkeypatch) -> None:
    testing_session = _build_sessionmaker(ElevationDataset.__table__)
    session: Session = testing_session()
    try:
        dataset = ElevationDataset(
            code="ELEV-001",
            name="样例高程集",
            file_format="csv",
            mount_code="default",
            dataset_dir="/elevation/datasets/ELEV-001",
            file_path="/elevation/datasets/ELEV-001/data.csv",
            status="active",
            usage_status="idle",
        )
        session.add(dataset)
        session.commit()

        actor = User(
            id="actor-1",
            email="actor@example.com",
            username="actor",
            password_hash="hashed",
            status="active",
        )

        monkeypatch.setattr(
            elevation_service,
            "_dispatch_elevation_dataset_analysis_task",
            lambda **_: SimpleNamespace(id="elev-task-1"),
        )

        first = elevation_service.queue_dataset_analysis(session, dataset_id=dataset.id, actor=actor)
        assert first.queued is True
        assert first.task_id == "elev-task-1"
        assert first.dataset.analysis_status == "queued"

        second = elevation_service.queue_dataset_analysis(session, dataset_id=dataset.id, actor=actor)
        assert second.queued is False
        assert second.task_id == "elev-task-1"
        assert second.detail == "分析任务已存在，无需重复提交。"
    finally:
        session.close()


def test_wine_create_run_queues_task_and_worker_records_failure(monkeypatch) -> None:
    testing_session = _build_sessionmaker(WineRun.__table__)
    session: Session = testing_session()
    try:
        monkeypatch.setattr(wine_service, "_resolve_binary", lambda: "/usr/bin/wine")
        monkeypatch.setattr(
            wine_service,
            "probe_wine_binary",
            lambda *_args, **_kwargs: SimpleNamespace(available=True, error=None, version="wine-10.0"),
        )
        monkeypatch.setattr(wine_service, "_resolve_executable", lambda _path: Path("/tmp/demo.exe"))
        monkeypatch.setattr(wine_service, "_resolve_working_dir", lambda _path, _exe: Path("/tmp"))
        monkeypatch.setattr(
            wine_service,
            "_dispatch_wine_run_task",
            lambda **_: SimpleNamespace(id="wine-task-1"),
        )

        created = wine_service.create_run(
            session,
            payload=WineRunRequest(exe_path="demo.exe", arguments=["/silent"]),
            actor_user_id="tester",
        )

        assert created.status == "pending"
        assert created.task_id == "wine-task-1"

        monkeypatch.setattr(wine_service, "SessionLocal", testing_session)
        monkeypatch.setattr(
            wine_service.subprocess,
            "run",
            lambda *args, **kwargs: SimpleNamespace(returncode=9, stdout="stdout", stderr="stderr"),
        )

        wine_service.execute_run_job(run_id=created.id, actor_user_id="tester")

        saved = session.execute(select(WineRun).where(WineRun.id == created.id)).scalar_one()
        session.refresh(saved)
        assert saved.status == "failed"
        assert saved.exit_code == 9
        assert saved.error_message == "Wine process exited with code 9"
        assert saved.stdout_text == "stdout"
        assert saved.stderr_text == "stderr"
    finally:
        session.close()
