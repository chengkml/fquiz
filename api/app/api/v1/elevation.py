from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.elevation import (
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
from ...services.elevation_service import (
    analyze_dataset,
    create_apply_job,
    create_dataset,
    get_job_by_id,
    list_datasets,
    list_jobs,
    serialize_job,
    update_dataset,
)

router = APIRouter(prefix="/elevation", tags=["elevation"])


@router.get("/datasets", response_model=ElevationDatasetListResponse)
def get_elevation_datasets(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    _: CurrentUser = Depends(require_any_permission("elevation.read", "elevation.manage")),
    db: Session = Depends(get_db),
) -> ElevationDatasetListResponse:
    return list_datasets(
        db,
        keyword=keyword,
        status_filter=status_filter,
    )


@router.post("/datasets", response_model=ElevationDatasetSummary)
def create_elevation_dataset(
    payload: ElevationDatasetCreateRequest,
    current_user: CurrentUser = Depends(require_permission("elevation.manage")),
    db: Session = Depends(get_db),
) -> ElevationDatasetSummary:
    created = create_dataset(db, payload, actor=current_user.user)
    if not created:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="高程数据集编码已存在")
    return created


@router.patch("/datasets/{dataset_id}", response_model=ElevationDatasetSummary)
def update_elevation_dataset(
    dataset_id: str,
    payload: ElevationDatasetUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("elevation.manage")),
    db: Session = Depends(get_db),
) -> ElevationDatasetSummary:
    updated = update_dataset(db, dataset_id, payload, actor=current_user.user)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="高程数据集不存在")
    return updated


@router.post("/datasets/{dataset_id}/analyze", response_model=ElevationDatasetAnalyzeResponse)
def analyze_elevation_dataset(
    dataset_id: str,
    current_user: CurrentUser = Depends(require_permission("elevation.manage")),
    db: Session = Depends(get_db),
) -> ElevationDatasetAnalyzeResponse:
    return analyze_dataset(db, dataset_id=dataset_id, actor=current_user.user)


@router.get("/jobs", response_model=ElevationApplyJobListResponse)
def get_elevation_jobs(
    line_id: str | None = Query(default=None),
    dataset_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    _: CurrentUser = Depends(require_any_permission("elevation.read", "elevation.manage")),
    db: Session = Depends(get_db),
) -> ElevationApplyJobListResponse:
    return list_jobs(
        db,
        line_id=line_id,
        dataset_id=dataset_id,
        status_filter=status_filter,
        limit=limit,
    )


@router.get("/jobs/{job_id}", response_model=ElevationApplyJobSummary)
def get_elevation_job_detail(
    job_id: str,
    _: CurrentUser = Depends(require_any_permission("elevation.read", "elevation.manage")),
    db: Session = Depends(get_db),
) -> ElevationApplyJobSummary:
    item = get_job_by_id(db, job_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="高程回填任务不存在")
    return serialize_job(item)


@router.post("/jobs/apply-line", response_model=ElevationApplyJobCreateResponse)
def create_elevation_apply_line_job(
    payload: ElevationApplyJobCreateRequest,
    current_user: CurrentUser = Depends(require_permission("elevation.manage")),
    db: Session = Depends(get_db),
) -> ElevationApplyJobCreateResponse:
    return create_apply_job(db, payload, actor=current_user.user)
