from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core import database as core_database
from app.core.config import get_settings
from app.core.database import Base
from app.models.atp_model import AtpModel, AtpModelVersion, AtpSimulationRun
from app.schemas.atp_model import AtpSimulationRunRequest
from app.services import atp_model_service


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


def test_run_model_version_dry_run_records_worker_command(monkeypatch, tmp_path) -> None:
    testing_session = _build_sessionmaker()
    monkeypatch.setattr(core_database, "SessionLocal", testing_session)
    monkeypatch.setattr(atp_model_service, "_publish_change", lambda *args, **kwargs: None)
    monkeypatch.setattr(atp_model_service, "_resolve_storage_root", lambda: tmp_path / "storage")
    monkeypatch.setattr(atp_model_service, "_resolve_engine_workdir", lambda: tmp_path / "runs")
    monkeypatch.setattr(
        atp_model_service,
        "_resolve_wine_engine_executable",
        lambda: ("/usr/bin/wine", "/tmp/tpbig.exe", None),
    )

    session: Session = testing_session()
    try:
        model = AtpModel(
            code="ATP-DRY-001",
            name="Dry Run ATP",
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
            entry_file="case.atp",
            atp_text="BEGIN ATP CASE",
            content_hash="dry-hash-v1",
        )
        session.add(version)
        session.commit()

        result = atp_model_service.run_model_version(
            session,
            model_id=model.id,
            payload=AtpSimulationRunRequest(version_id=version.id, dry_run=True),
            actor_user_id="tester",
        )

        assert result.status == "success"
        assert result.engine_command is not None
        assert result.engine_command.startswith("/usr/bin/wine /tmp/tpbig.exe ")
        assert result.engine_command.endswith("/case.atp")
        assert result.working_dir is not None
        assert result.stdout_text is not None

        saved = session.execute(select(AtpSimulationRun).where(AtpSimulationRun.id == result.id)).scalar_one()
        assert saved.status == "success"
        assert saved.exit_code == 0
        assert saved.error_message is None
        assert "dry_run" in (saved.stdout_text or "")
    finally:
        session.close()


def test_get_engine_status_includes_legacy_asset_checks(monkeypatch, tmp_path) -> None:
    allowed_root = tmp_path / "wine-root"
    template_root = allowed_root / "ATP" / "templates"
    template_root.mkdir(parents=True)
    (template_root / "EGM").mkdir()
    (allowed_root / "ATP").mkdir(exist_ok=True)
    (allowed_root / "ATP" / "tpbig.exe").write_text("binary", encoding="utf-8")
    (allowed_root / "ATP" / "rjtzl.exe").write_text("binary", encoding="utf-8")

    settings = get_settings()
    monkeypatch.setattr(settings, "wine_allowed_root", str(allowed_root))
    monkeypatch.setattr(settings, "atp_legacy_root", str(allowed_root / "ATP"))
    monkeypatch.setattr(settings, "atp_template_root", str(template_root))
    monkeypatch.setattr(settings, "atp_run_root", str(allowed_root / "runs"))
    monkeypatch.setattr(settings, "atp_tpbig_executable", "ATP/tpbig.exe")
    monkeypatch.setattr(settings, "atp_rjtzl_executable", "ATP/rjtzl.exe")
    monkeypatch.setattr(atp_model_service, "_resolve_wine_engine_executable", lambda: ("/usr/bin/wine", "/tmp/tpbig.exe", None))

    result = atp_model_service.get_engine_status()

    assert "legacy_root" in result.checks
    assert result.checks["legacy_root"]["available"] is True
    assert result.checks["tpbig_executable"]["available"] is True
    assert result.checks["rjtzl_executable"]["available"] is True
    assert result.checks["egm_subdir"]["available"] is True
