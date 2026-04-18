from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.base import utcnow
from ..models.requirement import Requirement, RequirementComment, RequirementEvent
from ..models.user import User
from ..schemas.requirement import (
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
from .push_service import publish_topic
from .user_service import serialize_user

REQUIREMENT_LOAD_OPTIONS = (
    selectinload(Requirement.creator).selectinload(User.roles),
    selectinload(Requirement.assignee).selectinload(User.roles),
    selectinload(Requirement.reviewer).selectinload(User.roles),
)
COMMENT_LOAD_OPTIONS = (
    selectinload(RequirementComment.author).selectinload(User.roles),
)
EVENT_LOAD_OPTIONS = (
    selectinload(RequirementEvent.actor).selectinload(User.roles),
)
TOPIC_NAME = "requirements"
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "PENDING_ANALYSIS": {"OPEN", "PENDING_REVISION", "CANCELLED"},
    "PENDING_REVISION": {"OPEN", "CANCELLED"},
    "OPEN": {"IN_PROGRESS", "PENDING_REVISION", "CANCELLED"},
    "IN_PROGRESS": {"COMPLETED", "PENDING_REVISION", "CANCELLED"},
    "COMPLETED": set(),
    "CANCELLED": set(),
}


def _requirement_stmt():
    return select(Requirement).options(*REQUIREMENT_LOAD_OPTIONS)


def _comment_stmt():
    return select(RequirementComment).options(*COMMENT_LOAD_OPTIONS)


def _event_stmt():
    return select(RequirementEvent).options(*EVENT_LOAD_OPTIONS)


def list_requirements(
    db: Session,
    *,
    keyword: str | None,
    status: str | None,
    priority: str | None,
    assignee_user_id: str | None,
    project_name: str | None,
) -> RequirementListResponse:
    stmt = _requirement_stmt()
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(Requirement.title.ilike(like), Requirement.code.ilike(like)))
    if status:
        stmt = stmt.where(Requirement.status == status)
    if priority:
        stmt = stmt.where(Requirement.priority == priority)
    if assignee_user_id:
        stmt = stmt.where(Requirement.assignee_user_id == assignee_user_id)
    if project_name:
        stmt = stmt.where(Requirement.project_name == project_name)

    requirements = db.execute(stmt.order_by(Requirement.updated_at.desc())).scalars().all()
    return RequirementListResponse(
        items=[serialize_requirement(item) for item in requirements],
        total=len(requirements),
    )


def get_requirement_by_id(db: Session, requirement_id: str) -> Requirement | None:
    return db.execute(_requirement_stmt().where(Requirement.id == requirement_id)).scalar_one_or_none()


def create_requirement(
    db: Session,
    payload: RequirementCreateRequest,
    *,
    actor: User,
) -> RequirementSummary:
    assignee = _load_user_if_exists(db, payload.assignee_user_id)
    if payload.assignee_user_id and not assignee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")

    requirement = Requirement(
        code=_next_requirement_code(db),
        title=payload.title.strip(),
        description=payload.description.strip(),
        status=payload.status,
        priority=payload.priority,
        project_name=_normalize_str(payload.project_name),
        module_name=_normalize_str(payload.module_name),
        source=_normalize_str(payload.source),
        creator_user_id=actor.id,
        assignee_user_id=assignee.id if assignee else None,
        due_at=payload.due_at,
        closed_at=utcnow() if payload.status == "COMPLETED" else None,
    )
    db.add(requirement)
    db.flush()

    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="created",
        from_status=None,
        to_status=requirement.status,
        payload={"code": requirement.code},
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement save failed")
    _publish_requirement_change("requirements.changed", saved, action="created")
    return serialize_requirement(saved)


def update_requirement(
    db: Session,
    requirement_id: str,
    payload: RequirementUpdateRequest,
    *,
    actor: User,
) -> RequirementSummary:
    requirement = get_requirement_by_id(db, requirement_id)
    if not requirement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "assignee_user_id" in update_data:
        assignee = _load_user_if_exists(db, update_data["assignee_user_id"])
        if update_data["assignee_user_id"] and not assignee:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")
        requirement.assignee_user_id = assignee.id if assignee else None

    for field in ["title", "description", "priority", "project_name", "module_name", "source", "due_at"]:
        if field in update_data:
            value = update_data[field]
            setattr(requirement, field, _normalize_str(value) if isinstance(value, str) else value)

    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="updated",
        from_status=requirement.status,
        to_status=requirement.status,
        payload={"fields": sorted(update_data.keys())},
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement load failed")
    _publish_requirement_change("requirements.changed", saved, action="updated")
    return serialize_requirement(saved)


def assign_requirement(
    db: Session,
    requirement_id: str,
    payload: RequirementAssignRequest,
    *,
    actor: User,
) -> RequirementSummary:
    requirement = get_requirement_by_id(db, requirement_id)
    if not requirement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

    assignee = _load_user_if_exists(db, payload.assignee_user_id)
    if payload.assignee_user_id and not assignee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")

    previous_assignee = requirement.assignee_user_id
    requirement.assignee_user_id = assignee.id if assignee else None
    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="assigned",
        from_status=requirement.status,
        to_status=requirement.status,
        payload={
            "previous_assignee_user_id": previous_assignee,
            "assignee_user_id": requirement.assignee_user_id,
        },
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement load failed")
    _publish_requirement_change("requirements.changed", saved, action="assigned")
    return serialize_requirement(saved)


def claim_requirement(db: Session, requirement_id: str, *, actor: User) -> RequirementSummary:
    return assign_requirement(
        db,
        requirement_id,
        RequirementAssignRequest(assignee_user_id=actor.id),
        actor=actor,
    )


def transition_requirement(
    db: Session,
    requirement_id: str,
    payload: RequirementTransitionRequest,
    *,
    actor: User,
) -> RequirementSummary:
    requirement = get_requirement_by_id(db, requirement_id)
    if not requirement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")

    current_status = requirement.status
    target_status = payload.status
    if current_status == target_status:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status is unchanged")
    if target_status not in ALLOWED_TRANSITIONS.get(current_status, set()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transition not allowed: {current_status} -> {target_status}",
        )

    requirement.status = target_status
    requirement.closed_at = utcnow() if target_status == "COMPLETED" else None
    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="transitioned",
        from_status=current_status,
        to_status=target_status,
        payload={"note": _normalize_str(payload.note)},
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement load failed")
    _publish_requirement_change("requirements.transitioned", saved, action="transitioned")
    return serialize_requirement(saved)


def delete_requirement(db: Session, requirement_id: str, *, actor: User) -> bool:
    requirement = get_requirement_by_id(db, requirement_id)
    if not requirement:
        return False

    deleted_id = requirement.id
    deleted_code = requirement.code
    db.delete(requirement)
    db.commit()

    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name="requirements.deleted",
            payload={
                "action": "deleted",
                "requirement_id": deleted_id,
                "code": deleted_code,
                "actor_user_id": actor.id,
            },
            requires_refetch=[
                "/api/v1/requirements",
                f"/api/v1/requirements/{deleted_id}",
            ],
            dedupe_key=f"requirements:deleted:{deleted_id}",
        )
    )
    return True


def list_requirement_comments(db: Session, requirement_id: str) -> list[RequirementCommentPublic]:
    _require_requirement_exists(db, requirement_id)
    comments = db.execute(
        _comment_stmt()
        .where(RequirementComment.requirement_id == requirement_id)
        .order_by(RequirementComment.created_at.desc())
    ).scalars().all()
    return [serialize_comment(item) for item in comments]


def add_requirement_comment(
    db: Session,
    requirement_id: str,
    payload: RequirementCommentCreateRequest,
    *,
    actor: User,
) -> RequirementCommentPublic:
    requirement = _require_requirement_exists(db, requirement_id)
    comment = RequirementComment(
        requirement_id=requirement.id,
        author_user_id=actor.id,
        content=payload.content.strip(),
        kind=payload.kind,
    )
    db.add(comment)
    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="commented",
        from_status=requirement.status,
        to_status=requirement.status,
        payload={"kind": payload.kind},
    )
    db.commit()

    saved = db.execute(_comment_stmt().where(RequirementComment.id == comment.id)).scalar_one()
    latest_requirement = get_requirement_by_id(db, requirement.id)
    if latest_requirement:
        _publish_requirement_change(
            "requirements.commented",
            latest_requirement,
            action="commented",
            extra_payload={"comment_id": saved.id, "kind": saved.kind},
        )
    return serialize_comment(saved)


def list_requirement_events(db: Session, requirement_id: str) -> list[RequirementEventPublic]:
    _require_requirement_exists(db, requirement_id)
    events = db.execute(
        _event_stmt()
        .where(RequirementEvent.requirement_id == requirement_id)
        .order_by(RequirementEvent.created_at.desc(), RequirementEvent.id.desc())
    ).scalars().all()
    return [serialize_event(item) for item in events]


def serialize_requirement(requirement: Requirement) -> RequirementSummary:
    return RequirementSummary(
        id=requirement.id,
        code=requirement.code,
        title=requirement.title,
        description=requirement.description,
        status=requirement.status,
        priority=requirement.priority,
        project_name=requirement.project_name,
        module_name=requirement.module_name,
        source=requirement.source,
        creator_user_id=requirement.creator_user_id,
        assignee_user_id=requirement.assignee_user_id,
        reviewer_user_id=requirement.reviewer_user_id,
        due_at=requirement.due_at,
        closed_at=requirement.closed_at,
        created_at=requirement.created_at,
        updated_at=requirement.updated_at,
        creator=serialize_user(requirement.creator) if requirement.creator else None,
        assignee=serialize_user(requirement.assignee) if requirement.assignee else None,
        reviewer=serialize_user(requirement.reviewer) if requirement.reviewer else None,
    )


def serialize_comment(comment: RequirementComment) -> RequirementCommentPublic:
    return RequirementCommentPublic(
        id=comment.id,
        requirement_id=comment.requirement_id,
        author_user_id=comment.author_user_id,
        content=comment.content,
        kind=comment.kind,
        created_at=comment.created_at,
        author=serialize_user(comment.author) if comment.author else None,
    )


def serialize_event(event: RequirementEvent) -> RequirementEventPublic:
    return RequirementEventPublic(
        id=event.id,
        requirement_id=event.requirement_id,
        actor_user_id=event.actor_user_id,
        event_type=event.event_type,
        from_status=event.from_status,
        to_status=event.to_status,
        payload_json=event.payload_json,
        created_at=event.created_at,
        actor=serialize_user(event.actor) if event.actor else None,
    )


def _append_event(
    db: Session,
    *,
    requirement_id: str,
    actor_user_id: str | None,
    event_type: str,
    from_status: str | None,
    to_status: str | None,
    payload: dict | None,
) -> None:
    db.add(
        RequirementEvent(
            requirement_id=requirement_id,
            actor_user_id=actor_user_id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            payload_json=payload,
        )
    )


def _publish_requirement_change(
    event_name: str,
    requirement: Requirement,
    *,
    action: str,
    extra_payload: dict | None = None,
) -> None:
    payload = {
        "action": action,
        "requirement_id": requirement.id,
        "code": requirement.code,
        "status": requirement.status,
        "assignee_user_id": requirement.assignee_user_id,
    }
    if extra_payload:
        payload.update(extra_payload)
    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name=event_name,
            payload=payload,
            requires_refetch=[
                "/api/v1/requirements",
                f"/api/v1/requirements/{requirement.id}",
                f"/api/v1/requirements/{requirement.id}/comments",
                f"/api/v1/requirements/{requirement.id}/events",
            ],
            dedupe_key=f"requirements:{action}:{requirement.id}",
        )
    )


def _load_user_if_exists(db: Session, user_id: str | None) -> User | None:
    if not user_id:
        return None
    return db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()


def _require_requirement_exists(db: Session, requirement_id: str) -> Requirement:
    requirement = get_requirement_by_id(db, requirement_id)
    if not requirement:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    return requirement


def _normalize_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _next_requirement_code(db: Session) -> str:
    year = datetime.utcnow().year
    prefix = f"REQ-{year}-"
    existing_codes = db.execute(select(Requirement.code).where(Requirement.code.like(f"{prefix}%"))).scalars().all()
    max_seq = 0
    for code in existing_codes:
        try:
            seq = int(code.removeprefix(prefix))
        except ValueError:
            continue
        max_seq = max(max_seq, seq)
    return f"{prefix}{max_seq + 1:04d}"


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
