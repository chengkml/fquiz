from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.dependencies import CurrentUser, require_any_permission, require_permission
from ..schemas.auth import MessageResponse
from ..services.requirement_service import (
    analyze_requirement_legacy,
    design_requirement_legacy,
    get_history_options_legacy,
    get_pending_requirement_legacy,
    get_requirement_legacy,
    list_lifecycle_legacy,
    review_requirement_legacy,
    search_requirements_legacy,
    update_status_legacy,
)

router = APIRouter(prefix="/api/project/requirement", tags=["project-requirement"])


class RequirementSearchLegacyRequest(BaseModel):
    title: str | None = None
    projectName: str | None = None
    status: str | None = None
    priority: str | None = None
    pageNum: int = Field(default=1, ge=1)
    pageSize: int = Field(default=10, ge=1, le=500)


class RequirementAnalyzeLegacyRequest(BaseModel):
    descr: str | None = None
    progressPercent: int | None = Field(default=None, ge=0, le=100)


class RequirementReviewLegacyRequest(BaseModel):
    decision: Literal["TO_REVISION", "TO_OPEN"]
    descr: str | None = None
    comment: str | None = None


@router.get("/pending")
def get_pending_requirement(
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> dict | None:
    return get_pending_requirement_legacy(db)


@router.post("/search")
def search_requirements(
    payload: RequirementSearchLegacyRequest,
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> dict:
    return search_requirements_legacy(
        db,
        page_num=payload.pageNum,
        page_size=payload.pageSize,
        project_name=payload.projectName,
        status_value=payload.status,
        priority_value=payload.priority,
        title=payload.title,
    )


@router.get("/get/{requirement_id}")
def get_requirement(
    requirement_id: str,
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> dict:
    return get_requirement_legacy(db, requirement_id)


@router.post("/{requirement_id}/status", response_model=MessageResponse)
def update_requirement_status(
    requirement_id: str,
    status_value: str = Query(..., alias="status"),
    result_msg: str | None = Query(default=None, alias="resultMsg"),
    progress_percent: int | None = Query(default=None, alias="progressPercent"),
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> MessageResponse:
    update_status_legacy(
        db,
        requirement_id=requirement_id,
        status_value=status_value,
        result_msg=result_msg,
        progress_percent=progress_percent,
        actor_user_id=current_user.user.id,
    )
    return MessageResponse(message="Requirement status updated")


@router.post("/{requirement_id}/analyze")
def analyze_requirement(
    requirement_id: str,
    payload: RequirementAnalyzeLegacyRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return analyze_requirement_legacy(
        db,
        requirement_id=requirement_id,
        descr=payload.descr,
        progress_percent=payload.progressPercent,
        actor_user_id=current_user.user.id,
    )


@router.post("/{requirement_id}/design")
def design_requirement(
    requirement_id: str,
    payload: RequirementAnalyzeLegacyRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return design_requirement_legacy(
        db,
        requirement_id=requirement_id,
        descr=payload.descr,
        actor_user_id=current_user.user.id,
    )


@router.post("/{requirement_id}/review")
def review_requirement(
    requirement_id: str,
    payload: RequirementReviewLegacyRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> dict:
    return review_requirement_legacy(
        db,
        requirement_id=requirement_id,
        decision=payload.decision,
        descr=payload.descr,
        comment=payload.comment,
        actor_user_id=current_user.user.id,
    )


@router.get("/{requirement_id}/lifecycle")
def get_requirement_lifecycle(
    requirement_id: str,
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> list[dict]:
    return list_lifecycle_legacy(db, requirement_id)


@router.get("/history-options")
def get_requirement_history_options(
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> dict:
    return get_history_options_legacy(db)
