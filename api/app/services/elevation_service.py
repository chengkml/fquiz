from __future__ import annotations

import asyncio
import csv
import io
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
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
    ElevationDatasetCreateRequest,
    ElevationDatasetListResponse,
    ElevationDatasetSummary,
    ElevationDatasetUpdateRequest,
)
from .file_service import _build_driver_or_400, _require_mount
from .push_service import publish_topic
from .storage_driver import StorageInvalidPathError, StoragePathNotFoundError

ELEVATION_TOPIC = "admin.elevation"
POWER_LINES_TOPIC = "admin.power-lines"
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "gbk", "latin-1")
NEAREST_MATCH_MAX_DISTANCE_M = 2000.0
ELEVATION_FILE_EXT_FORMAT_MAP = {
    ".csv": "csv",
    ".img": "img",
    ".tif": "tif",
    ".tiff": "tiff",
}
RASTER_FILE_FORMATS = {"img", "tif", "tiff"}
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


def serialize_dataset(item: ElevationDataset) -> ElevationDatasetSummary:
    return ElevationDatasetSummary(
        id=item.id,
        code=item.code,
        name=item.name,
        source=item.source,
        file_format=item.file_format,
        mount_code=item.mount_code,
        file_path=item.file_path,
        resolution_m=item.resolution_m,
        status=item.status,  # type: ignore[arg-type]
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
    if get_dataset_by_code(db, payload.code):
        return None

    normalized_file_path = payload.file_path.strip()
    file_format = _detect_file_format(normalized_file_path)
    if file_format in RASTER_FILE_FORMATS:
        _require_rasterio_available()
    _ensure_dataset_file_exists(db, mount_code=payload.mount_code, file_path=normalized_file_path)

    now = utcnow()
    item = ElevationDataset(
        code=payload.code.strip(),
        name=payload.name.strip(),
        source=_normalize_str(payload.source),
        file_format=file_format,
        mount_code=payload.mount_code.strip(),
        file_path=normalized_file_path,
        resolution_m=payload.resolution_m,
        status="active",
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

    _publish_elevation_change(
        "elevation.job.created",
        {"action": "job_created", "job_id": latest.id, "line_id": latest.line_id},
    )
    return ElevationApplyJobCreateResponse(job=serialize_job(latest), queued=True)


def _dispatch_elevation_apply_task(*, job_id: str):
    from ..tasks.elevation_tasks import apply_elevation_for_line_job

    return apply_elevation_for_line_job.delay(job_id)


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
            _publish_elevation_change(
                "elevation.job.failed",
                {"action": "job_failed", "job_id": failed.id, "line_id": failed.line_id},
            )
        raise
    finally:
        db.close()


def _ensure_dataset_file_exists(db: Session, *, mount_code: str, file_path: str) -> None:
    mount = _require_mount(db, mount_code.strip())
    driver = _build_driver_or_400(mount)
    try:
        driver.read_file(file_path.strip())
    except StoragePathNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"数据文件不存在: {file_path}") from exc
    except StorageInvalidPathError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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
        "回填时会自动从 WGS84 坐标转换后采样"
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
