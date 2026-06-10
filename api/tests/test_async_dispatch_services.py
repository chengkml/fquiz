from __future__ import annotations

import io
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


class _MemoryStorageDriver:
    def __init__(self) -> None:
        self.directories: set[str] = set()
        self.files: dict[str, bytes] = {}

    def ensure_directory(self, path: str) -> None:
        self.directories.add(path.rstrip("/") or "/")

    def write_file(self, path: str, *, content: bytes, content_type: str | None = None) -> SimpleNamespace:
        self.files[path] = content
        parent_path = path.rsplit("/", 1)[0] or "/"
        return SimpleNamespace(
            path=path,
            parent_path=parent_path,
            name=Path(path).name,
            is_dir=False,
            size=len(content),
            modified_at=None,
            mime_type=content_type,
        )

    def list_dir(self, path: str) -> list[SimpleNamespace]:
        prefix = f"{path.rstrip('/')}/"
        entries: list[SimpleNamespace] = []
        for file_path in sorted(self.files):
            if not file_path.startswith(prefix):
                continue
            suffix = file_path[len(prefix):]
            if "/" in suffix:
                continue
            entries.append(
                SimpleNamespace(
                    path=file_path,
                    parent_path=path,
                    name=Path(file_path).name,
                    is_dir=False,
                    size=len(self.files[file_path]),
                    modified_at=None,
                    mime_type=None,
                )
            )
        return entries


def _build_upload(filename: str, content: bytes, content_type: str = "application/octet-stream") -> SimpleNamespace:
    return SimpleNamespace(filename=filename, file=io.BytesIO(content), content_type=content_type)


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
        assert first.dataset.terrain_status == "not_supported"

        second = elevation_service.queue_dataset_analysis(session, dataset_id=dataset.id, actor=actor)
        assert second.queued is False
        assert second.task_id == "elev-task-1"
        assert second.detail == "分析任务已存在，无需重复提交。"
    finally:
        session.close()


def test_queue_dataset_terrain_build_reuses_existing_running_task(monkeypatch) -> None:
    testing_session = _build_sessionmaker(ElevationDataset.__table__)
    session: Session = testing_session()
    try:
        dataset = ElevationDataset(
            code="ELEV-TERRAIN-001",
            name="样例地形集",
            file_format="tif",
            mount_code="default",
            dataset_dir="/elevation/datasets/ELEV-TERRAIN-001",
            file_path="/elevation/datasets/ELEV-TERRAIN-001/data.tif",
            status="active",
            usage_status="idle",
            terrain_status="pending",
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
            "_dispatch_elevation_dataset_terrain_task",
            lambda **_: SimpleNamespace(id="terrain-task-1"),
        )

        first = elevation_service.queue_dataset_terrain_build(session, dataset_id=dataset.id, actor=actor)
        assert first.queued is True
        assert first.task_id == "terrain-task-1"
        assert first.dataset.terrain_status == "pending"

        second = elevation_service.queue_dataset_terrain_build(session, dataset_id=dataset.id, actor=actor)
        assert second.queued is False
        assert second.task_id == "terrain-task-1"
        assert second.detail == "地形瓦片任务已存在，无需重复提交。"
    finally:
        session.close()


def test_import_dataset_data_files_batches_keep_preferred_raster_and_only_queue_final_analysis(monkeypatch) -> None:
    testing_session = _build_sessionmaker(ElevationDataset.__table__)
    session: Session = testing_session()
    try:
        dataset = ElevationDataset(
            code="ELEV-IMPORT-001",
            name="批量导入样例",
            file_format="csv",
            mount_code="default",
            dataset_dir="/elevation/datasets/ELEV-IMPORT-001",
            file_path="/elevation/datasets/ELEV-IMPORT-001/dataset.csv",
            status="active",
            usage_status="idle",
            sample_count=128,
            bbox_min_lon=100.0,
            bbox_max_lon=120.0,
            bbox_min_lat=20.0,
            bbox_max_lat=30.0,
            analysis_task_id="old-task",
            analysis_status="success",
            terrain_status="not_supported",
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
        driver = _MemoryStorageDriver()
        analysis_calls: list[tuple[str, str | None]] = []

        monkeypatch.setattr(elevation_service, "_require_mount", lambda *_args, **_kwargs: SimpleNamespace(code="default"))
        monkeypatch.setattr(elevation_service, "_build_driver_or_400", lambda *_args, **_kwargs: driver)
        monkeypatch.setattr(
            elevation_service,
            "_dispatch_elevation_dataset_analysis_task",
            lambda *, dataset_id, actor_user_id: analysis_calls.append((dataset_id, actor_user_id)) or SimpleNamespace(id="new-task"),
        )
        monkeypatch.setattr(elevation_service, "_publish_elevation_change", lambda *_args, **_kwargs: None)

        first = elevation_service.import_dataset_data_files(
            session,
            dataset_id=dataset.id,
            files=[_build_upload("terrain.img", b"img-bytes", "application/octet-stream")],
            actor=actor,
            trigger_analysis=False,
        )
        session.refresh(dataset)

        assert first.analysis_task_queued is False
        assert first.analysis_task_id is None
        assert dataset.file_path.endswith("/terrain.img")
        assert dataset.file_format == "img"
        assert dataset.analysis_status == "not_started"
        assert dataset.analysis_task_id is None
        assert dataset.sample_count == 0
        assert dataset.bbox_min_lon is None
        assert dataset.terrain_status == "pending"
        assert analysis_calls == []

        second = elevation_service.import_dataset_data_files(
            session,
            dataset_id=dataset.id,
            files=[_build_upload("points.csv", b"lon,lat,elevation\n1,2,3\n", "text/csv")],
            actor=actor,
            trigger_analysis=True,
        )
        session.refresh(dataset)

        assert second.analysis_task_queued is True
        assert second.analysis_task_id == "new-task"
        assert dataset.file_path.endswith("/terrain.img")
        assert dataset.file_format == "img"
        assert dataset.analysis_status == "queued"
        assert dataset.analysis_task_id == "new-task"
        assert dataset.terrain_status == "pending"
        assert analysis_calls == [(dataset.id, actor.id)]
        assert set(driver.files) == {
            "/elevation/datasets/ELEV-IMPORT-001/terrain.img",
            "/elevation/datasets/ELEV-IMPORT-001/points.csv",
        }
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
