from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..models.atp_model import AtpModel, AtpModelVersion, AtpSimulationRun
from ..models.base import utcnow
from ..schemas.atp_model import (
    AtpEngineStatusResponse,
    AtpModelCreateRequest,
    AtpModelListResponse,
    AtpModelSummary,
    AtpModelUpdateRequest,
    AtpModelVersionCreateRequest,
    AtpModelVersionDetail,
    AtpModelVersionListResponse,
    AtpModelVersionSummary,
    AtpModelVersionUpdateRequest,
    AtpSimulationRunDetail,
    AtpSimulationRunListResponse,
    AtpSimulationRunRequest,
    AtpSimulationRunSummary,
)
from .push_service import publish_topic
from .legacy_atp_adapter import build_legacy_atp_status_checks
from .wine_probe import probe_wine_binary


settings = get_settings()
ATP_TOPIC = "admin.atp-models"
VALID_MODEL_STATUS = {"enabled", "disabled"}
VALID_VERSION_STATUS = {"draft", "released", "archived"}
LOG_MAX_CHARS = 200_000
FILENAME_SANITIZE_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


def _fire_and_forget(coro: Any) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        return
    loop.create_task(coro)


def _normalize_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_tags(values: list[str] | None) -> list[str]:
    if not values:
        return []
    dedup: dict[str, None] = {}
    for candidate in values:
        normalized = candidate.strip()
        if not normalized:
            continue
        dedup[normalized] = None
    return list(dedup.keys())[:128]


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="ignore")).hexdigest()


def _truncate_output(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) <= LOG_MAX_CHARS:
        return value
    return f"{value[:LOG_MAX_CHARS]}\n...[truncated]"


def _safe_entry_filename(raw_name: str | None, *, model_code: str, version_no: int) -> str:
    fallback = f"{model_code}_v{version_no}.atp"
    if not raw_name:
        return fallback

    filename = Path(raw_name).name.strip()
    if not filename:
        return fallback

    cleaned = FILENAME_SANITIZE_PATTERN.sub("_", filename)
    cleaned = cleaned.strip("._")
    if not cleaned:
        return fallback

    if len(cleaned) > 220:
        stem, suffix = os.path.splitext(cleaned)
        cleaned = f"{stem[:200]}{suffix[:20]}"

    return cleaned


def _resolve_timeout(payload_timeout: int | None) -> int:
    timeout_seconds = payload_timeout or settings.atp_engine_default_timeout_seconds
    if timeout_seconds > settings.atp_engine_max_timeout_seconds:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"timeout_seconds cannot exceed {settings.atp_engine_max_timeout_seconds}",
        )
    return timeout_seconds


def _resolve_engine_mode() -> str:
    mode = settings.atp_engine_mode.strip().lower()
    return "native" if mode == "native" else "wine"


def _resolve_storage_root() -> Path:
    root = Path(settings.atp_storage_root).expanduser()
    return root.resolve(strict=False)


def _resolve_engine_workdir() -> Path:
    configured = Path(settings.atp_engine_workdir).expanduser()
    if configured.is_absolute():
        return configured.resolve(strict=False)
    return (_resolve_storage_root() / configured).resolve(strict=False)


def _resolve_binary(raw_path: str) -> str | None:
    configured = raw_path.strip()
    if not configured:
        return None

    resolved = shutil.which(configured)
    if resolved:
        return resolved

    candidate = Path(configured).expanduser()
    if candidate.exists() and candidate.is_file() and os.access(candidate, os.X_OK):
        return str(candidate.resolve())
    return None


def _resolve_wine_engine_executable() -> tuple[str | None, str | None, str | None]:
    wine_binary = _resolve_binary(settings.wine_binary_path)
    if not wine_binary:
        return None, None, "Wine binary not found"

    allowed_root = Path(settings.wine_allowed_root).expanduser().resolve(strict=False)
    configured = Path(settings.atp_engine_executable).expanduser()
    if not configured.is_absolute():
        configured = (allowed_root / configured).resolve(strict=False)
    else:
        configured = configured.resolve(strict=False)

    if not configured.is_relative_to(allowed_root):
        return wine_binary, None, f"ATP engine executable must be inside {allowed_root}"
    if not configured.exists() or not configured.is_file():
        return wine_binary, None, f"ATP engine executable not found: {configured}"

    probe = probe_wine_binary(wine_binary)
    return wine_binary, str(configured), None if probe.available else (probe.error or "Wine binary unavailable")


def _resolve_native_engine_executable() -> tuple[str | None, str | None]:
    resolved = _resolve_binary(settings.atp_engine_executable)
    if not resolved:
        return None, "ATP engine executable not found"
    return resolved, None


def get_engine_status() -> AtpEngineStatusResponse:
    mode = _resolve_engine_mode()
    storage_root = str(_resolve_storage_root())
    workdir = str(_resolve_engine_workdir())
    checks = build_legacy_atp_status_checks()

    if mode == "wine":
        wine_binary, resolved_engine, error = _resolve_wine_engine_executable()
        available = error is None
        executable_path = settings.atp_engine_executable.strip()
        resolved_binary = f"{wine_binary} -> {resolved_engine}" if wine_binary and resolved_engine else wine_binary
        return AtpEngineStatusResponse(
            mode="wine",
            available=available,
            executable_path=executable_path,
            resolved_executable=resolved_binary,
            storage_root=storage_root,
            workdir=workdir,
            default_timeout_seconds=settings.atp_engine_default_timeout_seconds,
            max_timeout_seconds=settings.atp_engine_max_timeout_seconds,
            checks=checks,
            error=error,
        )

    resolved_engine, error = _resolve_native_engine_executable()
    return AtpEngineStatusResponse(
        mode="native",
        available=error is None,
        executable_path=settings.atp_engine_executable.strip(),
        resolved_executable=resolved_engine,
        storage_root=storage_root,
        workdir=workdir,
        default_timeout_seconds=settings.atp_engine_default_timeout_seconds,
        max_timeout_seconds=settings.atp_engine_max_timeout_seconds,
        checks=checks,
        error=error,
    )


def serialize_model(
    item: AtpModel,
    *,
    version_count: int,
    run_count: int,
    last_run_status: str | None,
    last_run_date,
) -> AtpModelSummary:
    return AtpModelSummary(
        id=item.id,
        code=item.code,
        name=item.name,
        source_type=item.source_type,  # type: ignore[arg-type]
        description=item.description,
        status=item.status,  # type: ignore[arg-type]
        tags_json=item.tags_json or [],
        latest_version_no=item.latest_version_no,
        active_version_no=item.active_version_no,
        version_count=version_count,
        run_count=run_count,
        last_run_status=last_run_status,  # type: ignore[arg-type]
        last_run_date=last_run_date,
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def serialize_version(item: AtpModelVersion) -> AtpModelVersionSummary:
    return AtpModelVersionSummary(
        id=item.id,
        model_id=item.model_id,
        version_no=item.version_no,
        version_tag=item.version_tag,
        status=item.status,  # type: ignore[arg-type]
        entry_file=item.entry_file,
        change_note=item.change_note,
        artifact_manifest_json=item.artifact_manifest_json or {},
        content_hash=item.content_hash,
        atp_text_size=len(item.atp_text or ""),
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def serialize_version_detail(item: AtpModelVersion) -> AtpModelVersionDetail:
    summary = serialize_version(item)
    return AtpModelVersionDetail(
        **summary.model_dump(),
        atp_text=item.atp_text or "",
        graph_json=item.graph_json or {},
    )


def serialize_run(item: AtpSimulationRun) -> AtpSimulationRunSummary:
    version_no = item.version.version_no if item.version is not None else None
    stdout_text = item.stdout_text or ""
    stderr_text = item.stderr_text or ""

    return AtpSimulationRunSummary(
        id=item.id,
        model_id=item.model_id,
        version_id=item.version_id,
        version_no=version_no,
        task_id=item.task_id,
        status=item.status,  # type: ignore[arg-type]
        engine_mode=item.engine_mode,  # type: ignore[arg-type]
        engine_command=item.engine_command,
        working_dir=item.working_dir,
        timeout_seconds=item.timeout_seconds,
        exit_code=item.exit_code,
        started_at=item.started_at,
        finished_at=item.finished_at,
        duration_ms=item.duration_ms,
        error_message=item.error_message,
        stdout_size=len(stdout_text),
        stderr_size=len(stderr_text),
        create_date=item.create_date,
        create_user=item.create_user,
    )


def serialize_run_detail(item: AtpSimulationRun) -> AtpSimulationRunDetail:
    summary = serialize_run(item)
    return AtpSimulationRunDetail(
        **summary.model_dump(),
        stdout_text=item.stdout_text,
        stderr_text=item.stderr_text,
    )


def list_models(
    db: Session,
    *,
    keyword: str | None,
    status_filter: str | None,
) -> AtpModelListResponse:
    stmt = select(AtpModel)
    total_stmt = select(func.count()).select_from(AtpModel)

    normalized_keyword = (keyword or "").strip()
    if normalized_keyword:
        like = f"%{normalized_keyword}%"
        predicate = or_(AtpModel.code.ilike(like), AtpModel.name.ilike(like), AtpModel.description.ilike(like))
        stmt = stmt.where(predicate)
        total_stmt = total_stmt.where(predicate)

    normalized_status = (status_filter or "").strip().lower()
    if normalized_status:
        if normalized_status not in VALID_MODEL_STATUS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status filter: {status_filter}")
        stmt = stmt.where(AtpModel.status == normalized_status)
        total_stmt = total_stmt.where(AtpModel.status == normalized_status)

    total = int(db.scalar(total_stmt) or 0)
    items = db.execute(stmt.order_by(AtpModel.update_date.desc(), AtpModel.code.asc())).scalars().all()
    model_ids = [item.id for item in items]

    version_count_map = _load_model_version_count_map(db, model_ids)
    run_count_map = _load_model_run_count_map(db, model_ids)
    last_run_map = _load_model_last_run_map(db, model_ids)

    return AtpModelListResponse(
        items=[
            serialize_model(
                item,
                version_count=version_count_map.get(item.id, 0),
                run_count=run_count_map.get(item.id, 0),
                last_run_status=last_run_map.get(item.id, (None, None))[0],
                last_run_date=last_run_map.get(item.id, (None, None))[1],
            )
            for item in items
        ],
        total=total,
    )


def get_model_by_id(db: Session, model_id: str) -> AtpModel | None:
    return db.execute(select(AtpModel).where(AtpModel.id == model_id)).scalar_one_or_none()


def get_model_by_code(db: Session, code: str) -> AtpModel | None:
    normalized = code.strip().lower()
    if not normalized:
        return None
    return db.execute(select(AtpModel).where(func.lower(AtpModel.code) == normalized)).scalar_one_or_none()


def create_model(
    db: Session,
    payload: AtpModelCreateRequest,
    *,
    actor_user_id: str,
) -> AtpModelSummary | None:
    if get_model_by_code(db, payload.code):
        return None

    now = utcnow()
    item = AtpModel(
        code=payload.code.strip(),
        name=payload.name.strip(),
        source_type=payload.source_type,
        description=payload.description.strip(),
        status=payload.status,
        tags_json=_normalize_tags(payload.tags_json),
        latest_version_no=0,
        active_version_no=None,
        create_user=actor_user_id,
        update_user=actor_user_id,
        create_date=now,
        update_date=now,
    )
    db.add(item)
    db.commit()

    saved = get_model_by_id(db, item.id)
    if not saved:
        return None

    _publish_change("model.created", {"action": "created", "model_id": saved.id})
    return serialize_model(saved, version_count=0, run_count=0, last_run_status=None, last_run_date=None)


def update_model(
    db: Session,
    model_id: str,
    payload: AtpModelUpdateRequest,
    *,
    actor_user_id: str,
) -> AtpModelSummary | None:
    item = get_model_by_id(db, model_id)
    if not item:
        return None

    update_data = payload.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"] is not None:
        item.name = str(update_data["name"]).strip()
    if "source_type" in update_data and update_data["source_type"] is not None:
        item.source_type = str(update_data["source_type"])
    if "description" in update_data and update_data["description"] is not None:
        item.description = str(update_data["description"]).strip()
    if "status" in update_data and update_data["status"] is not None:
        item.status = str(update_data["status"])
    if "tags_json" in update_data:
        item.tags_json = _normalize_tags(update_data["tags_json"])

    item.update_user = actor_user_id
    item.update_date = utcnow()
    db.commit()

    saved = get_model_by_id(db, model_id)
    if not saved:
        return None

    version_count = _load_model_version_count_map(db, [saved.id]).get(saved.id, 0)
    run_count = _load_model_run_count_map(db, [saved.id]).get(saved.id, 0)
    last_run_status, last_run_date = _load_model_last_run_map(db, [saved.id]).get(saved.id, (None, None))
    _publish_change("model.updated", {"action": "updated", "model_id": saved.id})
    return serialize_model(
        saved,
        version_count=version_count,
        run_count=run_count,
        last_run_status=last_run_status,
        last_run_date=last_run_date,
    )


def delete_model(db: Session, model_id: str) -> bool:
    item = get_model_by_id(db, model_id)
    if not item:
        return False

    db.delete(item)
    db.commit()
    _publish_change("model.deleted", {"action": "deleted", "model_id": model_id})
    return True


def list_model_versions(
    db: Session,
    *,
    model_id: str,
    limit: int,
    offset: int,
) -> AtpModelVersionListResponse:
    total = int(
        db.scalar(
            select(func.count())
            .select_from(AtpModelVersion)
            .where(AtpModelVersion.model_id == model_id)
        )
        or 0
    )
    items = db.execute(
        select(AtpModelVersion)
        .where(AtpModelVersion.model_id == model_id)
        .order_by(AtpModelVersion.version_no.desc(), AtpModelVersion.id.desc())
        .offset(offset)
        .limit(limit)
    ).scalars().all()

    return AtpModelVersionListResponse(items=[serialize_version(item) for item in items], total=total)


def get_model_version_by_id(db: Session, *, model_id: str, version_id: str) -> AtpModelVersion | None:
    return db.execute(
        select(AtpModelVersion).where(
            AtpModelVersion.model_id == model_id,
            AtpModelVersion.id == version_id,
        )
    ).scalar_one_or_none()


def create_model_version(
    db: Session,
    *,
    model_id: str,
    payload: AtpModelVersionCreateRequest,
    actor_user_id: str,
) -> AtpModelVersionDetail:
    model = get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    max_version_no = int(
        db.scalar(
            select(func.max(AtpModelVersion.version_no)).where(AtpModelVersion.model_id == model_id)
        )
        or 0
    )
    next_version_no = max_version_no + 1
    now = utcnow()
    content = payload.atp_text

    item = AtpModelVersion(
        model_id=model_id,
        version_no=next_version_no,
        version_tag=_normalize_optional_str(payload.version_tag),
        status=payload.status,
        entry_file=_normalize_optional_str(payload.entry_file),
        change_note=payload.change_note.strip(),
        artifact_manifest_json=payload.artifact_manifest_json,
        graph_json=payload.graph_json,
        atp_text=content,
        content_hash=_hash_text(content),
        create_user=actor_user_id,
        update_user=actor_user_id,
        create_date=now,
        update_date=now,
    )
    db.add(item)

    model.latest_version_no = max(model.latest_version_no, next_version_no)
    if model.active_version_no is None and payload.status != "archived":
        model.active_version_no = next_version_no
    model.update_user = actor_user_id
    model.update_date = now

    db.commit()

    saved = get_model_version_by_id(db, model_id=model_id, version_id=item.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Version save failed")

    _publish_change(
        "version.created",
        {
            "action": "version_created",
            "model_id": model_id,
            "version_id": saved.id,
            "version_no": saved.version_no,
        },
    )
    return serialize_version_detail(saved)


def update_model_version(
    db: Session,
    *,
    model_id: str,
    version_id: str,
    payload: AtpModelVersionUpdateRequest,
    actor_user_id: str,
) -> AtpModelVersionDetail:
    item = get_model_version_by_id(db, model_id=model_id, version_id=version_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")

    model = get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    update_data = payload.model_dump(exclude_unset=True)

    if "version_tag" in update_data:
        item.version_tag = _normalize_optional_str(update_data["version_tag"])
    if "status" in update_data and update_data["status"] is not None:
        item.status = str(update_data["status"])
    if "entry_file" in update_data:
        item.entry_file = _normalize_optional_str(update_data["entry_file"])
    if "change_note" in update_data and update_data["change_note"] is not None:
        item.change_note = str(update_data["change_note"]).strip()
    if "artifact_manifest_json" in update_data and update_data["artifact_manifest_json"] is not None:
        item.artifact_manifest_json = dict(update_data["artifact_manifest_json"])
    if "graph_json" in update_data and update_data["graph_json"] is not None:
        item.graph_json = dict(update_data["graph_json"])
    if "atp_text" in update_data and update_data["atp_text"] is not None:
        content = str(update_data["atp_text"])
        item.atp_text = content
        item.content_hash = _hash_text(content)

    now = utcnow()
    item.update_user = actor_user_id
    item.update_date = now

    if item.status == "archived" and model.active_version_no == item.version_no:
        model.active_version_no = None
    model.latest_version_no = max(model.latest_version_no, item.version_no)
    model.update_user = actor_user_id
    model.update_date = now

    db.commit()

    saved = get_model_version_by_id(db, model_id=model_id, version_id=version_id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Version load failed")

    _publish_change(
        "version.updated",
        {
            "action": "version_updated",
            "model_id": model_id,
            "version_id": saved.id,
            "version_no": saved.version_no,
        },
    )
    return serialize_version_detail(saved)


def activate_model_version(
    db: Session,
    *,
    model_id: str,
    version_id: str,
    actor_user_id: str,
) -> AtpModelSummary:
    model = get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    version = get_model_version_by_id(db, model_id=model_id, version_id=version_id)
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    if version.status == "archived":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archived version cannot be activated")

    model.active_version_no = version.version_no
    model.latest_version_no = max(model.latest_version_no, version.version_no)
    model.update_user = actor_user_id
    model.update_date = utcnow()

    db.commit()

    version_count = _load_model_version_count_map(db, [model.id]).get(model.id, 0)
    run_count = _load_model_run_count_map(db, [model.id]).get(model.id, 0)
    last_run_status, last_run_date = _load_model_last_run_map(db, [model.id]).get(model.id, (None, None))

    _publish_change(
        "version.activated",
        {
            "action": "version_activated",
            "model_id": model.id,
            "version_id": version.id,
            "version_no": version.version_no,
        },
    )
    return serialize_model(
        model,
        version_count=version_count,
        run_count=run_count,
        last_run_status=last_run_status,
        last_run_date=last_run_date,
    )


def list_model_runs(
    db: Session,
    *,
    model_id: str,
    limit: int,
    offset: int,
) -> AtpSimulationRunListResponse:
    total = int(
        db.scalar(
            select(func.count())
            .select_from(AtpSimulationRun)
            .where(AtpSimulationRun.model_id == model_id)
        )
        or 0
    )

    runs = db.execute(
        select(AtpSimulationRun)
        .where(AtpSimulationRun.model_id == model_id)
        .order_by(AtpSimulationRun.create_date.desc(), AtpSimulationRun.id.desc())
        .offset(offset)
        .limit(limit)
    ).scalars().all()

    return AtpSimulationRunListResponse(items=[serialize_run(item) for item in runs], total=total)


def get_model_run_by_id(db: Session, *, model_id: str, run_id: str) -> AtpSimulationRun | None:
    return db.execute(
        select(AtpSimulationRun).where(
            AtpSimulationRun.model_id == model_id,
            AtpSimulationRun.id == run_id,
        )
    ).scalar_one_or_none()


def get_model_run_detail(db: Session, *, model_id: str, run_id: str) -> AtpSimulationRunDetail:
    run = get_model_run_by_id(db, model_id=model_id, run_id=run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return serialize_run_detail(run)


def run_model_version(
    db: Session,
    *,
    model_id: str,
    payload: AtpSimulationRunRequest,
    actor_user_id: str,
) -> AtpSimulationRunDetail:
    model = get_model_by_id(db, model_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    version = _resolve_target_version(db, model=model, payload=payload)
    timeout_seconds = _resolve_timeout(payload.timeout_seconds)

    run = AtpSimulationRun(
        model_id=model.id,
        version_id=version.id,
        status="pending",
        engine_mode=_resolve_engine_mode(),
        timeout_seconds=timeout_seconds,
        create_user=actor_user_id,
        update_user=actor_user_id,
    )
    db.add(run)
    db.flush()
    run.update_date = utcnow()
    db.commit()

    if payload.dry_run:
        execute_model_run_job(
            run_id=run.id,
            payload_data=payload.model_dump(),
            actor_user_id=actor_user_id,
        )
        db.expire_all()
    else:
        try:
            task = _dispatch_atp_model_run_task(
                run_id=run.id,
                payload_data=payload.model_dump(),
                actor_user_id=actor_user_id,
            )
        except Exception as exc:
            _mark_run_failed(
                db,
                run=run,
                actor_user_id=actor_user_id,
                reason=f"Celery dispatch failed: {exc}",
            )
            saved = get_model_run_by_id(db, model_id=model.id, run_id=run.id)
            if not saved:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Run save failed") from exc
            return serialize_run_detail(saved)
        run.task_id = str(task.id)
        run.update_date = utcnow()
        run.update_user = actor_user_id
        db.commit()

        _publish_change(
            "run.queued",
            {
                "action": "run_queued",
                "model_id": model.id,
                "version_id": version.id,
                "run_id": run.id,
                "task_id": run.task_id,
            },
        )

    saved = get_model_run_by_id(db, model_id=model.id, run_id=run.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Run save failed")
    return serialize_run_detail(saved)


def execute_model_run_job(
    *,
    run_id: str,
    payload_data: dict[str, Any],
    actor_user_id: str | None,
) -> None:
    from ..core.database import SessionLocal

    db = SessionLocal()
    try:
        run = db.execute(select(AtpSimulationRun).where(AtpSimulationRun.id == run_id)).scalar_one_or_none()
        if run is None or run.status in {"success", "failed"}:
            return

        model = get_model_by_id(db, run.model_id)
        if model is None:
            return

        if run.version_id is None:
            _mark_run_failed(
                db,
                run=run,
                actor_user_id=actor_user_id,
                reason="Version not found",
            )
            return

        version = get_model_version_by_id(db, model_id=model.id, version_id=run.version_id)
        if version is None:
            _mark_run_failed(
                db,
                run=run,
                actor_user_id=actor_user_id,
                reason="Version not found",
            )
            return

        payload = AtpSimulationRunRequest.model_validate(payload_data)
        run.started_at = utcnow()
        run.status = "running"
        run.error_message = None
        run.finished_at = None
        run.duration_ms = None
        run.update_date = utcnow()
        run.update_user = actor_user_id

        command, working_dir, error = _build_run_command(model=model, version=version, run=run, payload=payload)
        run.engine_command = " ".join(command) if command else None
        run.working_dir = str(working_dir) if working_dir else None

        if error:
            _mark_run_failed(db, run=run, actor_user_id=actor_user_id, reason=error)
            return

        if payload.dry_run:
            run.status = "success"
            run.exit_code = 0
            run.stdout_text = json.dumps(
                {
                    "dry_run": True,
                    "command": command,
                    "working_dir": str(working_dir),
                    "timeout_seconds": run.timeout_seconds,
                },
                ensure_ascii=False,
                indent=2,
            )
            run.stderr_text = ""
            run.finished_at = utcnow()
            run.duration_ms = 0
            run.update_user = actor_user_id
            run.update_date = utcnow()
            db.commit()
            _publish_change(
                "run.finished",
                {
                    "action": "run_dry_finished",
                    "model_id": model.id,
                    "version_id": version.id,
                    "run_id": run.id,
                    "status": run.status,
                },
            )
            return

        db.commit()

        env = os.environ.copy()
        env.update(payload.environment)
        started_perf = time.perf_counter()
        try:
            result = subprocess.run(
                command,
                cwd=str(working_dir),
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=run.timeout_seconds,
                check=False,
            )
            run.exit_code = result.returncode
            run.stdout_text = _truncate_output(result.stdout)
            run.stderr_text = _truncate_output(result.stderr)
            if result.returncode == 0:
                run.status = "success"
                run.error_message = None
            else:
                run.status = "failed"
                run.error_message = f"ATP engine exited with code {result.returncode}"
        except subprocess.TimeoutExpired as exc:
            run.status = "failed"
            run.exit_code = None
            run.stdout_text = _truncate_output((exc.stdout or "") if isinstance(exc.stdout, str) else "")
            run.stderr_text = _truncate_output((exc.stderr or "") if isinstance(exc.stderr, str) else "")
            run.error_message = f"Execution timed out after {run.timeout_seconds} seconds"
        except OSError as exc:
            run.status = "failed"
            run.exit_code = None
            run.stdout_text = None
            run.stderr_text = None
            run.error_message = str(exc)

        run.duration_ms = max(int((time.perf_counter() - started_perf) * 1000), 0)
        run.finished_at = utcnow()
        run.update_user = actor_user_id
        run.update_date = utcnow()
        db.commit()
        _publish_change(
            "run.finished",
            {
                "action": "run_finished",
                "model_id": model.id,
                "version_id": version.id,
                "run_id": run.id,
                "status": run.status,
                "exit_code": run.exit_code,
            },
        )
    finally:
        db.close()


def _dispatch_atp_model_run_task(*, run_id: str, payload_data: dict[str, Any], actor_user_id: str | None):
    from ..tasks.atp_model_tasks import execute_atp_model_run_job

    return execute_atp_model_run_job.delay(run_id, payload_data, actor_user_id)


def _mark_run_failed(
    db: Session,
    *,
    run: AtpSimulationRun,
    actor_user_id: str | None,
    reason: str,
) -> None:
    run.status = "failed"
    run.error_message = reason
    run.finished_at = utcnow()
    run.duration_ms = 0 if run.duration_ms is None else run.duration_ms
    run.update_user = actor_user_id
    run.update_date = utcnow()
    db.commit()
    _publish_change(
        "run.failed",
        {
            "action": "run_failed",
            "model_id": run.model_id,
            "version_id": run.version_id,
            "run_id": run.id,
            "reason": reason,
        },
    )


def _resolve_target_version(db: Session, *, model: AtpModel, payload: AtpSimulationRunRequest) -> AtpModelVersion:
    if payload.version_id:
        matched = get_model_version_by_id(db, model_id=model.id, version_id=payload.version_id)
        if not matched:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
        return matched

    if payload.version_no is not None:
        matched = db.execute(
            select(AtpModelVersion).where(
                AtpModelVersion.model_id == model.id,
                AtpModelVersion.version_no == payload.version_no,
            )
        ).scalar_one_or_none()
        if not matched:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
        return matched

    if model.active_version_no is not None:
        matched = db.execute(
            select(AtpModelVersion).where(
                AtpModelVersion.model_id == model.id,
                AtpModelVersion.version_no == model.active_version_no,
            )
        ).scalar_one_or_none()
        if matched is not None:
            return matched

    matched = db.execute(
        select(AtpModelVersion)
        .where(AtpModelVersion.model_id == model.id)
        .order_by(AtpModelVersion.version_no.desc(), AtpModelVersion.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    if not matched:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No version available for simulation")
    return matched


def _build_run_command(
    *,
    model: AtpModel,
    version: AtpModelVersion,
    run: AtpSimulationRun,
    payload: AtpSimulationRunRequest,
) -> tuple[list[str] | None, Path | None, str | None]:
    storage_root = _resolve_storage_root()
    workdir_base = _resolve_engine_workdir()

    try:
        storage_root.mkdir(parents=True, exist_ok=True)
        workdir_base.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return None, None, f"Failed to prepare ATP storage directory: {exc}"

    run_dir = workdir_base / model.code / f"v{version.version_no}" / run.id
    try:
        run_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return None, None, f"Failed to prepare run directory: {exc}"

    entry_filename = _safe_entry_filename(version.entry_file, model_code=model.code, version_no=version.version_no)
    input_path = run_dir / entry_filename

    try:
        input_path.write_text(version.atp_text or "", encoding="utf-8")
    except OSError as exc:
        return None, run_dir, f"Failed to write ATP input file: {exc}"

    mode = _resolve_engine_mode()
    extra_args = [arg for arg in payload.extra_args if arg]

    if mode == "wine":
        wine_binary, resolved_engine, error = _resolve_wine_engine_executable()
        if error or not wine_binary or not resolved_engine:
            return None, run_dir, error or "Wine ATP engine unavailable"
        command = [wine_binary, resolved_engine, str(input_path), *extra_args]
        return command, run_dir, None

    resolved_engine, error = _resolve_native_engine_executable()
    if error or not resolved_engine:
        return None, run_dir, error or "Native ATP engine unavailable"
    command = [resolved_engine, str(input_path), *extra_args]
    return command, run_dir, None


def _load_model_version_count_map(db: Session, model_ids: list[str]) -> dict[str, int]:
    if not model_ids:
        return {}
    rows = db.execute(
        select(AtpModelVersion.model_id, func.count())
        .where(AtpModelVersion.model_id.in_(model_ids))
        .group_by(AtpModelVersion.model_id)
    ).all()
    return {str(model_id): int(count) for model_id, count in rows}


def _load_model_run_count_map(db: Session, model_ids: list[str]) -> dict[str, int]:
    if not model_ids:
        return {}
    rows = db.execute(
        select(AtpSimulationRun.model_id, func.count())
        .where(AtpSimulationRun.model_id.in_(model_ids))
        .group_by(AtpSimulationRun.model_id)
    ).all()
    return {str(model_id): int(count) for model_id, count in rows}


def _load_model_last_run_map(db: Session, model_ids: list[str]) -> dict[str, tuple[str | None, Any]]:
    if not model_ids:
        return {}

    rows = db.execute(
        select(AtpSimulationRun)
        .where(AtpSimulationRun.model_id.in_(model_ids))
        .order_by(AtpSimulationRun.model_id.asc(), AtpSimulationRun.create_date.desc(), AtpSimulationRun.id.desc())
    ).scalars().all()

    result: dict[str, tuple[str | None, Any]] = {}
    for row in rows:
        if row.model_id in result:
            continue
        result[row.model_id] = (row.status, row.create_date)
    return result


def _publish_change(event_name: str, payload: dict[str, Any]) -> None:
    _fire_and_forget(
        publish_topic(
            ATP_TOPIC,
            name=event_name,
            payload=payload,
            requires_refetch=[],
            dedupe_key=f"atp:{event_name}:{payload.get('model_id', '-')}:"
            f"{payload.get('version_id', payload.get('run_id', '-'))}",
        )
    )
