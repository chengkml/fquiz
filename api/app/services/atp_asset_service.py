from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..core.config import get_settings
from ..models.atp_asset import AtpAsset, AtpAssetRelease, AtpAssetRun
from ..models.base import utcnow
from ..models.file_storage import FileStorageMount
from ..schemas.atp_asset import (
    AtpAssetCreateRequest,
    AtpAssetDetail,
    AtpAssetFileEntry,
    AtpAssetFileListResponse,
    AtpAssetListResponse,
    AtpAssetReleaseCreateRequest,
    AtpAssetReleaseDetail,
    AtpAssetReleaseListResponse,
    AtpAssetReleaseSummary,
    AtpAssetReleaseUpdateRequest,
    AtpAssetRunDetail,
    AtpAssetRunListResponse,
    AtpAssetRunRequest,
    AtpAssetRunSummary,
    AtpAssetSummary,
    AtpAssetUpdateRequest,
)
from .push_service import publish_topic
from .storage_driver import (
    StorageDriver,
    StorageDriverError,
    StorageInvalidPathError,
    StorageObject,
    StoragePathNotFoundError,
    build_storage_driver,
    normalize_virtual_path,
)


settings = get_settings()
ATP_ASSET_TOPIC = "admin.atp-assets"
VALID_ASSET_STATUS = {"draft", "enabled", "disabled", "archived"}
VALID_RELEASE_STATUS = {"draft", "released", "archived"}
VALID_RUNNER_KIND = {"atp", "egm", "hybrid"}
VALID_RUN_STATUS = {"pending", "running", "success", "failed"}
LOG_MAX_CHARS = 200_000


@dataclass(slots=True)
class StorageTree:
    files: list[StorageObject]
    directories: list[str]
    file_paths: set[str]
    dir_paths: set[str]
    max_depth: int


@dataclass(slots=True)
class CommandStep:
    label: str
    command: list[str]
    cwd: Path


@dataclass(slots=True)
class MaterializedRelease:
    payload_root: Path
    working_dir: Path
    command_steps: list[CommandStep]


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


def _normalize_relative_path(value: str | None) -> str | None:
    normalized = _normalize_optional_str(value)
    if normalized is None:
        return None
    candidate = normalized.replace("\\", "/").strip("/")
    if not candidate or candidate in {".", ".."}:
        return None
    parts: list[str] = []
    for part in candidate.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Relative path cannot escape release root")
        parts.append(part)
    return "/".join(parts) or None


def _hash_payload(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _truncate_output(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) <= LOG_MAX_CHARS:
        return value
    return f"{value[:LOG_MAX_CHARS]}\n...[truncated]"


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


def _resolve_mount(db: Session, mount_code: str) -> FileStorageMount:
    mount = db.execute(
        select(FileStorageMount)
        .options(joinedload(FileStorageMount.backend))
        .where(
            FileStorageMount.code == mount_code,
            FileStorageMount.is_enabled.is_(True),
        )
    ).scalar_one_or_none()
    if not mount:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Storage mount not found: {mount_code}")
    return mount


def _build_driver_or_400(mount: FileStorageMount) -> StorageDriver:
    try:
        return build_storage_driver(mount.backend, mount)
    except StorageDriverError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


def _relative_from_root(root_path: str, path: str) -> str:
    normalized_root = normalize_virtual_path(root_path).rstrip("/")
    normalized_path = normalize_virtual_path(path)
    if not normalized_root or normalized_root == "/":
        return normalized_path.lstrip("/")
    return normalized_path[len(normalized_root) + 1 :]


def _walk_storage_tree(driver: StorageDriver, root_path: str) -> StorageTree:
    normalized_root = normalize_virtual_path(root_path)
    stack: list[tuple[str, int]] = [(normalized_root, 0)]
    files: list[StorageObject] = []
    directories: list[str] = []
    file_paths: set[str] = set()
    dir_paths: set[str] = set()
    max_depth = 0

    while stack:
        current_path, depth = stack.pop()
        max_depth = max(max_depth, depth)
        try:
            entries = driver.list_dir(current_path)
        except StoragePathNotFoundError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        except StorageInvalidPathError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except StorageDriverError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

        for entry in entries:
            relative_path = _relative_from_root(normalized_root, entry.path)
            if not relative_path:
                continue
            normalized_relative = relative_path.replace("\\", "/")
            if entry.is_dir:
                directories.append(normalized_relative)
                dir_paths.add(normalized_relative)
                stack.append((entry.path, depth + 1))
                continue
            files.append(entry)
            file_paths.add(normalized_relative)

    files.sort(key=lambda item: _relative_from_root(normalized_root, item.path))
    directories.sort()
    return StorageTree(
        files=files,
        directories=directories,
        file_paths=file_paths,
        dir_paths=dir_paths,
        max_depth=max_depth,
    )


def _auto_detect_entry_file(tree: StorageTree) -> str | None:
    preferred = "work.atp"
    if preferred in tree.file_paths:
        return preferred
    atp_files = [path for path in tree.file_paths if path.lower().endswith(".atp")]
    if len(atp_files) == 1:
        return atp_files[0]
    return None


def _auto_detect_egm_subdir(tree: StorageTree) -> str | None:
    candidates = [path for path in tree.dir_paths if path.lower().endswith("/egm") or path.lower() == "egm"]
    if not candidates:
        return None
    candidates.sort(key=len)
    return candidates[0]


def _assert_script_path(path: str | None, *, tree: StorageTree, field_name: str) -> str | None:
    normalized = _normalize_relative_path(path)
    if normalized is None:
        return None
    if not normalized.lower().endswith(".py"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} only supports .py scripts")
    if normalized not in tree.file_paths:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} not found: {normalized}")
    return normalized


def _prepare_release_payload(
    db: Session,
    *,
    storage_mount_code: str,
    storage_root_path: str,
    runner_kind: str,
    voltage_level: str,
    tower_type: str,
    scene_type: str,
    release_tag: str | None,
    scenario_code: str | None,
    entry_file: str | None,
    result_file: str | None,
    egm_subdir: str | None,
    egm_result_file: str | None,
    preprocess_script: str | None,
    postprocess_script: str | None,
) -> dict[str, Any]:
    if runner_kind not in VALID_RUNNER_KIND:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported runner_kind: {runner_kind}")

    mount = _resolve_mount(db, storage_mount_code)
    driver = _build_driver_or_400(mount)
    normalized_root_path = normalize_virtual_path(storage_root_path)
    tree = _walk_storage_tree(driver, normalized_root_path)

    normalized_entry = _normalize_relative_path(entry_file)
    normalized_result = _normalize_relative_path(result_file)
    normalized_egm_subdir = _normalize_relative_path(egm_subdir)
    normalized_egm_result = _normalize_relative_path(egm_result_file)
    normalized_preprocess = _assert_script_path(preprocess_script, tree=tree, field_name="preprocess_script")
    normalized_postprocess = _assert_script_path(postprocess_script, tree=tree, field_name="postprocess_script")

    warnings: list[str] = []
    detected_entry = _auto_detect_entry_file(tree)
    if normalized_entry is None and runner_kind in {"atp", "hybrid"}:
        normalized_entry = detected_entry
    if normalized_entry is None and runner_kind in {"atp", "hybrid"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="entry_file is required for ATP and hybrid releases")
    if normalized_entry is not None and normalized_entry not in tree.file_paths:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"entry_file not found: {normalized_entry}")

    detected_egm_subdir = _auto_detect_egm_subdir(tree)
    if normalized_egm_subdir is None and runner_kind in {"egm", "hybrid"}:
        normalized_egm_subdir = detected_egm_subdir
    if normalized_egm_subdir is not None and normalized_egm_subdir not in tree.dir_paths:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"egm_subdir not found: {normalized_egm_subdir}")
    if runner_kind in {"egm", "hybrid"} and normalized_egm_subdir is None:
        warnings.append("未检测到 EGM 子目录；EGM/HYBRID 运行时将以 release 根目录作为工作目录。")

    if normalized_result is not None and normalized_result not in tree.file_paths:
        warnings.append(f"result_file 当前不存在，将在运行结束后按 {normalized_result} 查找。")
    if normalized_egm_result is not None and normalized_egm_result not in tree.file_paths:
        warnings.append(f"egm_result_file 当前不存在，将在运行结束后按 {normalized_egm_result} 查找。")
    if detected_entry and normalized_entry and detected_entry != normalized_entry:
        warnings.append(f"自动检测入口文件为 {detected_entry}，当前使用手工指定的 {normalized_entry}。")

    manifest_json = {
        "file_count": len(tree.files),
        "directory_count": len(tree.directories),
        "max_depth": tree.max_depth,
        "sample_files": [_relative_from_root(normalized_root_path, item.path) for item in tree.files[:20]],
        "detected_entry_file": detected_entry,
        "detected_egm_subdir": detected_egm_subdir,
        "storage_mount_code": mount.code,
        "storage_root_path": normalized_root_path,
    }
    validation_json = {
        "entry_file_exists": normalized_entry in tree.file_paths if normalized_entry else False,
        "egm_subdir_exists": normalized_egm_subdir in tree.dir_paths if normalized_egm_subdir else False,
        "preprocess_script_exists": normalized_preprocess in tree.file_paths if normalized_preprocess else False,
        "postprocess_script_exists": normalized_postprocess in tree.file_paths if normalized_postprocess else False,
        "warnings": warnings,
    }

    content_hash = _hash_payload(
        {
            "voltage_level": voltage_level,
            "tower_type": tower_type,
            "scene_type": scene_type,
            "release_tag": release_tag,
            "scenario_code": scenario_code,
            "runner_kind": runner_kind,
            "storage_mount_code": mount.code,
            "storage_root_path": normalized_root_path,
            "entry_file": normalized_entry,
            "result_file": normalized_result,
            "egm_subdir": normalized_egm_subdir,
            "egm_result_file": normalized_egm_result,
            "preprocess_script": normalized_preprocess,
            "postprocess_script": normalized_postprocess,
            "files": [
                {
                    "path": _relative_from_root(normalized_root_path, item.path),
                    "size": item.size,
                    "etag": item.etag,
                }
                for item in tree.files
            ],
        }
    )

    return {
        "storage_mount_code": mount.code,
        "storage_root_path": normalized_root_path,
        "entry_file": normalized_entry,
        "result_file": normalized_result,
        "egm_subdir": normalized_egm_subdir,
        "egm_result_file": normalized_egm_result,
        "preprocess_script": normalized_preprocess,
        "postprocess_script": normalized_postprocess,
        "manifest_json": manifest_json,
        "validation_json": validation_json,
        "content_hash": content_hash,
    }


def serialize_asset(
    item: AtpAsset,
    *,
    release_count: int,
    run_count: int,
    last_run_status: str | None,
    last_run_date: datetime | None,
    active_release: AtpAssetRelease | None,
) -> AtpAssetSummary:
    return AtpAssetSummary(
        id=item.id,
        code=item.code,
        name=item.name,
        description=item.description,
        status=item.status,  # type: ignore[arg-type]
        voltage_level=item.voltage_level,
        tower_type=item.tower_type,
        scene_type=item.scene_type,
        tags_json=item.tags_json or [],
        latest_release_no=item.latest_release_no,
        active_release_no=item.active_release_no,
        active_release_id=active_release.id if active_release else None,
        active_release_tag=active_release.release_tag if active_release else None,
        release_count=release_count,
        run_count=run_count,
        last_run_status=last_run_status,  # type: ignore[arg-type]
        last_run_date=last_run_date,
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def serialize_release(item: AtpAssetRelease) -> AtpAssetReleaseSummary:
    return AtpAssetReleaseSummary(
        id=item.id,
        asset_id=item.asset_id,
        asset_code=item.asset.code,
        asset_name=item.asset.name,
        release_no=item.release_no,
        release_tag=item.release_tag,
        status=item.status,  # type: ignore[arg-type]
        voltage_level=item.voltage_level,
        tower_type=item.tower_type,
        scene_type=item.scene_type,
        scenario_code=item.scenario_code,
        runner_kind=item.runner_kind,  # type: ignore[arg-type]
        storage_mount_code=item.storage_mount_code,
        storage_root_path=item.storage_root_path,
        entry_file=item.entry_file,
        result_file=item.result_file,
        egm_subdir=item.egm_subdir,
        egm_result_file=item.egm_result_file,
        preprocess_script=item.preprocess_script,
        postprocess_script=item.postprocess_script,
        content_hash=item.content_hash,
        is_active=item.is_active,
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def serialize_release_detail(item: AtpAssetRelease) -> AtpAssetReleaseDetail:
    summary = serialize_release(item)
    return AtpAssetReleaseDetail(
        **summary.model_dump(),
        manifest_json=item.manifest_json or {},
        validation_json=item.validation_json or {},
    )


def serialize_run(item: AtpAssetRun) -> AtpAssetRunSummary:
    stdout_text = item.stdout_text or ""
    stderr_text = item.stderr_text or ""
    return AtpAssetRunSummary(
        id=item.id,
        asset_id=item.asset_id,
        asset_code=item.asset.code,
        asset_name=item.asset.name,
        release_id=item.release_id,
        release_no=item.release.release_no,
        release_tag=item.release.release_tag,
        status=item.status,  # type: ignore[arg-type]
        engine_mode=item.engine_mode,  # type: ignore[arg-type]
        runner_kind=item.runner_kind,  # type: ignore[arg-type]
        task_id=item.task_id,
        storage_mount_code=item.storage_mount_code,
        storage_root_path=item.storage_root_path,
        materialized_root_path=item.materialized_root_path,
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


def serialize_run_detail(item: AtpAssetRun) -> AtpAssetRunDetail:
    summary = serialize_run(item)
    return AtpAssetRunDetail(
        **summary.model_dump(),
        stdout_text=item.stdout_text,
        stderr_text=item.stderr_text,
        output_manifest_json=item.output_manifest_json or {},
        result_summary_json=item.result_summary_json or {},
    )


def _load_asset_release_count_map(db: Session, asset_ids: list[str]) -> dict[str, int]:
    if not asset_ids:
        return {}
    rows = db.execute(
        select(AtpAssetRelease.asset_id, func.count())
        .where(AtpAssetRelease.asset_id.in_(asset_ids))
        .group_by(AtpAssetRelease.asset_id)
    ).all()
    return {str(asset_id): int(count) for asset_id, count in rows}


def _load_asset_run_count_map(db: Session, asset_ids: list[str]) -> dict[str, int]:
    if not asset_ids:
        return {}
    rows = db.execute(
        select(AtpAssetRun.asset_id, func.count())
        .where(AtpAssetRun.asset_id.in_(asset_ids))
        .group_by(AtpAssetRun.asset_id)
    ).all()
    return {str(asset_id): int(count) for asset_id, count in rows}


def _load_asset_last_run_map(db: Session, asset_ids: list[str]) -> dict[str, tuple[str | None, datetime | None]]:
    if not asset_ids:
        return {}
    rows = db.execute(
        select(AtpAssetRun)
        .options(joinedload(AtpAssetRun.asset), joinedload(AtpAssetRun.release))
        .where(AtpAssetRun.asset_id.in_(asset_ids))
        .order_by(AtpAssetRun.asset_id.asc(), AtpAssetRun.create_date.desc(), AtpAssetRun.id.desc())
    ).scalars().all()
    result: dict[str, tuple[str | None, datetime | None]] = {}
    for row in rows:
        if row.asset_id in result:
            continue
        result[row.asset_id] = (row.status, row.create_date)
    return result


def _load_active_release_map(db: Session, asset_ids: list[str]) -> dict[str, AtpAssetRelease]:
    if not asset_ids:
        return {}
    rows = db.execute(
        select(AtpAssetRelease)
        .options(joinedload(AtpAssetRelease.asset))
        .where(AtpAssetRelease.asset_id.in_(asset_ids), AtpAssetRelease.is_active.is_(True))
    ).scalars().all()
    return {row.asset_id: row for row in rows}


def list_assets(
    db: Session,
    *,
    keyword: str | None,
    status_filter: str | None,
    voltage_level: str | None,
    tower_type: str | None,
    scene_type: str | None,
) -> AtpAssetListResponse:
    stmt = select(AtpAsset)
    total_stmt = select(func.count()).select_from(AtpAsset)

    normalized_keyword = (keyword or "").strip()
    if normalized_keyword:
        like = f"%{normalized_keyword}%"
        predicate = or_(AtpAsset.code.ilike(like), AtpAsset.name.ilike(like), AtpAsset.description.ilike(like))
        stmt = stmt.where(predicate)
        total_stmt = total_stmt.where(predicate)

    normalized_status = (status_filter or "").strip().lower()
    if normalized_status:
        if normalized_status not in VALID_ASSET_STATUS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status filter: {status_filter}")
        stmt = stmt.where(AtpAsset.status == normalized_status)
        total_stmt = total_stmt.where(AtpAsset.status == normalized_status)

    if voltage_level and voltage_level.strip():
        stmt = stmt.where(AtpAsset.voltage_level == voltage_level.strip())
        total_stmt = total_stmt.where(AtpAsset.voltage_level == voltage_level.strip())
    if tower_type and tower_type.strip():
        stmt = stmt.where(AtpAsset.tower_type == tower_type.strip())
        total_stmt = total_stmt.where(AtpAsset.tower_type == tower_type.strip())
    if scene_type and scene_type.strip():
        stmt = stmt.where(AtpAsset.scene_type == scene_type.strip())
        total_stmt = total_stmt.where(AtpAsset.scene_type == scene_type.strip())

    items = db.execute(stmt.order_by(AtpAsset.update_date.desc(), AtpAsset.code.asc())).scalars().all()
    total = int(db.scalar(total_stmt) or 0)
    asset_ids = [item.id for item in items]
    release_count_map = _load_asset_release_count_map(db, asset_ids)
    run_count_map = _load_asset_run_count_map(db, asset_ids)
    last_run_map = _load_asset_last_run_map(db, asset_ids)
    active_release_map = _load_active_release_map(db, asset_ids)

    return AtpAssetListResponse(
        items=[
            serialize_asset(
                item,
                release_count=release_count_map.get(item.id, 0),
                run_count=run_count_map.get(item.id, 0),
                last_run_status=last_run_map.get(item.id, (None, None))[0],
                last_run_date=last_run_map.get(item.id, (None, None))[1],
                active_release=active_release_map.get(item.id),
            )
            for item in items
        ],
        total=total,
    )


def get_asset_by_id(db: Session, asset_id: str) -> AtpAsset | None:
    return db.execute(select(AtpAsset).where(AtpAsset.id == asset_id)).scalar_one_or_none()


def get_asset_by_code(db: Session, code: str) -> AtpAsset | None:
    normalized = code.strip().lower()
    if not normalized:
        return None
    return db.execute(select(AtpAsset).where(func.lower(AtpAsset.code) == normalized)).scalar_one_or_none()


def create_asset(db: Session, payload: AtpAssetCreateRequest, *, actor_user_id: str) -> AtpAssetSummary | None:
    if get_asset_by_code(db, payload.code):
        return None

    now = utcnow()
    item = AtpAsset(
        code=payload.code.strip(),
        name=payload.name.strip(),
        description=payload.description.strip(),
        status=payload.status,
        voltage_level=_normalize_optional_str(payload.voltage_level),
        tower_type=_normalize_optional_str(payload.tower_type),
        scene_type=_normalize_optional_str(payload.scene_type),
        tags_json=_normalize_tags(payload.tags_json),
        latest_release_no=0,
        active_release_no=None,
        create_user=actor_user_id,
        update_user=actor_user_id,
        create_date=now,
        update_date=now,
    )
    db.add(item)
    db.commit()

    saved = get_asset_by_id(db, item.id)
    if not saved:
        return None

    _publish_change("asset.created", {"action": "created", "asset_id": saved.id})
    return serialize_asset(saved, release_count=0, run_count=0, last_run_status=None, last_run_date=None, active_release=None)


def update_asset(
    db: Session,
    asset_id: str,
    payload: AtpAssetUpdateRequest,
    *,
    actor_user_id: str,
) -> AtpAssetSummary | None:
    item = get_asset_by_id(db, asset_id)
    if not item:
        return None

    update_data = payload.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"] is not None:
        item.name = str(update_data["name"]).strip()
    if "description" in update_data and update_data["description"] is not None:
        item.description = str(update_data["description"]).strip()
    if "status" in update_data and update_data["status"] is not None:
        item.status = str(update_data["status"])
    if "voltage_level" in update_data:
        item.voltage_level = _normalize_optional_str(update_data["voltage_level"])
    if "tower_type" in update_data:
        item.tower_type = _normalize_optional_str(update_data["tower_type"])
    if "scene_type" in update_data:
        item.scene_type = _normalize_optional_str(update_data["scene_type"])
    if "tags_json" in update_data:
        item.tags_json = _normalize_tags(update_data["tags_json"])

    item.update_user = actor_user_id
    item.update_date = utcnow()
    db.commit()

    saved = get_asset_by_id(db, asset_id)
    if not saved:
        return None
    active_release = next((release for release in saved.releases if release.is_active), None)
    _publish_change("asset.updated", {"action": "updated", "asset_id": saved.id})
    return serialize_asset(
        saved,
        release_count=len(saved.releases),
        run_count=len(saved.runs),
        last_run_status=saved.runs[0].status if saved.runs else None,
        last_run_date=saved.runs[0].create_date if saved.runs else None,
        active_release=active_release,
    )


def delete_asset(db: Session, asset_id: str) -> bool:
    item = get_asset_by_id(db, asset_id)
    if not item:
        return False
    db.delete(item)
    db.commit()
    _publish_change("asset.deleted", {"action": "deleted", "asset_id": asset_id})
    return True


def list_releases(
    db: Session,
    *,
    asset_id: str | None = None,
    release_id: str | None = None,
    active_only: bool = False,
    status_filter: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> AtpAssetReleaseListResponse:
    stmt = select(AtpAssetRelease).options(joinedload(AtpAssetRelease.asset))
    total_stmt = select(func.count()).select_from(AtpAssetRelease)

    if asset_id:
        stmt = stmt.where(AtpAssetRelease.asset_id == asset_id)
        total_stmt = total_stmt.where(AtpAssetRelease.asset_id == asset_id)
    if release_id:
        stmt = stmt.where(AtpAssetRelease.id == release_id)
        total_stmt = total_stmt.where(AtpAssetRelease.id == release_id)
    if active_only:
        stmt = stmt.where(AtpAssetRelease.is_active.is_(True))
        total_stmt = total_stmt.where(AtpAssetRelease.is_active.is_(True))

    normalized_status = (status_filter or "").strip().lower()
    if normalized_status:
        if normalized_status not in VALID_RELEASE_STATUS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status filter: {status_filter}")
        stmt = stmt.where(AtpAssetRelease.status == normalized_status)
        total_stmt = total_stmt.where(AtpAssetRelease.status == normalized_status)

    items = db.execute(
        stmt.order_by(AtpAssetRelease.is_active.desc(), AtpAssetRelease.release_no.desc(), AtpAssetRelease.id.desc())
        .offset(offset)
        .limit(limit)
    ).scalars().all()
    total = int(db.scalar(total_stmt) or 0)
    return AtpAssetReleaseListResponse(items=[serialize_release(item) for item in items], total=total)


def get_release_by_id(db: Session, release_id: str) -> AtpAssetRelease | None:
    return db.execute(
        select(AtpAssetRelease)
        .options(joinedload(AtpAssetRelease.asset))
        .where(AtpAssetRelease.id == release_id)
    ).scalar_one_or_none()


def create_release(
    db: Session,
    *,
    asset_id: str,
    payload: AtpAssetReleaseCreateRequest,
    actor_user_id: str,
) -> AtpAssetReleaseDetail:
    asset = get_asset_by_id(db, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    max_release_no = int(
        db.scalar(select(func.max(AtpAssetRelease.release_no)).where(AtpAssetRelease.asset_id == asset_id)) or 0
    )
    next_release_no = max_release_no + 1

    prepared = _prepare_release_payload(
        db,
        storage_mount_code=payload.storage_mount_code,
        storage_root_path=payload.storage_root_path,
        runner_kind=payload.runner_kind,
        voltage_level=payload.voltage_level.strip(),
        tower_type=payload.tower_type.strip(),
        scene_type=payload.scene_type.strip(),
        release_tag=_normalize_optional_str(payload.release_tag),
        scenario_code=_normalize_optional_str(payload.scenario_code),
        entry_file=payload.entry_file,
        result_file=payload.result_file,
        egm_subdir=payload.egm_subdir,
        egm_result_file=payload.egm_result_file,
        preprocess_script=payload.preprocess_script,
        postprocess_script=payload.postprocess_script,
    )

    now = utcnow()
    should_activate = asset.active_release_no is None and payload.status != "archived"
    item = AtpAssetRelease(
        asset_id=asset.id,
        release_no=next_release_no,
        release_tag=_normalize_optional_str(payload.release_tag),
        status=payload.status,
        voltage_level=payload.voltage_level.strip(),
        tower_type=payload.tower_type.strip(),
        scene_type=payload.scene_type.strip(),
        scenario_code=_normalize_optional_str(payload.scenario_code),
        runner_kind=payload.runner_kind,
        is_active=should_activate,
        create_user=actor_user_id,
        update_user=actor_user_id,
        create_date=now,
        update_date=now,
        **prepared,
    )
    db.add(item)

    asset.latest_release_no = max(asset.latest_release_no, next_release_no)
    if should_activate:
        asset.active_release_no = next_release_no
    asset.voltage_level = asset.voltage_level or item.voltage_level
    asset.tower_type = asset.tower_type or item.tower_type
    asset.scene_type = asset.scene_type or item.scene_type
    asset.update_user = actor_user_id
    asset.update_date = now

    db.commit()
    saved = get_release_by_id(db, item.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Release save failed")

    _publish_change(
        "release.created",
        {"action": "created", "asset_id": asset.id, "release_id": saved.id, "release_no": saved.release_no},
    )
    return serialize_release_detail(saved)


def update_release(
    db: Session,
    *,
    release_id: str,
    payload: AtpAssetReleaseUpdateRequest,
    actor_user_id: str,
) -> AtpAssetReleaseDetail:
    item = get_release_by_id(db, release_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release not found")
    asset = item.asset

    update_data = payload.model_dump(exclude_unset=True)
    merged = {
        "release_tag": item.release_tag,
        "status": item.status,
        "voltage_level": item.voltage_level,
        "tower_type": item.tower_type,
        "scene_type": item.scene_type,
        "scenario_code": item.scenario_code,
        "runner_kind": item.runner_kind,
        "storage_mount_code": item.storage_mount_code,
        "storage_root_path": item.storage_root_path,
        "entry_file": item.entry_file,
        "result_file": item.result_file,
        "egm_subdir": item.egm_subdir,
        "egm_result_file": item.egm_result_file,
        "preprocess_script": item.preprocess_script,
        "postprocess_script": item.postprocess_script,
    }
    merged.update(update_data)
    prepared = _prepare_release_payload(
        db,
        storage_mount_code=str(merged["storage_mount_code"]),
        storage_root_path=str(merged["storage_root_path"]),
        runner_kind=str(merged["runner_kind"]),
        voltage_level=str(merged["voltage_level"]).strip(),
        tower_type=str(merged["tower_type"]).strip(),
        scene_type=str(merged["scene_type"]).strip(),
        release_tag=_normalize_optional_str(merged.get("release_tag")),
        scenario_code=_normalize_optional_str(merged.get("scenario_code")),
        entry_file=merged.get("entry_file"),
        result_file=merged.get("result_file"),
        egm_subdir=merged.get("egm_subdir"),
        egm_result_file=merged.get("egm_result_file"),
        preprocess_script=merged.get("preprocess_script"),
        postprocess_script=merged.get("postprocess_script"),
    )

    item.release_tag = _normalize_optional_str(merged.get("release_tag"))
    item.status = str(merged["status"])
    item.voltage_level = str(merged["voltage_level"]).strip()
    item.tower_type = str(merged["tower_type"]).strip()
    item.scene_type = str(merged["scene_type"]).strip()
    item.scenario_code = _normalize_optional_str(merged.get("scenario_code"))
    item.runner_kind = str(merged["runner_kind"])
    item.storage_mount_code = prepared["storage_mount_code"]
    item.storage_root_path = prepared["storage_root_path"]
    item.entry_file = prepared["entry_file"]
    item.result_file = prepared["result_file"]
    item.egm_subdir = prepared["egm_subdir"]
    item.egm_result_file = prepared["egm_result_file"]
    item.preprocess_script = prepared["preprocess_script"]
    item.postprocess_script = prepared["postprocess_script"]
    item.manifest_json = prepared["manifest_json"]
    item.validation_json = prepared["validation_json"]
    item.content_hash = prepared["content_hash"]
    item.update_user = actor_user_id
    item.update_date = utcnow()

    if item.status == "archived" and item.is_active:
        item.is_active = False
        asset.active_release_no = None
    if item.is_active:
        asset.active_release_no = item.release_no
    asset.latest_release_no = max(asset.latest_release_no, item.release_no)
    asset.update_user = actor_user_id
    asset.update_date = utcnow()

    db.commit()
    saved = get_release_by_id(db, release_id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Release load failed")
    _publish_change(
        "release.updated",
        {"action": "updated", "asset_id": saved.asset_id, "release_id": saved.id, "release_no": saved.release_no},
    )
    return serialize_release_detail(saved)


def activate_release(db: Session, *, release_id: str, actor_user_id: str) -> AtpAssetSummary:
    release = get_release_by_id(db, release_id)
    if not release:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release not found")
    if release.status == "archived":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archived release cannot be activated")

    asset = release.asset
    for candidate in asset.releases:
        candidate.is_active = candidate.id == release.id
        candidate.update_user = actor_user_id
        candidate.update_date = utcnow()
    asset.active_release_no = release.release_no
    asset.latest_release_no = max(asset.latest_release_no, release.release_no)
    asset.update_user = actor_user_id
    asset.update_date = utcnow()
    db.commit()

    _publish_change(
        "release.activated",
        {"action": "activated", "asset_id": asset.id, "release_id": release.id, "release_no": release.release_no},
    )
    return serialize_asset(
        asset,
        release_count=len(asset.releases),
        run_count=len(asset.runs),
        last_run_status=asset.runs[0].status if asset.runs else None,
        last_run_date=asset.runs[0].create_date if asset.runs else None,
        active_release=release,
    )


def list_release_files(db: Session, *, release_id: str) -> AtpAssetFileListResponse:
    release = get_release_by_id(db, release_id)
    if not release:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release not found")

    mount = _resolve_mount(db, release.storage_mount_code)
    driver = _build_driver_or_400(mount)
    tree = _walk_storage_tree(driver, release.storage_root_path)
    items = [
        AtpAssetFileEntry(
            relative_path=_relative_from_root(release.storage_root_path, item.path),
            name=item.name,
            is_dir=False,
            size=item.size,
            mime_type=item.mime_type,
            file_role=_infer_file_role(release, _relative_from_root(release.storage_root_path, item.path), False),
        )
        for item in tree.files
    ]
    dir_items = [
        AtpAssetFileEntry(
            relative_path=path,
            name=path.split("/")[-1],
            is_dir=True,
            size=0,
            mime_type=None,
            file_role=_infer_file_role(release, path, True),
        )
        for path in tree.directories
    ]
    merged_items = sorted([*dir_items, *items], key=lambda entry: (not entry.is_dir, entry.relative_path))
    return AtpAssetFileListResponse(
        release_id=release.id,
        storage_mount_code=release.storage_mount_code,
        storage_root_path=release.storage_root_path,
        items=merged_items,
        total=len(merged_items),
    )


def _infer_file_role(release: AtpAssetRelease, relative_path: str, is_dir: bool) -> str | None:
    if is_dir:
        if release.egm_subdir and relative_path == release.egm_subdir:
            return "egm_dir"
        return None
    if release.entry_file and relative_path == release.entry_file:
        return "entry_atp"
    if release.result_file and relative_path == release.result_file:
        return "result_text"
    if release.egm_result_file and relative_path == release.egm_result_file:
        return "egm_result"
    if release.preprocess_script and relative_path == release.preprocess_script:
        return "preprocess_script"
    if release.postprocess_script and relative_path == release.postprocess_script:
        return "postprocess_script"
    lower = relative_path.lower()
    if lower.endswith("tpbig.exe"):
        return "exe_tpbig"
    if lower.endswith("rjtzl.exe"):
        return "exe_rjtzl"
    if lower.endswith((".doc", ".docx", ".txt", ".md", ".pdf")):
        return "doc"
    if lower.endswith(".py"):
        return "script"
    if lower.endswith(".atp"):
        return "atp"
    return "other"


def list_runs(
    db: Session,
    *,
    asset_id: str | None = None,
    release_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> AtpAssetRunListResponse:
    stmt = select(AtpAssetRun).options(joinedload(AtpAssetRun.asset), joinedload(AtpAssetRun.release))
    total_stmt = select(func.count()).select_from(AtpAssetRun)
    if asset_id:
        stmt = stmt.where(AtpAssetRun.asset_id == asset_id)
        total_stmt = total_stmt.where(AtpAssetRun.asset_id == asset_id)
    if release_id:
        stmt = stmt.where(AtpAssetRun.release_id == release_id)
        total_stmt = total_stmt.where(AtpAssetRun.release_id == release_id)
    items = db.execute(
        stmt.order_by(AtpAssetRun.create_date.desc(), AtpAssetRun.id.desc()).offset(offset).limit(limit)
    ).scalars().all()
    total = int(db.scalar(total_stmt) or 0)
    return AtpAssetRunListResponse(items=[serialize_run(item) for item in items], total=total)


def get_run_by_id(db: Session, run_id: str) -> AtpAssetRun | None:
    return db.execute(
        select(AtpAssetRun)
        .options(joinedload(AtpAssetRun.asset), joinedload(AtpAssetRun.release))
        .where(AtpAssetRun.id == run_id)
    ).scalar_one_or_none()


def get_run_detail(db: Session, *, run_id: str) -> AtpAssetRunDetail:
    item = get_run_by_id(db, run_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return serialize_run_detail(item)


def run_release(
    db: Session,
    *,
    release_id: str,
    payload: AtpAssetRunRequest,
    actor_user_id: str,
) -> AtpAssetRunDetail:
    release = get_release_by_id(db, release_id)
    if not release:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release not found")
    timeout_seconds = _resolve_timeout(payload.timeout_seconds)

    run = AtpAssetRun(
        asset_id=release.asset_id,
        release_id=release.id,
        status="pending",
        engine_mode=_resolve_engine_mode(),
        runner_kind=release.runner_kind,
        storage_mount_code=release.storage_mount_code,
        storage_root_path=release.storage_root_path,
        timeout_seconds=timeout_seconds,
        create_user=actor_user_id,
        update_user=actor_user_id,
    )
    db.add(run)
    db.flush()
    run.update_date = utcnow()
    db.commit()

    if payload.dry_run:
        execute_asset_run_job(run_id=run.id, payload_data=payload.model_dump(), actor_user_id=actor_user_id)
        db.expire_all()
    else:
        try:
            task = _dispatch_asset_run_task(run_id=run.id, payload_data=payload.model_dump(), actor_user_id=actor_user_id)
        except Exception as exc:
            _mark_run_failed(db, run=run, actor_user_id=actor_user_id, reason=f"Celery dispatch failed: {exc}")
            saved = get_run_by_id(db, run.id)
            if not saved:
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Run save failed") from exc
            return serialize_run_detail(saved)
        run.task_id = str(task.id)
        run.update_date = utcnow()
        run.update_user = actor_user_id
        db.commit()
        _publish_change(
            "run.queued",
            {"action": "queued", "asset_id": run.asset_id, "release_id": run.release_id, "run_id": run.id, "task_id": run.task_id},
        )

    saved = get_run_by_id(db, run.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Run save failed")
    return serialize_run_detail(saved)


def execute_asset_run_job(*, run_id: str, payload_data: dict[str, Any], actor_user_id: str | None) -> None:
    from ..core.database import SessionLocal

    db = SessionLocal()
    try:
        run = get_run_by_id(db, run_id)
        if run is None or run.status in {"success", "failed"}:
            return
        release = run.release
        asset = run.asset
        payload = AtpAssetRunRequest.model_validate(payload_data)

        run.started_at = utcnow()
        run.status = "running"
        run.error_message = None
        run.finished_at = None
        run.duration_ms = None
        run.update_date = utcnow()
        run.update_user = actor_user_id
        db.commit()

        try:
            materialized = _prepare_materialized_release(db, release=release, run_id=run.id, extra_args=payload.extra_args)
        except HTTPException as exc:
            _mark_run_failed(db, run=run, actor_user_id=actor_user_id, reason=str(exc.detail))
            return
        except RuntimeError as exc:
            _mark_run_failed(db, run=run, actor_user_id=actor_user_id, reason=str(exc))
            return

        run.materialized_root_path = str(materialized.payload_root)
        run.working_dir = str(materialized.working_dir)
        run.engine_command = "\n".join(" ".join(step.command) for step in materialized.command_steps)

        if payload.dry_run:
            run.status = "success"
            run.exit_code = 0
            run.stdout_text = json.dumps(
                {
                    "dry_run": True,
                    "commands": [
                        {"label": step.label, "command": step.command, "cwd": str(step.cwd)}
                        for step in materialized.command_steps
                    ],
                    "materialized_root_path": str(materialized.payload_root),
                },
                ensure_ascii=False,
                indent=2,
            )
            run.stderr_text = ""
            run.output_manifest_json = _collect_output_manifest(materialized.payload_root)
            run.result_summary_json = _build_result_summary(release, materialized.payload_root)
            run.finished_at = utcnow()
            run.duration_ms = 0
            run.update_user = actor_user_id
            run.update_date = utcnow()
            db.commit()
            _publish_change(
                "run.finished",
                {"action": "dry_finished", "asset_id": asset.id, "release_id": release.id, "run_id": run.id, "status": run.status},
            )
            return

        env = os.environ.copy()
        env.update(payload.environment)
        started_perf = time.perf_counter()
        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []
        try:
            last_returncode = 0
            for step in materialized.command_steps:
                result = subprocess.run(
                    step.command,
                    cwd=str(step.cwd),
                    env=env,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=run.timeout_seconds,
                    check=False,
                )
                stdout_chunks.append(f"[{step.label}]\n{result.stdout}")
                stderr_chunks.append(f"[{step.label}]\n{result.stderr}")
                last_returncode = result.returncode
                if result.returncode != 0:
                    raise RuntimeError(f"{step.label} exited with code {result.returncode}")
            run.exit_code = last_returncode
            run.status = "success"
            run.error_message = None
        except subprocess.TimeoutExpired:
            run.status = "failed"
            run.exit_code = None
            run.error_message = f"Execution timed out after {run.timeout_seconds} seconds"
        except OSError as exc:
            run.status = "failed"
            run.exit_code = None
            run.error_message = str(exc)
        except RuntimeError as exc:
            run.status = "failed"
            run.exit_code = run.exit_code if run.exit_code is not None else 1
            run.error_message = str(exc)

        run.duration_ms = max(int((time.perf_counter() - started_perf) * 1000), 0)
        run.stdout_text = _truncate_output("\n\n".join(chunk for chunk in stdout_chunks if chunk))
        run.stderr_text = _truncate_output("\n\n".join(chunk for chunk in stderr_chunks if chunk))
        run.output_manifest_json = _collect_output_manifest(materialized.payload_root)
        run.result_summary_json = _build_result_summary(release, materialized.payload_root)
        run.finished_at = utcnow()
        run.update_user = actor_user_id
        run.update_date = utcnow()
        db.commit()
        _publish_change(
            "run.finished",
            {
                "action": "finished",
                "asset_id": asset.id,
                "release_id": release.id,
                "run_id": run.id,
                "status": run.status,
                "exit_code": run.exit_code,
            },
        )
    finally:
        db.close()


def _dispatch_asset_run_task(*, run_id: str, payload_data: dict[str, Any], actor_user_id: str | None):
    from ..tasks.atp_asset_tasks import execute_atp_asset_run_job

    return execute_atp_asset_run_job.delay(run_id, payload_data, actor_user_id)


def _mark_run_failed(db: Session, *, run: AtpAssetRun, actor_user_id: str | None, reason: str) -> None:
    run.status = "failed"
    run.error_message = reason
    run.finished_at = utcnow()
    run.duration_ms = 0 if run.duration_ms is None else run.duration_ms
    run.update_user = actor_user_id
    run.update_date = utcnow()
    db.commit()
    _publish_change(
        "run.failed",
        {"action": "failed", "asset_id": run.asset_id, "release_id": run.release_id, "run_id": run.id, "reason": reason},
    )


def _prepare_materialized_release(
    db: Session,
    *,
    release: AtpAssetRelease,
    run_id: str,
    extra_args: list[str],
) -> MaterializedRelease:
    mount = _resolve_mount(db, release.storage_mount_code)
    driver = _build_driver_or_400(mount)
    tree = _walk_storage_tree(driver, release.storage_root_path)
    payload_root = _materialize_storage_tree(driver, release=release, run_id=run_id, tree=tree)

    command_steps: list[CommandStep] = []
    if release.preprocess_script:
        script_path = _resolve_materialized_relative(payload_root, release.preprocess_script)
        command_steps.append(CommandStep(label="preprocess", command=[sys.executable, str(script_path)], cwd=script_path.parent))

    if release.runner_kind == "egm":
        command_steps.append(_build_engine_step(payload_root, release=release, step_kind="egm", extra_args=extra_args))
    elif release.runner_kind == "hybrid":
        command_steps.append(_build_engine_step(payload_root, release=release, step_kind="egm", extra_args=[]))
        command_steps.append(_build_engine_step(payload_root, release=release, step_kind="atp", extra_args=extra_args))
    else:
        command_steps.append(_build_engine_step(payload_root, release=release, step_kind="atp", extra_args=extra_args))

    if release.postprocess_script:
        script_path = _resolve_materialized_relative(payload_root, release.postprocess_script)
        command_steps.append(CommandStep(label="postprocess", command=[sys.executable, str(script_path)], cwd=script_path.parent))

    working_dir = command_steps[-1].cwd if command_steps else payload_root
    return MaterializedRelease(payload_root=payload_root, working_dir=working_dir, command_steps=command_steps)


def _materialize_storage_tree(driver: StorageDriver, *, release: AtpAssetRelease, run_id: str, tree: StorageTree) -> Path:
    allowed_root = Path(settings.wine_allowed_root).expanduser().resolve(strict=False)
    payload_root = (allowed_root / "atp-runtime" / "runs" / run_id / "payload").resolve(strict=False)
    if payload_root != allowed_root and allowed_root not in payload_root.parents:
        raise RuntimeError(f"Materialized release path escaped allowed root: {payload_root}")

    payload_root.mkdir(parents=True, exist_ok=True)
    for relative_dir in tree.directories:
        (payload_root / relative_dir).mkdir(parents=True, exist_ok=True)
    for item in tree.files:
        relative_path = _relative_from_root(release.storage_root_path, item.path)
        result = driver.read_file(item.path)
        target_path = payload_root / relative_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(result.content)
    return payload_root


def _resolve_materialized_relative(payload_root: Path, relative_path: str) -> Path:
    target = (payload_root / relative_path).resolve(strict=False)
    if target != payload_root and payload_root not in target.parents:
        raise RuntimeError(f"Materialized relative path escaped release root: {relative_path}")
    if not target.exists():
        raise RuntimeError(f"Materialized path not found: {relative_path}")
    return target


def _build_engine_step(payload_root: Path, *, release: AtpAssetRelease, step_kind: str, extra_args: list[str]) -> CommandStep:
    engine_prefix = _resolve_engine_prefix(payload_root, step_kind=step_kind)
    if step_kind == "egm":
        working_dir = _resolve_materialized_relative(payload_root, release.egm_subdir) if release.egm_subdir else payload_root
        command = [*engine_prefix]
        if release.entry_file:
            entry_path = _resolve_materialized_relative(payload_root, release.entry_file)
            command.append(str(entry_path))
        command.extend(extra_args)
        return CommandStep(label="egm", command=command, cwd=working_dir)

    if not release.entry_file:
        raise RuntimeError("entry_file is required for ATP execution")
    entry_path = _resolve_materialized_relative(payload_root, release.entry_file)
    command = [*engine_prefix, str(entry_path), *extra_args]
    return CommandStep(label="atp", command=command, cwd=entry_path.parent)


def _resolve_engine_prefix(payload_root: Path, *, step_kind: str) -> list[str]:
    mode = _resolve_engine_mode()
    if step_kind == "egm":
        materialized_candidate = _find_materialized_engine(payload_root, "rjtzl.exe")
        configured = settings.atp_rjtzl_executable
    else:
        materialized_candidate = _find_materialized_engine(payload_root, "tpbig.exe")
        configured = settings.atp_tpbig_executable

    if mode == "wine":
        wine_binary = _resolve_binary(settings.wine_binary_path)
        if not wine_binary:
            raise RuntimeError("Wine binary not found")
        executable = materialized_candidate or _resolve_configured_wine_executable(configured)
        if not executable:
            raise RuntimeError(f"{step_kind.upper()} executable not found")
        return [wine_binary, executable]

    executable = materialized_candidate or _resolve_binary(configured)
    if not executable:
        raise RuntimeError(f"{step_kind.upper()} executable not found")
    return [executable]


def _find_materialized_engine(payload_root: Path, filename: str) -> str | None:
    matches = sorted(
        (path for path in payload_root.rglob("*") if path.is_file() and path.name.lower() == filename.lower()),
        key=lambda path: (len(path.parts), str(path)),
    )
    if not matches:
        return None
    return str(matches[0])


def _resolve_configured_wine_executable(raw_path: str) -> str | None:
    configured = raw_path.strip()
    if not configured:
        return None
    allowed_root = Path(settings.wine_allowed_root).expanduser().resolve(strict=False)
    candidate = Path(configured).expanduser()
    if not candidate.is_absolute():
        candidate = (allowed_root / candidate).resolve(strict=False)
    else:
        candidate = candidate.resolve(strict=False)
    if candidate != allowed_root and allowed_root not in candidate.parents:
        return None
    if not candidate.exists() or not candidate.is_file():
        return None
    return str(candidate)


def _collect_output_manifest(payload_root: Path) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for path in sorted(payload_root.rglob("*")):
        if not path.is_file():
            continue
        relative_path = path.relative_to(payload_root).as_posix()
        mime_type = mimetypes.guess_type(path.name)[0]
        items.append({"path": relative_path, "size": int(path.stat().st_size), "mime_type": mime_type})
    return {"file_count": len(items), "files": items[:500]}


def _build_result_summary(release: AtpAssetRelease, payload_root: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "entry_file": release.entry_file,
        "result_file": None,
        "egm_result_file": None,
    }
    if release.result_file:
        result_path = payload_root / release.result_file
        summary["result_file"] = {"path": release.result_file, "exists": result_path.exists()}
    if release.egm_result_file:
        egm_result_path = payload_root / release.egm_result_file
        summary["egm_result_file"] = {"path": release.egm_result_file, "exists": egm_result_path.exists()}
    return summary


def _publish_change(event_name: str, payload: dict[str, Any]) -> None:
    _fire_and_forget(
        publish_topic(
            ATP_ASSET_TOPIC,
            name=event_name,
            payload=payload,
            requires_refetch=[],
            dedupe_key=f"atp-asset:{event_name}:{payload.get('asset_id', '-')}:"
            f"{payload.get('release_id', payload.get('run_id', '-'))}",
        )
    )
