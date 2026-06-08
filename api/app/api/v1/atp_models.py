from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.atp_model import (
    AtpEngineStatusResponse,
    AtpModelCreateRequest,
    AtpModelListResponse,
    AtpModelSummary,
    AtpModelUpdateRequest,
    AtpModelVersionCreateRequest,
    AtpModelVersionDetail,
    AtpModelVersionListResponse,
    AtpModelVersionUpdateRequest,
    AtpSimulationRunDetail,
    AtpSimulationRunListResponse,
    AtpSimulationRunRequest,
)
from ...services.atp_model_service import (
    activate_model_version,
    create_model,
    create_model_version,
    delete_model,
    get_engine_status,
    get_model_by_id,
    get_model_run_detail,
    get_model_version_by_id,
    list_model_runs,
    list_model_versions,
    list_models,
    run_model_version,
    serialize_model,
    serialize_version_detail,
    update_model,
    update_model_version,
)

router = APIRouter(prefix="/atp/models", tags=["atp-models"])


@router.get("/engine/status", response_model=AtpEngineStatusResponse)
def get_atp_engine_status_endpoint(
    _: CurrentUser = Depends(require_any_permission("atp.read", "atp.run", "atp.manage")),
) -> AtpEngineStatusResponse:
    return get_engine_status()


@router.get("", response_model=AtpModelListResponse)
def get_atp_model_list(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    _: CurrentUser = Depends(require_any_permission("atp.read", "atp.run", "atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelListResponse:
    return list_models(db, keyword=keyword, status_filter=status_filter)


@router.post("", response_model=AtpModelSummary)
def create_atp_model_endpoint(
    payload: AtpModelCreateRequest,
    current_user: CurrentUser = Depends(require_permission("atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelSummary:
    created = create_model(db, payload, actor_user_id=current_user.user.id)
    if not created:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Model code already exists")
    return created


@router.get("/{model_id}", response_model=AtpModelSummary)
def get_atp_model_detail(
    model_id: str,
    _: CurrentUser = Depends(require_any_permission("atp.read", "atp.run", "atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelSummary:
    item = get_model_by_id(db, model_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")

    version_count = int(len(item.versions))
    run_count = int(len(item.runs))
    last_run = item.runs[0] if item.runs else None
    return serialize_model(
        item,
        version_count=version_count,
        run_count=run_count,
        last_run_status=last_run.status if last_run else None,
        last_run_date=last_run.create_date if last_run else None,
    )


@router.patch("/{model_id}", response_model=AtpModelSummary)
def update_atp_model_endpoint(
    model_id: str,
    payload: AtpModelUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelSummary:
    updated = update_model(db, model_id, payload, actor_user_id=current_user.user.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return updated


@router.delete("/{model_id}")
def delete_atp_model_endpoint(
    model_id: str,
    _: CurrentUser = Depends(require_permission("atp.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    deleted = delete_model(db, model_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return {"success": True}


@router.get("/{model_id}/versions", response_model=AtpModelVersionListResponse)
def get_atp_model_versions(
    model_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_any_permission("atp.read", "atp.run", "atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelVersionListResponse:
    if not get_model_by_id(db, model_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return list_model_versions(db, model_id=model_id, limit=limit, offset=offset)


@router.post("/{model_id}/versions", response_model=AtpModelVersionDetail)
def create_atp_model_version_endpoint(
    model_id: str,
    payload: AtpModelVersionCreateRequest,
    current_user: CurrentUser = Depends(require_permission("atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelVersionDetail:
    return create_model_version(db, model_id=model_id, payload=payload, actor_user_id=current_user.user.id)


@router.get("/{model_id}/versions/{version_id}", response_model=AtpModelVersionDetail)
def get_atp_model_version_detail(
    model_id: str,
    version_id: str,
    _: CurrentUser = Depends(require_any_permission("atp.read", "atp.run", "atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelVersionDetail:
    item = get_model_version_by_id(db, model_id=model_id, version_id=version_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    return serialize_version_detail(item)


@router.patch("/{model_id}/versions/{version_id}", response_model=AtpModelVersionDetail)
def update_atp_model_version_endpoint(
    model_id: str,
    version_id: str,
    payload: AtpModelVersionUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelVersionDetail:
    return update_model_version(
        db,
        model_id=model_id,
        version_id=version_id,
        payload=payload,
        actor_user_id=current_user.user.id,
    )


@router.post("/{model_id}/versions/{version_id}/activate", response_model=AtpModelSummary)
def activate_atp_model_version_endpoint(
    model_id: str,
    version_id: str,
    current_user: CurrentUser = Depends(require_permission("atp.manage")),
    db: Session = Depends(get_db),
) -> AtpModelSummary:
    return activate_model_version(
        db,
        model_id=model_id,
        version_id=version_id,
        actor_user_id=current_user.user.id,
    )


@router.get("/{model_id}/runs", response_model=AtpSimulationRunListResponse)
def get_atp_model_runs(
    model_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _: CurrentUser = Depends(require_any_permission("atp.read", "atp.run", "atp.manage")),
    db: Session = Depends(get_db),
) -> AtpSimulationRunListResponse:
    if not get_model_by_id(db, model_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return list_model_runs(db, model_id=model_id, limit=limit, offset=offset)


@router.post("/{model_id}/runs", response_model=AtpSimulationRunDetail)
def run_atp_model_endpoint(
    model_id: str,
    payload: AtpSimulationRunRequest,
    current_user: CurrentUser = Depends(require_any_permission("atp.run", "atp.manage")),
    db: Session = Depends(get_db),
) -> AtpSimulationRunDetail:
    return run_model_version(db, model_id=model_id, payload=payload, actor_user_id=current_user.user.id)


@router.get("/{model_id}/runs/{run_id}", response_model=AtpSimulationRunDetail)
def get_atp_model_run_detail(
    model_id: str,
    run_id: str,
    _: CurrentUser = Depends(require_any_permission("atp.read", "atp.run", "atp.manage")),
    db: Session = Depends(get_db),
) -> AtpSimulationRunDetail:
    if not get_model_by_id(db, model_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return get_model_run_detail(db, model_id=model_id, run_id=run_id)
