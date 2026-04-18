from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, get_current_user, require_any_permission, require_permission
from ...schemas.auth import MessageResponse
from ...schemas.requirement import (
    RequirementAssignRequest,
    RequirementCommentCreateRequest,
    RequirementCommentPublic,
    RequirementCreateRequest,
    RequirementEventPublic,
    RequirementListResponse,
    RequirementSummary,
    RequirementTransitionRequest,
    RequirementUpdateRequest,
)
from ...services.requirement_service import (
    add_requirement_comment,
    assign_requirement,
    claim_requirement,
    create_requirement,
    delete_requirement,
    get_requirement_by_id,
    list_requirement_comments,
    list_requirement_events,
    list_requirements,
    serialize_requirement,
    transition_requirement,
    update_requirement,
)

router = APIRouter(prefix="/requirements", tags=["requirements"])


@router.get("", response_model=RequirementListResponse)
def get_requirement_list(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    assignee_user_id: str | None = Query(default=None),
    project_name: str | None = Query(default=None),
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> RequirementListResponse:
    return list_requirements(
        db,
        keyword=keyword,
        status=status_filter,
        priority=priority,
        assignee_user_id=assignee_user_id,
        project_name=project_name,
    )


@router.post("", response_model=RequirementSummary)
def create_requirement_endpoint(
    payload: RequirementCreateRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.create", "requirement.manage")),
    db: Session = Depends(get_db),
) -> RequirementSummary:
    return create_requirement(db, payload, actor=current_user.user)


@router.get("/{requirement_id}", response_model=RequirementSummary)
def get_requirement_detail(
    requirement_id: str,
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> RequirementSummary:
    requirement = get_requirement_by_id(db, requirement_id)
    if not requirement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    return serialize_requirement(requirement)


@router.patch("/{requirement_id}", response_model=RequirementSummary)
def update_requirement_endpoint(
    requirement_id: str,
    payload: RequirementUpdateRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> RequirementSummary:
    return update_requirement(db, requirement_id, payload, actor=current_user.user)


@router.post("/{requirement_id}/assign", response_model=RequirementSummary)
def assign_requirement_endpoint(
    requirement_id: str,
    payload: RequirementAssignRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> RequirementSummary:
    return assign_requirement(db, requirement_id, payload, actor=current_user.user)


@router.post("/{requirement_id}/claim", response_model=RequirementSummary)
def claim_requirement_endpoint(
    requirement_id: str,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> RequirementSummary:
    return claim_requirement(db, requirement_id, actor=current_user.user)


@router.post("/{requirement_id}/transition", response_model=RequirementSummary)
def transition_requirement_endpoint(
    requirement_id: str,
    payload: RequirementTransitionRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> RequirementSummary:
    return transition_requirement(db, requirement_id, payload, actor=current_user.user)


@router.delete("/{requirement_id}", response_model=MessageResponse)
def delete_requirement_endpoint(
    requirement_id: str,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> MessageResponse:
    deleted = delete_requirement(db, requirement_id, actor=current_user.user)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    return MessageResponse(message="Requirement deleted")


@router.get("/{requirement_id}/comments", response_model=list[RequirementCommentPublic])
def get_requirement_comments(
    requirement_id: str,
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> list[RequirementCommentPublic]:
    return list_requirement_comments(db, requirement_id)


@router.post("/{requirement_id}/comments", response_model=RequirementCommentPublic)
def create_requirement_comment(
    requirement_id: str,
    payload: RequirementCommentCreateRequest,
    current_user: CurrentUser = Depends(require_any_permission("requirement.process", "requirement.manage")),
    db: Session = Depends(get_db),
) -> RequirementCommentPublic:
    return add_requirement_comment(db, requirement_id, payload, actor=current_user.user)


@router.get("/{requirement_id}/events", response_model=list[RequirementEventPublic])
def get_requirement_events(
    requirement_id: str,
    _: CurrentUser = Depends(require_permission("requirement.read")),
    db: Session = Depends(get_db),
) -> list[RequirementEventPublic]:
    return list_requirement_events(db, requirement_id)
