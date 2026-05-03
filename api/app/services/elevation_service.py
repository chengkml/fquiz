from __future__ import annotations

import asyncio
import csv
import io
import mimetypes
import zipfile
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..models.base import utcnow
from ..models.elevation import ElevationApplyJob, ElevationDataset
from ..models.line import Line
from ..models.line_tower import LineTower
from ..models.user import User
from ..schemas.elevation import (
    ElevationApplyJobCreateRequest,
    ElevationApplyJobCreateResponse,
    ElevationApplyJobListResponse,
    ElevationApplyJobSummary,
    ElevationDatasetAnalyzeResponse,
    ElevationDatasetBatchImportResponse,
    ElevationDatasetDataImportResponse,
    ElevationDatasetPreviewCell,
    ElevationDatasetPreviewDiagnostics,
    ElevationDatasetCreateRequest,
    ElevationDatasetListResponse,
    ElevationDatasetPreviewPoint,
    ElevationDatasetPreviewResponse,
    ElevationDatasetSummary,
    ElevationDatasetUpdateRequest,
)
from .file_service import _build_driver_or_400, _require_mount, list_enabled_mounts
from .push_service import publish_topic
from .storage_driver import StorageDriverError, StorageInvalidPathError, StoragePathNotFoundError, join_virtual_path, normalize_virtual_path

ELEVATION_TOPIC = "admin.elevation"
POWER_LINES_TOPIC = "admin.power-lines"
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "gbk", "latin-1")
CSV_IMPORT_TEXT_ENCODINGS = ("utf-8-sig", "utf-8", "gbk", "latin-1")
NEAREST_MATCH_MAX_DISTANCE_M = 2000.0
ELEVATION_DATASET_ROOT = "/elevation/datasets"
ELEVATION_FILE_EXT_FORMAT_MAP = {
    ".csv": "csv",
    ".img": "img",
    ".tif": "tif",
    ".tiff": "tiff",
}
RASTER_FILE_FORMATS = {"img", "tif", "tiff"}
IMPORTABLE_ELEVATION_EXTENSIONS = set(ELEVATION_FILE_EXT_FORMAT_MAP.keys())
IMPORTABLE_ARCHIVE_EXTENSIONS = {".zip"}
MAX_SAMPLE_COUNT_INT = 2_147_483_647


@dataclass
class ElevationSamplePoint:
    lon: float
    lat: float
    altitude_m: float


@dataclass
class _OpenedRasterDataset:
    rasterio: Any
    dataset: Any
    temp_path: str

    def __enter__(self) -> "_OpenedRasterDataset":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        try:
            self.dataset.close()
        finally:
            try:
                Path(self.temp_path).unlink(missing_ok=True)
            except Exception:
                pass
        return False


@dataclass
class ElevationDatasetBatchImportStats:
    imported_count: int = 0
    analyzed_count: int = 0
    skipped_count: int = 0
    warnings: list[str] | None = None
    items: list[ElevationDatasetSummary] | None = None

    def __post_init__(self) -> None:
        if self.warnings is None:
            self.warnings = []
        if self.items is None:
            self.items = []


def serialize_dataset(item: ElevationDataset) -> ElevationDatasetSummary:
    return ElevationDatasetSummary(
        id=item.id,
        code=item.code,
        name=item.name,
        source=item.source,
        file_format=item.file_format,
        mount_code=item.mount_code,
        dataset_dir=item.dataset_dir,
        file_path=item.file_path,
        resolution_m=item.resolution_m,
        status=item.status,  # type: ignore[arg-type]
        usage_status=item.usage_status,  # type: ignore[arg-type]
        sample_count=item.sample_count,
        bbox_min_lon=item.bbox_min_lon,
        bbox_max_lon=item.bbox_max_lon,
        bbox_min_lat=item.bbox_min_lat,
        bbox_max_lat=item.bbox_max_lat,
        notes=item.notes,
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def serialize_job(item: ElevationApplyJob) -> ElevationApplyJobSummary:
    line = item.line
    dataset = item.dataset
    return ElevationApplyJobSummary(
        id=item.id,
        line_id=item.line_id,
        line_code=line.code if line else None,
        line_name=line.name if line else None,
        dataset_id=item.dataset_id,
        dataset_code=dataset.code if dataset else None,
        dataset_name=dataset.name if dataset else None,
        mode=item.mode,  # type: ignore[arg-type]
        status=item.status,  # type: ignore[arg-type]
        task_id=item.task_id,
        total_tower_count=item.total_tower_count,
        updated_tower_count=item.updated_tower_count,
        skipped_tower_count=item.skipped_tower_count,
        missing_geo_count=item.missing_geo_count,
        unmatched_count=item.unmatched_count,
        error_message=item.error_message,
        started_at=item.started_at,
        finished_at=item.finished_at,
        create_date=item.create_date,
        create_user=item.create_user,
        update_date=item.update_date,
        update_user=item.update_user,
    )


def list_datasets(
    db: Session,
    *,
    keyword: str | None,
    status_filter: str | None,
) -> ElevationDatasetListResponse:
    stmt = select(ElevationDataset)
    total_stmt = select(func.count()).select_from(ElevationDataset)

    normalized_keyword = (keyword or "").strip()
    if normalized_keyword:
        like = f"%{normalized_keyword}%"
        predicate = (
            ElevationDataset.code.ilike(like)
            | ElevationDataset.name.ilike(like)
            | ElevationDataset.source.ilike(like)
        )
        stmt = stmt.where(predicate)
        total_stmt = total_stmt.where(predicate)

    if status_filter in {"active", "disabled"}:
        stmt = stmt.where(ElevationDataset.status == status_filter)
        total_stmt = total_stmt.where(ElevationDataset.status == status_filter)

    total = int(db.scalar(total_stmt) or 0)
    items = db.execute(
        stmt.order_by(ElevationDataset.update_date.desc(), ElevationDataset.code.asc())
    ).scalars().all()
    return ElevationDatasetListResponse(
        items=[serialize_dataset(item) for item in items],
        total=total,
    )


def get_dataset_by_id(db: Session, dataset_id: str) -> ElevationDataset | None:
    return db.execute(
        select(ElevationDataset).where(ElevationDataset.id == dataset_id)
    ).scalar_one_or_none()


def get_dataset_by_code(db: Session, code: str) -> ElevationDataset | None:
    normalized = code.strip()
    if not normalized:
        return None
    return db.execute(
        select(ElevationDataset).where(
            func.lower(ElevationDataset.code) == normalized.lower()
        )
    ).scalar_one_or_none()


def create_dataset(
    db: Session,
    payload: ElevationDatasetCreateRequest,
    *,
    actor: User,
) -> ElevationDatasetSummary | None:
    normalized_code = payload.code.strip()
    if get_dataset_by_code(db, normalized_code):
        return None

    mount_code = _resolve_dataset_mount_code(db, requested_mount_code=payload.mount_code)
    dataset_dir = _resolve_dataset_dir(normalized_code)
    normalized_file_path: str
    file_format: str
    has_bound_file = _normalize_str(payload.file_name) is not None
    if has_bound_file:
        normalized_file_path = _resolve_dataset_file_path(
            dataset_code=normalized_code,
            filename=payload.file_name,
        )
        file_format = _detect_file_format(normalized_file_path)
        if file_format in RASTER_FILE_FORMATS:
            _require_rasterio_available()
        _ensure_dataset_file_exists(
            db,
            mount_code=mount_code,
            file_path=normalized_file_path,
        )
    else:
        normalized_file_path = _resolve_dataset_file_path(
            dataset_code=normalized_code,
            filename="dataset.csv",
        )
        file_format = "csv"

    now = utcnow()
    item = ElevationDataset(
        code=normalized_code,
        name=payload.name.strip(),
        source=_normalize_str(payload.source),
        file_format=file_format,
        mount_code=mount_code,
        dataset_dir=dataset_dir,
        file_path=normalized_file_path,
        resolution_m=payload.resolution_m,
        status="active",
        usage_status="idle",
        notes=_normalize_str(payload.notes),
        create_date=now,
        create_user=actor.id,
        update_date=now,
        update_user=actor.id,
    )
    db.add(item)
    db.commit()
    saved = get_dataset_by_id(db, item.id)
    if not saved:
        return None

    _publish_elevation_change(
        "elevation.dataset.created",
        {"action": "dataset_created", "dataset_id": saved.id},
    )
    return serialize_dataset(saved)


def import_datasets_from_csv(
    db: Session,
    *,
    file: UploadFile,
    actor: User,
) -> ElevationDatasetBatchImportResponse:
    content = file.file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="上传文件为空")

    text = _decode_text_bytes_for_import(content)
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV 文件没有可导入的数据行")

    stats = ElevationDatasetBatchImportStats()
    batch_created_ids: list[tuple[str, bool]] = []

    for row_index, row in enumerate(rows, start=2):
        normalized_row = {
            str(key).strip(): value
            for key, value in row.items()
            if key is not None
        }
        if all(not str(value or "").strip() for value in normalized_row.values()):
            continue

        code = _pick_csv_value(normalized_row, ["code", "编码"])
        name = _pick_csv_value(normalized_row, ["name", "名称"])
        mount_code = _pick_csv_value(normalized_row, ["mount_code", "挂载编码", "挂载"])
        file_name = _pick_csv_value(normalized_row, ["file_name", "文件名", "filename"])
        file_path = _pick_csv_value(normalized_row, ["file_path", "文件路径", "路径"])
        if not file_name and file_path:
            file_name = Path(file_path).name
        source = _pick_csv_value(normalized_row, ["source", "来源"])
        notes = _pick_csv_value(normalized_row, ["notes", "备注"])
        resolution_text = _pick_csv_value(normalized_row, ["resolution_m", "分辨率", "分辨率m", "分辨率(米)"])

        if not code or not name:
            stats.skipped_count += 1
            if stats.warnings is not None:
                stats.warnings.append(f"第 {row_index} 行缺少必填字段（code/name），已跳过")
            continue

        try:
            payload = ElevationDatasetCreateRequest(
                code=code,
                name=name,
                source=source,
                mount_code=mount_code,
                file_name=file_name,
                resolution_m=_parse_csv_optional_positive_float(resolution_text),
                notes=notes,
            )
            created = create_dataset(db, payload, actor=actor)
            if created is None:
                stats.skipped_count += 1
                if stats.warnings is not None:
                    stats.warnings.append(f"第 {row_index} 行编码重复（{code}），已跳过")
                continue
            stats.imported_count += 1
            if stats.items is not None:
                stats.items.append(created)
            batch_created_ids.append((created.id, bool(_normalize_str(file_name))))
        except HTTPException as exc:
            stats.skipped_count += 1
            detail = str(exc.detail) if exc.detail else "未知错误"
            if stats.warnings is not None:
                stats.warnings.append(f"第 {row_index} 行导入失败（{code}）：{detail}")
            continue

    for dataset_id, should_analyze in batch_created_ids:
        if not should_analyze:
            continue
        try:
            analyze_dataset(db, dataset_id=dataset_id, actor=actor)
            stats.analyzed_count += 1
        except HTTPException as exc:
            detail = str(exc.detail) if exc.detail else "未知错误"
            if stats.warnings is not None:
                stats.warnings.append(f"数据集 {dataset_id} 自动分析失败：{detail}")
        except Exception as exc:
            if stats.warnings is not None:
                stats.warnings.append(f"数据集 {dataset_id} 自动分析异常：{exc}")

    return ElevationDatasetBatchImportResponse(
        imported_count=stats.imported_count,
        analyzed_count=stats.analyzed_count,
        skipped_count=stats.skipped_count,
        warning_count=len(stats.warnings or []),
        warnings=stats.warnings or [],
        items=stats.items or [],
    )


def import_dataset_data_files(
    db: Session,
    *,
    dataset_id: str,
    files: list[UploadFile],
    actor: User,
) -> ElevationDatasetDataImportResponse:
    dataset = get_dataset_by_id(db, dataset_id)
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="高程数据集不存在")
    if dataset.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="高程数据集未启用")
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请至少上传一个文件")

    mount = _require_mount(db, dataset.mount_code)
    driver = _build_driver_or_400(mount)
    dataset_dir = _resolve_dataset_dir(dataset.code)
    _ensure_dataset_directory(driver=driver, dataset_dir=dataset_dir)

    uploaded_file_count = 0
    extracted_file_count = 0
    warnings: list[str] = []
    imported_files: list[str] = []

    for upload in files:
        filename = (upload.filename or "").strip()
        suffix = Path(filename).suffix.lower()
        if not filename:
            warnings.append("存在空文件名上传项，已跳过")
            continue

        if suffix in IMPORTABLE_ARCHIVE_EXTENSIONS:
            archive_bytes = _read_upload_content(upload)
            zip_result = _extract_zip_to_dataset_directory(
                driver=driver,
                dataset_dir=dataset_dir,
                zip_content=archive_bytes,
            )
            extracted_file_count += zip_result["extracted_count"]
            imported_files.extend(zip_result["imported_files"])
            warnings.extend(zip_result["warnings"])
            continue

        if suffix not in IMPORTABLE_ELEVATION_EXTENSIONS:
            warnings.append(f"文件 {filename} 类型不支持，已跳过（仅支持 csv/img/tif/tiff/zip）")
            continue

        content = _read_upload_content(upload)
        target_path = _write_dataset_file(
            driver=driver,
            dataset_dir=dataset_dir,
            filename=filename,
            content=content,
            content_type=upload.content_type,
        )
        uploaded_file_count += 1
        imported_files.append(target_path)

    preferred_file_path = _pick_preferred_dataset_file_path(paths=imported_files)
    if preferred_file_path is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未导入任何可用高程文件")

    dataset.dataset_dir = dataset_dir
    dataset.file_path = preferred_file_path
    dataset.file_format = _detect_file_format(preferred_file_path)
    dataset.usage_status = "idle"
    dataset.update_user = actor.id
    dataset.update_date = utcnow()
    db.commit()

    analysis_task_queued = False
    analysis_task_id: str | None = None
    try:
        task = _dispatch_elevation_dataset_analysis_task(dataset_id=dataset.id, actor_user_id=actor.id)
        analysis_task_queued = True
        analysis_task_id = str(task.id)
    except Exception as exc:  # pragma: no cover
        warnings.append(f"自动分析任务派发失败：{exc}")

    refreshed = get_dataset_by_id(db, dataset.id)
    if refreshed is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="数据集刷新失败")

    _publish_elevation_change(
        "elevation.dataset.data_imported",
        {"action": "dataset_data_imported", "dataset_id": refreshed.id},
    )
    return ElevationDatasetDataImportResponse(
        dataset=serialize_dataset(refreshed),
        uploaded_file_count=uploaded_file_count,
        extracted_file_count=extracted_file_count,
        imported_file_count=len(imported_files),
        analysis_task_queued=analysis_task_queued,
        analysis_task_id=analysis_task_id,
        warning_count=len(warnings),
        warnings=warnings,
        imported_files=sorted(set(imported_files)),
    )


def update_dataset(
    db: Session,
    dataset_id: str,
    payload: ElevationDatasetUpdateRequest,
    *,
    actor: User,
) -> ElevationDatasetSummary | None:
    item = get_dataset_by_id(db, dataset_id)
    if not item:
        return None

    update_data = payload.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"] is not None:
        item.name = str(update_data["name"]).strip()
    if "source" in update_data:
        item.source = _normalize_str(update_data["source"])
    if "resolution_m" in update_data:
        item.resolution_m = update_data["resolution_m"]
    if "status" in update_data and update_data["status"] is not None:
        item.status = str(update_data["status"]).strip().lower()
    if "notes" in update_data:
        item.notes = _normalize_str(update_data["notes"])

    item.update_user = actor.id
    item.update_date = utcnow()
    db.commit()
    saved = get_dataset_by_id(db, dataset_id)
    if not saved:
        return None
    _publish_elevation_change(
        "elevation.dataset.updated",
        {"action": "dataset_updated", "dataset_id": saved.id},
    )
    return serialize_dataset(saved)


def delete_dataset(
    db: Session,
    dataset_id: str,
) -> bool:
    item = get_dataset_by_id(db, dataset_id)
    if not item:
        return False

    running_job_count = int(
        db.scalar(
            select(func.count())
            .select_from(ElevationApplyJob)
            .where(
                ElevationApplyJob.dataset_id == dataset_id,
                ElevationApplyJob.status == "running",
            )
        )
        or 0
    )
    if running_job_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"该数据集存在 {running_job_count} 个运行中的回填任务，暂不能删除",
        )

    db.execute(delete(ElevationApplyJob).where(ElevationApplyJob.dataset_id == dataset_id))
    db.delete(item)
    db.commit()
    _publish_elevation_change(
        "elevation.dataset.deleted",
        {"action": "dataset_deleted", "dataset_id": dataset_id},
    )
    return True


def analyze_dataset(
    db: Session,
    *,
    dataset_id: str,
    actor: User,
) -> ElevationDatasetAnalyzeResponse:
    item = get_dataset_by_id(db, dataset_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="高程数据集不存在")
    if item.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="高程数据集未启用")

    stats, warnings = _analyze_dataset_content(db, item)

    item.sample_count = stats["sample_count"]
    item.bbox_min_lon = stats["bbox_min_lon"]
    item.bbox_max_lon = stats["bbox_max_lon"]
    item.bbox_min_lat = stats["bbox_min_lat"]
    item.bbox_max_lat = stats["bbox_max_lat"]
    item.update_user = actor.id
    item.update_date = utcnow()
    db.commit()

    saved = get_dataset_by_id(db, dataset_id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="高程数据集分析保存失败")

    _publish_elevation_change(
        "elevation.dataset.analyzed",
        {"action": "dataset_analyzed", "dataset_id": saved.id},
    )
    return ElevationDatasetAnalyzeResponse(
        dataset=serialize_dataset(saved),
        warnings=warnings,
    )


def preview_dataset(
    db: Session,
    *,
    dataset_id: str,
    max_points: int,
) -> ElevationDatasetPreviewResponse:
    item = get_dataset_by_id(db, dataset_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="高程数据集不存在")
    if item.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="高程数据集未启用")

    preview_limit = max(1, min(max_points, 5000))
    file_format = _resolve_dataset_file_format(item)
    if file_format == "csv":
        points, warnings = _load_dataset_points(db, item)
        sampled = _sample_preview_points_from_csv(points=points, limit=preview_limit)
        return ElevationDatasetPreviewResponse(
            dataset=serialize_dataset(item),
            preview_mode="point_cloud",
            total_points=len(points),
            sampled_points=len(sampled),
            points=[ElevationDatasetPreviewPoint(longitude=point.lon, latitude=point.lat, altitude_m=point.altitude_m) for point in sampled],
            cells=[],
            diagnostics=ElevationDatasetPreviewDiagnostics(
                source_crs="EPSG:4326",
                source_bounds_min_x=min(point.lon for point in points),
                source_bounds_max_x=max(point.lon for point in points),
                source_bounds_min_y=min(point.lat for point in points),
                source_bounds_max_y=max(point.lat for point in points),
                wgs84_bounds_min_lon=min(point.lon for point in points),
                wgs84_bounds_max_lon=max(point.lon for point in points),
                wgs84_bounds_min_lat=min(point.lat for point in points),
                wgs84_bounds_max_lat=max(point.lat for point in points),
                raster_width=None,
                raster_height=None,
                target_samples=preview_limit,
                sampling_step=max(1, len(points) // max(1, len(sampled))) if sampled else None,
                scanned_candidates=len(points),
                valid_preview_count=len(sampled),
            ),
            warnings=warnings,
        )

    if file_format in RASTER_FILE_FORMATS:
        return _build_raster_preview(db, dataset=item, limit=preview_limit)

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"不支持的高程文件格式: {file_format}",
    )


def list_jobs(
    db: Session,
    *,
    line_id: str | None,
    dataset_id: str | None,
    status_filter: str | None,
    limit: int,
) -> ElevationApplyJobListResponse:
    stmt = select(ElevationApplyJob)
    total_stmt = select(func.count()).select_from(ElevationApplyJob)

    if line_id:
        stmt = stmt.where(ElevationApplyJob.line_id == line_id)
        total_stmt = total_stmt.where(ElevationApplyJob.line_id == line_id)
    if dataset_id:
        stmt = stmt.where(ElevationApplyJob.dataset_id == dataset_id)
        total_stmt = total_stmt.where(ElevationApplyJob.dataset_id == dataset_id)
    if status_filter in {"pending", "running", "success", "failed"}:
        stmt = stmt.where(ElevationApplyJob.status == status_filter)
        total_stmt = total_stmt.where(ElevationApplyJob.status == status_filter)

    total = int(db.scalar(total_stmt) or 0)
    items = db.execute(
        stmt.order_by(ElevationApplyJob.create_date.desc(), ElevationApplyJob.id.desc()).limit(limit)
    ).scalars().all()
    return ElevationApplyJobListResponse(
        items=[serialize_job(item) for item in items],
        total=total,
    )


def get_job_by_id(db: Session, job_id: str) -> ElevationApplyJob | None:
    return db.execute(
        select(ElevationApplyJob).where(ElevationApplyJob.id == job_id)
    ).scalar_one_or_none()


def create_apply_job(
    db: Session,
    payload: ElevationApplyJobCreateRequest,
    *,
    actor: User,
) -> ElevationApplyJobCreateResponse:
    line = db.execute(select(Line).where(Line.id == payload.line_id)).scalar_one_or_none()
    if not line:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="线路不存在")

    dataset = get_dataset_by_id(db, payload.dataset_id)
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="高程数据集不存在")
    if dataset.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="高程数据集未启用")

    allowed_modes = {"fill_null_only", "overwrite_all"}
    if payload.mode not in allowed_modes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的回填模式")

    total_tower_count = int(
        db.scalar(
            select(func.count())
            .select_from(LineTower)
            .where(LineTower.line_id == line.id)
        )
        or 0
    )
    if total_tower_count <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前线路没有可回填的杆塔数据")

    now = utcnow()
    job = ElevationApplyJob(
        line_id=line.id,
        dataset_id=dataset.id,
        mode=payload.mode,
        status="pending",
        total_tower_count=total_tower_count,
        create_date=now,
        create_user=actor.id,
        update_date=now,
        update_user=actor.id,
    )
    db.add(job)
    db.commit()
    saved = get_job_by_id(db, job.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="创建任务失败")

    task = _dispatch_elevation_apply_task(job_id=saved.id)
    saved.task_id = task.id
    saved.update_user = actor.id
    saved.update_date = utcnow()
    db.commit()

    latest = get_job_by_id(db, saved.id)
    if not latest:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="任务派发失败")

    _refresh_dataset_usage_status(db, dataset_id=latest.dataset_id)

    _publish_elevation_change(
        "elevation.job.created",
        {"action": "job_created", "job_id": latest.id, "line_id": latest.line_id},
    )
    return ElevationApplyJobCreateResponse(job=serialize_job(latest), queued=True)


def _dispatch_elevation_apply_task(*, job_id: str):
    from ..tasks.elevation_tasks import apply_elevation_for_line_job

    return apply_elevation_for_line_job.delay(job_id)


def _dispatch_elevation_dataset_analysis_task(*, dataset_id: str, actor_user_id: str | None):
    from ..tasks.elevation_tasks import analyze_elevation_dataset_job

    return analyze_elevation_dataset_job.delay(dataset_id, actor_user_id)


def execute_apply_job(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = get_job_by_id(db, job_id)
        if not job:
            return
        if job.status in {"success", "failed"}:
            return

        job.status = "running"
        job.started_at = utcnow()
        job.update_date = utcnow()
        db.commit()
        _refresh_dataset_usage_status(db, dataset_id=job.dataset_id)
        _publish_elevation_change(
            "elevation.job.running",
            {"action": "job_running", "job_id": job.id, "line_id": job.line_id},
        )

        line = db.execute(select(Line).where(Line.id == job.line_id)).scalar_one_or_none()
        dataset = get_dataset_by_id(db, job.dataset_id)
        if not line or not dataset:
            job.status = "failed"
            job.error_message = "线路或高程数据集不存在"
            job.finished_at = utcnow()
            job.update_date = utcnow()
            db.commit()
            _refresh_dataset_usage_status(db, dataset_id=job.dataset_id)
            _publish_elevation_change(
                "elevation.job.failed",
                {"action": "job_failed", "job_id": job.id, "line_id": job.line_id},
            )
            return

        file_format = _resolve_dataset_file_format(dataset)
        if file_format == "csv":
            points, warnings = _load_dataset_points(db, dataset)
            stats = _apply_points_to_line_towers(
                db,
                line_id=line.id,
                dataset=dataset,
                mode=job.mode,
                points=points,
            )
        elif file_format in RASTER_FILE_FORMATS:
            stats, warnings = _apply_raster_to_line_towers(
                db,
                line_id=line.id,
                dataset=dataset,
                mode=job.mode,
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"不支持的高程文件格式: {file_format}",
            )

        _refresh_dataset_usage_status(db, dataset_id=dataset.id)

        warning_note = "; ".join(warnings[:5]) if warnings else None
        job.updated_tower_count = stats["updated_tower_count"]
        job.skipped_tower_count = stats["skipped_tower_count"]
        job.missing_geo_count = stats["missing_geo_count"]
        job.unmatched_count = stats["unmatched_count"]
        job.status = "success"
        job.error_message = warning_note
        job.finished_at = utcnow()
        job.update_date = utcnow()
        db.commit()
        _refresh_dataset_usage_status(db, dataset_id=job.dataset_id)

        _publish_elevation_change(
            "elevation.job.success",
            {
                "action": "job_success",
                "job_id": job.id,
                "line_id": line.id,
                "updated_tower_count": job.updated_tower_count,
                "skipped_tower_count": job.skipped_tower_count,
            },
        )
        _publish_line_change(
            "power-lines.elevation.updated",
            {"action": "elevation_updated", "line_id": line.id, "job_id": job.id},
        )
    except Exception as exc:
        db.rollback()
        failed = get_job_by_id(db, job_id)
        if failed:
            failed.status = "failed"
            failed.error_message = str(exc)
            failed.finished_at = utcnow()
            failed.update_date = utcnow()
            db.commit()
            _refresh_dataset_usage_status(db, dataset_id=failed.dataset_id)
            _publish_elevation_change(
                "elevation.job.failed",
                {"action": "job_failed", "job_id": failed.id, "line_id": failed.line_id},
            )
        raise
    finally:
        db.close()


def execute_dataset_analysis_job(*, dataset_id: str, actor_user_id: str | None) -> None:
    db = SessionLocal()
    try:
        item = get_dataset_by_id(db, dataset_id)
        if not item:
            return

        actor = db.execute(select(User).where(User.id == actor_user_id)).scalar_one_or_none() if actor_user_id else None
        if actor is None:
            actor = db.execute(select(User).where(User.status == "active").order_by(User.id.asc())).scalars().first()
        if actor is None:
            return

        analyze_dataset(db, dataset_id=dataset_id, actor=actor)
    finally:
        db.close()


def _ensure_dataset_file_exists(db: Session, *, mount_code: str, file_path: str) -> None:
    mount = _require_mount(db, mount_code.strip())
    driver = _build_driver_or_400(mount)
    normalized_path = normalize_virtual_path(file_path.strip())
    try:
        driver.read_file(normalized_path)
    except StoragePathNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"数据文件不存在: {normalized_path}") from exc
    except StorageInvalidPathError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


def _resolve_dataset_mount_code(db: Session, *, requested_mount_code: str | None) -> str:
    code = _normalize_str(requested_mount_code)
    if code is not None:
        _require_mount(db, code)
        return code

    mounts = list_enabled_mounts(db)
    if not mounts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="无可用文件挂载点")
    return mounts[0].code


def _resolve_dataset_dir(dataset_code: str) -> str:
    normalized_code = _normalize_dataset_code(dataset_code)
    return f"{ELEVATION_DATASET_ROOT}/{normalized_code}"


def _resolve_dataset_file_path(*, dataset_code: str, filename: str | None) -> str:
    normalized_name = _normalize_dataset_filename(filename)
    dataset_dir = _resolve_dataset_dir(dataset_code)
    return join_virtual_path(dataset_dir, normalized_name)


def _normalize_dataset_code(value: str) -> str:
    code = value.strip()
    if not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="数据集编码不能为空")
    if any(char in code for char in ("/", "\\")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="数据集编码不能包含路径分隔符")
    return code


def _normalize_dataset_filename(value: str | None) -> str:
    name = (value or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")
    name = Path(name).name.strip()
    if not name or name in {".", ".."}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不合法")
    suffix = Path(name).suffix.lower()
    if suffix not in IMPORTABLE_ELEVATION_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的高程文件类型: {suffix or 'unknown'}，仅支持 .csv/.img/.tif/.tiff",
        )
    return name


def _ensure_dataset_directory(*, driver: Any, dataset_dir: str) -> None:
    try:
        normalized_dir = normalize_virtual_path(dataset_dir)
        driver.ensure_directory(ELEVATION_DATASET_ROOT)
        driver.ensure_directory(normalized_dir)
    except StorageInvalidPathError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StorageDriverError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


def _read_upload_content(upload: UploadFile) -> bytes:
    name = (upload.filename or "-").strip() or "-"
    try:
        content = upload.file.read()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"读取上传文件失败：{exc}") from exc
    finally:
        try:
            upload.file.close()
        except Exception:
            pass
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"上传文件为空：{name}")
    return content


def _write_dataset_file(
    *,
    driver: Any,
    dataset_dir: str,
    filename: str,
    content: bytes,
    content_type: str | None,
) -> str:
    normalized_name = _normalize_dataset_filename(filename)
    target_path = join_virtual_path(dataset_dir, normalized_name)
    try:
        driver.write_file(
            target_path,
            content=content,
            content_type=content_type or mimetypes.guess_type(normalized_name)[0],
        )
    except StorageInvalidPathError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except StorageDriverError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return target_path


def _extract_zip_to_dataset_directory(
    *,
    driver: Any,
    dataset_dir: str,
    zip_content: bytes,
) -> dict[str, Any]:
    warnings: list[str] = []
    imported_files: list[str] = []
    extracted_count = 0
    try:
        with zipfile.ZipFile(io.BytesIO(zip_content)) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                member_name = Path(member.filename).name
                if not member_name:
                    warnings.append(f"压缩包条目 {member.filename} 文件名无效，已跳过")
                    continue
                suffix = Path(member_name).suffix.lower()
                if suffix not in IMPORTABLE_ELEVATION_EXTENSIONS:
                    warnings.append(f"压缩包条目 {member_name} 类型不支持，已跳过")
                    continue
                try:
                    data = archive.read(member)
                except Exception as exc:
                    warnings.append(f"压缩包条目 {member_name} 读取失败：{exc}")
                    continue
                if not data:
                    warnings.append(f"压缩包条目 {member_name} 内容为空，已跳过")
                    continue
                path = _write_dataset_file(
                    driver=driver,
                    dataset_dir=dataset_dir,
                    filename=member_name,
                    content=data,
                    content_type=mimetypes.guess_type(member_name)[0],
                )
                imported_files.append(path)
                extracted_count += 1
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"ZIP 文件损坏：{exc}") from exc
    return {
        "warnings": warnings,
        "imported_files": imported_files,
        "extracted_count": extracted_count,
    }


def _pick_preferred_dataset_file_path(*, paths: list[str]) -> str | None:
    if not paths:
        return None
    for extension in (".img", ".tif", ".tiff", ".csv"):
        for path in paths:
            if path.lower().endswith(extension):
                return path
    return paths[0]


def _refresh_dataset_usage_status(db: Session, *, dataset_id: str) -> None:
    dataset = get_dataset_by_id(db, dataset_id)
    if dataset is None:
        return
    running_count = int(
        db.scalar(
            select(func.count())
            .select_from(ElevationApplyJob)
            .where(
                ElevationApplyJob.dataset_id == dataset_id,
                ElevationApplyJob.status.in_(("pending", "running")),
            )
        )
        or 0
    )
    next_status = "in_use" if running_count > 0 else "idle"
    if dataset.usage_status != next_status:
        dataset.usage_status = next_status
        dataset.update_date = utcnow()
        db.commit()
        _publish_elevation_change(
            "elevation.dataset.usage_status_changed",
            {"action": "dataset_usage_status_changed", "dataset_id": dataset_id},
        )


def _load_dataset_points(
    db: Session,
    dataset: ElevationDataset,
) -> tuple[list[ElevationSamplePoint], list[str]]:
    mount = _require_mount(db, dataset.mount_code)
    driver = _build_driver_or_400(mount)
    try:
        read_result = driver.read_file(dataset.file_path)
    except StoragePathNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"高程数据文件不存在: {dataset.file_path}") from exc
    except StorageInvalidPathError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    text = _decode_csv_bytes(read_result.content)
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="高程数据文件为空")

    points: list[ElevationSamplePoint] = []
    warnings: list[str] = []
    for index, row in enumerate(rows, start=2):
        lon = _pick_float(row, ["longitude", "lon", "lng", "经度"])
        lat = _pick_float(row, ["latitude", "lat", "纬度"])
        altitude = _pick_float(row, ["altitude_m", "altitude", "elevation", "dem", "海拔m", "高程"])
        if lon is None or lat is None or altitude is None:
            warnings.append(f"第 {index} 行缺少经纬度或高程，已忽略")
            continue
        if lon < -180 or lon > 180 or lat < -90 or lat > 90:
            warnings.append(f"第 {index} 行经纬度越界，已忽略")
            continue
        points.append(ElevationSamplePoint(lon=lon, lat=lat, altitude_m=altitude))

    if not points:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="高程数据文件没有有效样本点")
    return points, warnings


def _compute_dataset_stats(points: list[ElevationSamplePoint]) -> dict[str, float | int]:
    lon_values = [item.lon for item in points]
    lat_values = [item.lat for item in points]
    return {
        "sample_count": len(points),
        "bbox_min_lon": min(lon_values),
        "bbox_max_lon": max(lon_values),
        "bbox_min_lat": min(lat_values),
        "bbox_max_lat": max(lat_values),
    }


def _sample_preview_points_from_csv(
    *,
    points: list[ElevationSamplePoint],
    limit: int,
) -> list[ElevationSamplePoint]:
    if len(points) <= limit:
        return points
    if limit <= 1:
        return [points[0]]
    step = max(1, len(points) // limit)
    sampled = points[::step]
    if len(sampled) > limit:
        sampled = sampled[:limit]
    return sampled


def _analyze_dataset_content(
    db: Session,
    dataset: ElevationDataset,
) -> tuple[dict[str, float | int], list[str]]:
    file_format = _resolve_dataset_file_format(dataset)
    if file_format == "csv":
        points, warnings = _load_dataset_points(db, dataset)
        return _compute_dataset_stats(points), warnings
    if file_format in RASTER_FILE_FORMATS:
        return _compute_raster_stats(db, dataset)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"不支持的高程文件格式: {file_format}",
    )


def _apply_points_to_line_towers(
    db: Session,
    *,
    line_id: str,
    dataset: ElevationDataset,
    mode: str,
    points: list[ElevationSamplePoint],
) -> dict[str, int]:
    towers = db.execute(
        select(LineTower)
        .where(LineTower.line_id == line_id)
        .order_by(LineTower.seq_no.asc(), LineTower.id.asc())
    ).scalars().all()

    updated_tower_count = 0
    skipped_tower_count = 0
    missing_geo_count = 0
    unmatched_count = 0

    for tower in towers:
        if tower.longitude is None or tower.latitude is None:
            missing_geo_count += 1
            continue
        if mode == "fill_null_only" and tower.altitude_m is not None:
            skipped_tower_count += 1
            continue

        match = _find_nearest_point(
            lon=float(tower.longitude),
            lat=float(tower.latitude),
            points=points,
        )
        if match is None:
            unmatched_count += 1
            continue

        altitude, distance_m = match
        if distance_m > NEAREST_MATCH_MAX_DISTANCE_M:
            unmatched_count += 1
            continue

        tower.altitude_m = round(altitude, 3)
        raw_extra = dict(tower.raw_extra_json or {})
        raw_extra["elevation"] = {
            "dataset_id": dataset.id,
            "dataset_code": dataset.code,
            "sample_method": "nearest",
            "sample_distance_m": round(distance_m, 3),
            "sample_distance_source": "computed",
            "sampled_at": utcnow().isoformat(),
        }
        tower.raw_extra_json = raw_extra
        tower.update_date = utcnow()
        updated_tower_count += 1

    db.commit()
    return {
        "updated_tower_count": updated_tower_count,
        "skipped_tower_count": skipped_tower_count,
        "missing_geo_count": missing_geo_count,
        "unmatched_count": unmatched_count,
    }


def _find_nearest_point(
    *,
    lon: float,
    lat: float,
    points: list[ElevationSamplePoint],
) -> tuple[float, float] | None:
    best_altitude: float | None = None
    best_distance: float | None = None

    for point in points:
        distance = _haversine_distance_m(
            lon_a=lon,
            lat_a=lat,
            lon_b=point.lon,
            lat_b=point.lat,
        )
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_altitude = point.altitude_m

    if best_altitude is None or best_distance is None:
        return None
    return best_altitude, best_distance


def _haversine_distance_m(
    *,
    lon_a: float,
    lat_a: float,
    lon_b: float,
    lat_b: float,
) -> float:
    import math

    r = 6371000.0
    lon1 = math.radians(lon_a)
    lat1 = math.radians(lat_a)
    lon2 = math.radians(lon_b)
    lat2 = math.radians(lat_b)
    d_lon = lon2 - lon1
    d_lat = lat2 - lat1

    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def _detect_file_format(file_path: str) -> str:
    extension = Path(file_path).suffix.lower()
    file_format = ELEVATION_FILE_EXT_FORMAT_MAP.get(extension)
    if not file_format:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的高程文件类型: {extension or 'unknown'}，仅支持 .csv/.img/.tif/.tiff",
        )
    return file_format


def _resolve_dataset_file_format(dataset: ElevationDataset) -> str:
    declared = (dataset.file_format or "").strip().lower()
    detected = _detect_file_format(dataset.file_path)
    if declared and declared in ELEVATION_FILE_EXT_FORMAT_MAP.values():
        if declared == detected:
            return declared
        if declared in {"img", "tif", "tiff"} and detected in RASTER_FILE_FORMATS:
            return detected
    return detected


def _require_rasterio_available() -> Any:
    try:
        import rasterio
        import rasterio.warp as rasterio_warp

        if not hasattr(rasterio, "warp"):
            setattr(rasterio, "warp", rasterio_warp)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="当前服务未启用 rasterio 栅格能力，请联系管理员重建 API 镜像后重试 IMG/TIF 分析与回填",
        ) from exc
    return rasterio


def _open_raster_dataset(
    db: Session,
    dataset: ElevationDataset,
) -> _OpenedRasterDataset:
    file_format = _resolve_dataset_file_format(dataset)
    if file_format not in RASTER_FILE_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"当前文件不是栅格高程文件: {dataset.file_path}",
        )

    rasterio = _require_rasterio_available()

    mount = _require_mount(db, dataset.mount_code)
    driver = _build_driver_or_400(mount)
    try:
        read_result = driver.read_file(dataset.file_path)
    except StoragePathNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"高程数据文件不存在: {dataset.file_path}") from exc
    except StorageInvalidPathError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    suffix = Path(dataset.file_path).suffix.lower() or ".img"
    temp_path = ""
    try:
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(read_result.content)
            temp_path = tmp.name
        opened = rasterio.open(temp_path)
        return _OpenedRasterDataset(
            rasterio=rasterio,
            dataset=opened,
            temp_path=temp_path,
        )
    except Exception as exc:
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"高程栅格文件解析失败: {dataset.file_path}",
        ) from exc


def _append_non_wgs84_bounds_warning(*, rasterio: Any, src: Any) -> str | None:
    src_crs = src.crs
    if src_crs is None:
        return "栅格缺少 CRS 定义，默认按 WGS84 经度/纬度采样"
    try:
        src_crs_obj = rasterio.crs.CRS.from_user_input(src_crs)
    except Exception:
        return "栅格 CRS 无法识别，默认按 WGS84 经度/纬度采样，建议先校验源数据"
    if src_crs_obj.to_string() in {"EPSG:4326", "OGC:CRS84"}:
        return None
    if bool(getattr(src_crs_obj, "is_geographic", False)):
        return None
    return (
        f"栅格 CRS 为 {src_crs_obj.to_string()}，数据集边界框基于该投影坐标，"
        "预览渲染会自动转换到 WGS84 经度/纬度"
    )


def _is_masked_value(value: Any) -> bool:
    try:
        import numpy as np
    except ImportError:
        return False
    return bool(np.ma.is_masked(value))


def _almost_equal(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-6


def _is_finite_number(value: float) -> bool:
    import math

    return math.isfinite(value)


def _is_point_within_bounds(*, x: float, y: float, left: float, right: float, bottom: float, top: float) -> bool:
    return left <= x <= right and bottom <= y <= top


def _pick_float(row: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = row.get(key)
        number = _parse_float(value)
        if number is not None:
            return number
    return None


def _decode_csv_bytes(content: bytes) -> str:
    for encoding in CSV_ENCODINGS:
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV 编码不受支持")


def _compute_raster_stats(
    db: Session,
    dataset: ElevationDataset,
) -> tuple[dict[str, float | int], list[str]]:
    warnings: list[str] = []
    with _open_raster_dataset(db, dataset) as opened:
        rasterio = opened.rasterio
        src = opened.dataset
        bounds = src.bounds
        warning_text = _append_non_wgs84_bounds_warning(rasterio=rasterio, src=src)
        if warning_text:
            warnings.append(warning_text)

        width = int(src.width or 0)
        height = int(src.height or 0)
        sample_count = width * height
        if sample_count > MAX_SAMPLE_COUNT_INT:
            sample_count = MAX_SAMPLE_COUNT_INT

        return (
            {
                "sample_count": sample_count,
                "bbox_min_lon": float(bounds.left),
                "bbox_max_lon": float(bounds.right),
                "bbox_min_lat": float(bounds.bottom),
                "bbox_max_lat": float(bounds.top),
            },
            warnings,
        )


def _build_raster_preview(
    db: Session,
    *,
    dataset: ElevationDataset,
    limit: int,
) -> ElevationDatasetPreviewResponse:
    warnings: list[str] = []
    with _open_raster_dataset(db, dataset) as opened:
        rasterio = opened.rasterio
        src = opened.dataset
        warning_text = _append_non_wgs84_bounds_warning(rasterio=rasterio, src=src)
        if warning_text:
            warnings.append(warning_text)

        width = int(src.width or 0)
        height = int(src.height or 0)
        source_bounds = src.bounds
        source_crs_text = str(src.crs) if src.crs is not None else None
        diagnostics = ElevationDatasetPreviewDiagnostics(
            source_crs=source_crs_text,
            source_bounds_min_x=float(source_bounds.left),
            source_bounds_max_x=float(source_bounds.right),
            source_bounds_min_y=float(source_bounds.bottom),
            source_bounds_max_y=float(source_bounds.top),
            raster_width=width,
            raster_height=height,
        )

        if source_crs_text in {"EPSG:4326", "OGC:CRS84"}:
            diagnostics.wgs84_bounds_min_lon = float(source_bounds.left)
            diagnostics.wgs84_bounds_max_lon = float(source_bounds.right)
            diagnostics.wgs84_bounds_min_lat = float(source_bounds.bottom)
            diagnostics.wgs84_bounds_max_lat = float(source_bounds.top)
        elif src.crs is not None:
            try:
                xs, ys = rasterio.warp.transform(
                    src.crs,
                    "EPSG:4326",
                    [float(source_bounds.left), float(source_bounds.right), float(source_bounds.left), float(source_bounds.right)],
                    [float(source_bounds.bottom), float(source_bounds.bottom), float(source_bounds.top), float(source_bounds.top)],
                )
                diagnostics.wgs84_bounds_min_lon = float(min(xs))
                diagnostics.wgs84_bounds_max_lon = float(max(xs))
                diagnostics.wgs84_bounds_min_lat = float(min(ys))
                diagnostics.wgs84_bounds_max_lat = float(max(ys))
            except Exception:
                warnings.append("无法计算栅格转换后的 WGS84 边界范围")

        if width <= 0 or height <= 0:
            return ElevationDatasetPreviewResponse(
                dataset=serialize_dataset(dataset),
                preview_mode="terrain_grid",
                total_points=0,
                sampled_points=0,
                points=[],
                cells=[],
                diagnostics=diagnostics,
                warnings=warnings,
            )

        band_nodata = src.nodatavals[0] if src.nodatavals else None
        total_points = width * height
        sampled_points: list[ElevationDatasetPreviewPoint] = []
        sampled_cells: list[ElevationDatasetPreviewCell] = []

        target_count = max(1, limit)
        step = max(1, int((width * height / target_count) ** 0.5))
        diagnostics.target_samples = target_count
        diagnostics.sampling_step = step
        y = 0
        while y < height and len(sampled_points) < target_count:
            x = 0
            while x < width and len(sampled_points) < target_count:
                diagnostics.scanned_candidates = (diagnostics.scanned_candidates or 0) + 1
                try:
                    value = src.read(1, window=((y, y + 1), (x, x + 1)), masked=True)[0][0]
                except Exception:
                    diagnostics.skip_read_error += 1
                    x += step
                    continue

                if _is_masked_value(value):
                    diagnostics.skip_masked += 1
                    x += step
                    continue
                altitude = float(value)
                if band_nodata is not None and _almost_equal(altitude, float(band_nodata)):
                    diagnostics.skip_nodata += 1
                    x += step
                    continue
                if not _is_finite_number(altitude):
                    diagnostics.skip_nonfinite += 1
                    x += step
                    continue

                world_x, world_y = rasterio.transform.xy(src.transform, y, x, offset="center")
                lon = float(world_x)
                lat = float(world_y)
                if src.crs and str(src.crs) not in {"EPSG:4326", "OGC:CRS84"}:
                    try:
                        xs, ys = rasterio.warp.transform(src.crs, "EPSG:4326", [lon], [lat])
                        lon = float(xs[0])
                        lat = float(ys[0])
                    except Exception as exc:
                        diagnostics.skip_sample_transform_error += 1
                        if diagnostics.sample_tx_first_error is None:
                            diagnostics.sample_tx_first_error = str(exc)
                        x += step
                        continue
                if lon < -180 or lon > 180 or lat < -90 or lat > 90:
                    diagnostics.skip_sample_out_of_range += 1
                    x += step
                    continue

                col_end = min(width - 1, x + step)
                row_end = min(height - 1, y + step)
                try:
                    lon_min, lat_min = rasterio.transform.xy(src.transform, row_end, x, offset="ll")
                    lon_max, lat_max = rasterio.transform.xy(src.transform, y, col_end, offset="ur")
                except Exception:
                    x += step
                    continue
                min_lon = float(min(lon_min, lon_max))
                max_lon = float(max(lon_min, lon_max))
                min_lat = float(min(lat_min, lat_max))
                max_lat = float(max(lat_min, lat_max))
                if src.crs and str(src.crs) not in {"EPSG:4326", "OGC:CRS84"}:
                    try:
                        xs, ys = rasterio.warp.transform(
                            src.crs,
                            "EPSG:4326",
                            [min_lon, max_lon, min_lon, max_lon],
                            [min_lat, min_lat, max_lat, max_lat],
                        )
                    except Exception:
                        diagnostics.skip_cell_transform_error += 1
                        x += step
                        continue
                    min_lon = float(min(xs))
                    max_lon = float(max(xs))
                    min_lat = float(min(ys))
                    max_lat = float(max(ys))
                if min_lon < -180 or max_lon > 180 or min_lat < -90 or max_lat > 90:
                    diagnostics.skip_cell_out_of_range += 1
                    x += step
                    continue
                sampled_cells.append(
                    ElevationDatasetPreviewCell(
                        min_longitude=round(min_lon, 6),
                        max_longitude=round(max_lon, 6),
                        min_latitude=round(min_lat, 6),
                        max_latitude=round(max_lat, 6),
                        altitude_m=round(altitude, 3),
                    )
                )
                sampled_points.append(
                    ElevationDatasetPreviewPoint(
                        longitude=round(lon, 6),
                        latitude=round(lat, 6),
                        altitude_m=round(altitude, 3),
                    )
                )
                x += step
            y += step

        diagnostics.valid_preview_count = len(sampled_cells)
        if not sampled_cells:
            warnings.append("未提取到有效地形网格（可能为 nodata 或投影定义不匹配）")

        return ElevationDatasetPreviewResponse(
            dataset=serialize_dataset(dataset),
            preview_mode="terrain_grid",
            total_points=total_points,
            sampled_points=len(sampled_cells),
            points=sampled_points,
            cells=sampled_cells,
            diagnostics=diagnostics,
            warnings=warnings,
        )


def _apply_raster_to_line_towers(
    db: Session,
    *,
    line_id: str,
    dataset: ElevationDataset,
    mode: str,
) -> tuple[dict[str, int], list[str]]:
    towers = db.execute(
        select(LineTower)
        .where(LineTower.line_id == line_id)
        .order_by(LineTower.seq_no.asc(), LineTower.id.asc())
    ).scalars().all()

    updated_tower_count = 0
    skipped_tower_count = 0
    missing_geo_count = 0
    unmatched_count = 0
    warnings: list[str] = []

    with _open_raster_dataset(db, dataset) as opened:
        rasterio = opened.rasterio
        src = opened.dataset
        warning_text = _append_non_wgs84_bounds_warning(rasterio=rasterio, src=src)
        if warning_text:
            warnings.append(warning_text)
        src_crs = src.crs
        band_nodata = src.nodatavals[0] if src.nodatavals else None

        for tower in towers:
            if tower.longitude is None or tower.latitude is None:
                missing_geo_count += 1
                continue
            if mode == "fill_null_only" and tower.altitude_m is not None:
                skipped_tower_count += 1
                continue

            lon = float(tower.longitude)
            lat = float(tower.latitude)
            transformed_lon = lon
            transformed_lat = lat

            if src_crs and str(src_crs) not in {"EPSG:4326", "OGC:CRS84"}:
                try:
                    xs, ys = rasterio.warp.transform(
                        "EPSG:4326",
                        src_crs,
                        [lon],
                        [lat],
                    )
                    transformed_lon = float(xs[0])
                    transformed_lat = float(ys[0])
                except Exception:
                    unmatched_count += 1
                    continue

            if not _is_point_within_bounds(
                x=transformed_lon,
                y=transformed_lat,
                left=float(src.bounds.left),
                right=float(src.bounds.right),
                bottom=float(src.bounds.bottom),
                top=float(src.bounds.top),
            ):
                unmatched_count += 1
                continue

            try:
                sampled = next(src.sample([(transformed_lon, transformed_lat)], masked=True), None)
            except Exception:
                sampled = None

            if sampled is None or len(sampled) == 0:
                unmatched_count += 1
                continue

            value = sampled[0]
            if _is_masked_value(value):
                unmatched_count += 1
                continue
            if band_nodata is not None and _almost_equal(float(value), float(band_nodata)):
                unmatched_count += 1
                continue

            altitude = float(value)
            if not _is_finite_number(altitude):
                unmatched_count += 1
                continue

            tower.altitude_m = round(altitude, 3)
            raw_extra = dict(tower.raw_extra_json or {})
            raw_extra["elevation"] = {
                "dataset_id": dataset.id,
                "dataset_code": dataset.code,
                "sample_method": "raster_pixel",
                "sample_distance_m": 0.0,
                "sample_distance_source": "pixel_lookup",
                "sampled_at": utcnow().isoformat(),
            }
            tower.raw_extra_json = raw_extra
            tower.update_date = utcnow()
            updated_tower_count += 1

    db.commit()
    return (
        {
            "updated_tower_count": updated_tower_count,
            "skipped_tower_count": skipped_tower_count,
            "missing_geo_count": missing_geo_count,
            "unmatched_count": unmatched_count,
        },
        warnings,
    )


def _normalize_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_float(value: Any) -> float | None:
    text = _normalize_str(value)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _decode_text_bytes_for_import(content: bytes) -> str:
    for encoding in CSV_IMPORT_TEXT_ENCODINGS:
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV 编码不受支持")


def _pick_csv_value(row: dict[str, Any], keys: list[str]) -> str | None:
    normalized_keys = {str(key).strip(): key for key in row.keys()}
    for key in keys:
        actual_key = normalized_keys.get(key)
        if actual_key is None:
            continue
        value = _normalize_str(row.get(actual_key))
        if value is not None:
            return value
    return None


def _parse_csv_optional_positive_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"无效分辨率：{value}") from exc
    if number <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"分辨率必须大于 0：{value}")
    return number


def _publish_elevation_change(event_name: str, payload: dict[str, Any]) -> None:
    _fire_and_forget(
        publish_topic(
            ELEVATION_TOPIC,
            name=event_name,
            payload=payload,
            requires_refetch=["/api/v1/elevation/datasets", "/api/v1/elevation/jobs"],
            dedupe_key=f"{event_name}:{payload.get('job_id') or payload.get('dataset_id') or 'unknown'}",
        )
    )


def _publish_line_change(event_name: str, payload: dict[str, Any]) -> None:
    _fire_and_forget(
        publish_topic(
            POWER_LINES_TOPIC,
            name=event_name,
            payload=payload,
            requires_refetch=["/api/v1/lines"],
            dedupe_key=f"{event_name}:{payload.get('line_id', 'unknown')}",
        )
    )


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
