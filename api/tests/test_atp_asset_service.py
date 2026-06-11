from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core import database as core_database
from app.core.database import Base
from app.models.atp_asset import AtpAsset, AtpAssetRelease, AtpAssetRun
from app.models.file_storage import FileIndexEntry, FileStorageBackend, FileStorageMount
from app.models.user import User
from app.schemas.atp_asset import AtpAssetCreateRequest, AtpAssetReleaseCreateRequest, AtpAssetRunRequest
from app.services import atp_asset_service


def _build_sessionmaker():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(
        bind=engine,
        tables=[
            FileStorageBackend.__table__,
            FileStorageMount.__table__,
            FileIndexEntry.__table__,
            User.__table__,
            AtpAsset.__table__,
            AtpAssetRelease.__table__,
            AtpAssetRun.__table__,
        ],
    )
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


def _seed_vfs_mount(session: Session, *, root_dir: Path) -> None:
    backend = FileStorageBackend(
        code="main",
        name="Main VFS",
        driver_type="VFS",
        status="enabled",
        is_default=True,
        config_json={"root_dir": str(root_dir)},
    )
    session.add(backend)
    session.flush()
    session.add(
        FileStorageMount(
            code="main",
            name="Main Mount",
            backend_id=backend.id,
            mount_path="/",
            root_path="/",
            is_enabled=True,
        )
    )
    session.commit()


def test_create_release_auto_detects_entry_file_and_manifest(tmp_path) -> None:
    testing_session = _build_sessionmaker()
    session: Session = testing_session()
    try:
        release_root = tmp_path / "vfs" / "atp-library" / "demo-release"
        release_root.mkdir(parents=True)
        (release_root / "work.atp").write_text("ATP INPUT", encoding="utf-8")
        (release_root / "README.txt").write_text("docs", encoding="utf-8")

        _seed_vfs_mount(session, root_dir=tmp_path / "vfs")
        asset = atp_asset_service.create_asset(
            session,
            AtpAssetCreateRequest(code="ATP-ASSET-001", name="目录化ATP资产"),
            actor_user_id="tester",
        )
        assert asset is not None

        created = atp_asset_service.create_release(
            session,
            asset_id=asset.id,
            payload=AtpAssetReleaseCreateRequest(
                voltage_level="220",
                tower_type="sihuita",
                scene_type="raoji3",
                runner_kind="atp",
                storage_mount_code="main",
                storage_root_path="/atp-library/demo-release",
            ),
            actor_user_id="tester",
        )

        assert created.entry_file == "work.atp"
        assert created.is_active is True
        assert created.manifest_json["file_count"] == 2
        assert created.validation_json["entry_file_exists"] is True
    finally:
        session.close()


def test_run_release_dry_run_materializes_directory(tmp_path, monkeypatch) -> None:
    testing_session = _build_sessionmaker()
    monkeypatch.setattr(core_database, "SessionLocal", testing_session)
    session: Session = testing_session()
    try:
        release_root = tmp_path / "vfs" / "atp-library" / "runtime-release"
        release_root.mkdir(parents=True)
        (release_root / "work.atp").write_text("ATP INPUT", encoding="utf-8")
        (release_root / "tpbig.exe").write_text("binary", encoding="utf-8")

        _seed_vfs_mount(session, root_dir=tmp_path / "vfs")
        asset = atp_asset_service.create_asset(
            session,
            AtpAssetCreateRequest(code="ATP-ASSET-DRY", name="Dry Run 资产"),
            actor_user_id="tester",
        )
        assert asset is not None
        release = atp_asset_service.create_release(
            session,
            asset_id=asset.id,
            payload=AtpAssetReleaseCreateRequest(
                voltage_level="500",
                tower_type="ganzi",
                scene_type="fanji",
                runner_kind="atp",
                storage_mount_code="main",
                storage_root_path="/atp-library/runtime-release",
            ),
            actor_user_id="tester",
        )

        allowed_root = tmp_path / "wine-root"
        allowed_root.mkdir(parents=True)
        monkeypatch.setattr(atp_asset_service.settings, "wine_allowed_root", str(allowed_root))
        monkeypatch.setattr(atp_asset_service.settings, "atp_engine_mode", "wine")
        monkeypatch.setattr(atp_asset_service, "_resolve_binary", lambda value: "/usr/bin/wine" if value == "wine" else None)
        monkeypatch.setattr(atp_asset_service, "_publish_change", lambda *args, **kwargs: None)

        result = atp_asset_service.run_release(
            session,
            release_id=release.id,
            payload=AtpAssetRunRequest(dry_run=True),
            actor_user_id="tester",
        )

        assert result.status == "success"
        assert result.engine_command is not None
        assert "tpbig.exe" in result.engine_command
        assert result.materialized_root_path is not None
        materialized_root = Path(result.materialized_root_path)
        assert materialized_root.exists()
        assert (materialized_root / "work.atp").exists()
        assert result.output_manifest_json["file_count"] >= 2
    finally:
        session.close()
