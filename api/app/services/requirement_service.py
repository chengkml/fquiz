from __future__ import annotations

import asyncio
import math

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.requirement import Requirement, RequirementComment, RequirementEvent
from ..models.rbac import Role
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

TOPIC_NAME = "requirements"

ZERO_PROGRESS_STATUSES = {
    "PENDING_ANALYSIS",
    "PENDING_REVIEW",
    "PENDING_REVISION",
    "OPEN",
}
VALID_STATUSES = {
    "PENDING_ANALYSIS",
    "PENDING_REVIEW",
    "PENDING_REVISION",
    "OPEN",
    "IN_PROGRESS",
    "COMPLETED",
    "CLOSED",
}
STATUS_ALIASES = {"CANCELLED": "CLOSED"}
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "PENDING_ANALYSIS": {"PENDING_REVIEW", "PENDING_REVISION", "OPEN", "CLOSED"},
    "PENDING_REVIEW": {"PENDING_REVISION", "OPEN", "CLOSED"},
    "PENDING_REVISION": {"OPEN", "CLOSED"},
    "OPEN": {"IN_PROGRESS", "CLOSED"},
    "IN_PROGRESS": {"COMPLETED", "PENDING_REVISION", "CLOSED"},
    "COMPLETED": {"CLOSED"},
    "CLOSED": set(),
}

VALID_PRIORITIES = {"LOW", "MEDIUM", "HIGH"}
PRIORITY_ALIASES = {"URGENT": "HIGH"}

COMMENT_LOAD_OPTIONS = (selectinload(RequirementComment.author).selectinload(User.roles),)


def list_requirements(
    db: Session,
    *,
    keyword: str | None,
    status: str | None,
    priority: str | None,
    assignee_user_id: str | None,
    project_name: str | None,
) -> RequirementListResponse:
    stmt = select(Requirement)
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(
            or_(
                Requirement.title.ilike(like),
                Requirement.id.ilike(like),
                Requirement.project_name.ilike(like),
            )
        )
    if status:
        stmt = stmt.where(Requirement.status == _normalize_status(status))
    if priority:
        stmt = stmt.where(Requirement.priority == _normalize_priority(priority))
    if assignee_user_id:
        # 兼容筛选参数：老表中无 assignee 字段，使用 create_user 近似过滤。
        stmt = stmt.where(Requirement.create_user == assignee_user_id)
    if project_name:
        stmt = stmt.where(Requirement.project_name == project_name)

    requirements = db.execute(stmt.order_by(Requirement.update_date.desc())).scalars().all()
    user_map = _load_users_for_requirements(db, requirements)
    return RequirementListResponse(
        items=[serialize_requirement(item, user_map=user_map) for item in requirements],
        total=len(requirements),
    )


def get_requirement_by_id(db: Session, requirement_id: str) -> Requirement | None:
    return db.execute(select(Requirement).where(Requirement.id == requirement_id)).scalar_one_or_none()


def create_requirement(
    db: Session,
    payload: RequirementCreateRequest,
    *,
    actor: User,
) -> RequirementSummary:
    requirement = Requirement(
        title=payload.title.strip(),
        descr=payload.description.strip(),
        status=_normalize_status(payload.status),
        priority=_normalize_priority(payload.priority),
        project_name=_normalize_str(payload.project_name),
        git_url=_normalize_str(payload.source),
        branch=_normalize_str(payload.module_name) or "main",
        create_user=actor.id,
        update_user=actor.id,
    )
    _apply_progress_by_status(requirement, None)
    db.add(requirement)
    db.flush()

    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="CREATE",
        from_status=None,
        to_status=requirement.status,
        before_descr=None,
        after_descr=requirement.descr,
        remark="创建需求",
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement save failed")
    _publish_requirement_change("requirements.changed", saved, action="created")
    return serialize_requirement(saved, user_map={actor.id: actor})


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

    before_descr = requirement.descr
    update_data = payload.model_dump(exclude_unset=True)

    if "title" in update_data and update_data["title"] is not None:
        requirement.title = update_data["title"].strip()
    if "description" in update_data and update_data["description"] is not None:
        requirement.descr = update_data["description"].strip()
    if "priority" in update_data and update_data["priority"] is not None:
        requirement.priority = _normalize_priority(update_data["priority"])
    if "project_name" in update_data:
        requirement.project_name = _normalize_str(update_data["project_name"])
    if "module_name" in update_data:
        requirement.branch = _normalize_str(update_data["module_name"]) or "main"
    if "source" in update_data:
        requirement.git_url = _normalize_str(update_data["source"])

    requirement.update_user = actor.id
    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="EDIT",
        from_status=requirement.status,
        to_status=requirement.status,
        before_descr=before_descr,
        after_descr=requirement.descr,
        remark="更新需求",
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement load failed")
    _publish_requirement_change("requirements.changed", saved, action="updated")
    return serialize_requirement(saved, user_map={actor.id: actor})


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

    assignee_user_id = _normalize_str(payload.assignee_user_id)
    if assignee_user_id:
        assignee = _load_user_if_exists(db, assignee_user_id)
        if not assignee:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")

    requirement.update_user = actor.id
    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="EDIT",
        from_status=requirement.status,
        to_status=requirement.status,
        before_descr=requirement.descr,
        after_descr=requirement.descr,
        remark=f"指派: {assignee_user_id or 'UNASSIGNED'}",
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement load failed")
    _publish_requirement_change("requirements.changed", saved, action="assigned")
    user_map = _load_users_for_requirements(db, [saved])
    if actor.id not in user_map:
        user_map[actor.id] = actor
    return serialize_requirement(saved, user_map=user_map)


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

    current_status = _normalize_status(requirement.status)
    target_status = _normalize_status(payload.status)
    if current_status == target_status:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status is unchanged")
    if target_status not in ALLOWED_TRANSITIONS.get(current_status, set()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transition not allowed: {current_status} -> {target_status}",
        )

    requirement.status = target_status
    requirement.update_user = actor.id
    if payload.note is not None:
        requirement.result_msg = _normalize_str(payload.note)
    _apply_progress_by_status(requirement, None)
    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor.id,
        event_type="STATUS_CHANGE",
        from_status=current_status,
        to_status=target_status,
        before_descr=requirement.descr,
        after_descr=requirement.descr,
        remark=_normalize_str(payload.note),
    )
    db.commit()

    saved = get_requirement_by_id(db, requirement.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Requirement load failed")
    _publish_requirement_change("requirements.transitioned", saved, action="transitioned")
    return serialize_requirement(saved, user_map={actor.id: actor})


def delete_requirement(db: Session, requirement_id: str, *, actor: User) -> bool:
    requirement = get_requirement_by_id(db, requirement_id)
    if not requirement:
        return False

    deleted_id = requirement.id
    db.delete(requirement)
    db.commit()

    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name="requirements.deleted",
            payload={
                "action": "deleted",
                "requirement_id": deleted_id,
                "code": deleted_id,
                "actor_user_id": actor.id,
            },
            requires_refetch=[],
            dedupe_key=f"requirements:deleted:{deleted_id}",
        )
    )
    return True


def list_requirement_comments(db: Session, requirement_id: str) -> list[RequirementCommentPublic]:
    _require_requirement_exists(db, requirement_id)
    comments = db.execute(
        select(RequirementComment)
        .options(*COMMENT_LOAD_OPTIONS)
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
        event_type="EDIT",
        from_status=requirement.status,
        to_status=requirement.status,
        before_descr=requirement.descr,
        after_descr=requirement.descr,
        remark=f"comment:{payload.kind}",
    )
    db.commit()

    saved = db.execute(
        select(RequirementComment)
        .options(*COMMENT_LOAD_OPTIONS)
        .where(RequirementComment.id == comment.id)
    ).scalar_one()
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
        select(RequirementEvent)
        .where(RequirementEvent.requirement_id == requirement_id)
        .order_by(RequirementEvent.create_date.desc(), RequirementEvent.id.desc())
    ).scalars().all()
    user_ids = [event.create_user for event in events if event.create_user]
    user_map = _load_users_by_ids(db, user_ids)
    return [serialize_event(item, user_map=user_map) for item in events]


def serialize_requirement(
    requirement: Requirement,
    *,
    user_map: dict[str, User] | None = None,
) -> RequirementSummary:
    creator = None
    if requirement.create_user:
        if user_map and requirement.create_user in user_map:
            creator = user_map[requirement.create_user]

    return RequirementSummary(
        id=requirement.id,
        code=requirement.id,
        title=requirement.title,
        description=requirement.descr or "",
        status=_to_api_status(requirement.status),
        priority=_to_api_priority(requirement.priority),
        project_name=requirement.project_name,
        module_name=requirement.branch,
        source=requirement.git_url,
        creator_user_id=requirement.create_user,
        assignee_user_id=None,
        reviewer_user_id=None,
        due_at=None,
        closed_at=requirement.update_date if requirement.status in {"COMPLETED", "CLOSED"} else None,
        created_at=requirement.create_date,
        updated_at=requirement.update_date,
        result_msg=requirement.result_msg,
        progress_percent=_normalize_progress(requirement.progress_percent),
        git_url=requirement.git_url,
        branch=requirement.branch,
        creator=serialize_user(creator) if creator else None,
        assignee=None,
        reviewer=None,
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


def serialize_event(
    event: RequirementEvent,
    *,
    user_map: dict[str, User] | None = None,
) -> RequirementEventPublic:
    actor = None
    if event.create_user and user_map and event.create_user in user_map:
        actor = user_map[event.create_user]
    return RequirementEventPublic(
        id=event.id,
        requirement_id=event.requirement_id,
        actor_user_id=event.create_user,
        event_type=event.event_type,
        from_status=event.from_status,
        to_status=event.to_status,
        payload_json={
            "before_descr": event.before_descr,
            "after_descr": event.after_descr,
            "remark": event.remark,
        },
        created_at=event.create_date,
        actor=serialize_user(actor) if actor else None,
    )


def _append_event(
    db: Session,
    *,
    requirement_id: str,
    actor_user_id: str | None,
    event_type: str,
    from_status: str | None,
    to_status: str | None,
    before_descr: str | None,
    after_descr: str | None,
    remark: str | None,
) -> None:
    db.add(
        RequirementEvent(
            requirement_id=requirement_id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            before_descr=before_descr,
            after_descr=after_descr,
            remark=remark,
            create_user=actor_user_id,
            update_user=actor_user_id,
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
        "code": requirement.id,
        "status": requirement.status,
        "assignee_user_id": None,
    }
    if extra_payload:
        payload.update(extra_payload)
    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name=event_name,
            payload=payload,
            requires_refetch=[],
            dedupe_key=f"requirements:{action}:{requirement.id}",
        )
    )


def _load_user_if_exists(db: Session, user_id: str | None) -> User | None:
    if not user_id:
        return None
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user_id)
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def _load_users_by_ids(db: Session, user_ids: list[str]) -> dict[str, User]:
    normalized = sorted({user_id for user_id in user_ids if user_id})
    if not normalized:
        return {}
    stmt = (
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id.in_(normalized))
    )
    users = db.execute(stmt).unique().scalars().all()
    return {user.id: user for user in users}


def _load_users_for_requirements(db: Session, requirements: list[Requirement]) -> dict[str, User]:
    user_ids = [item.create_user for item in requirements if item.create_user]
    return _load_users_by_ids(db, user_ids)


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


def _normalize_status(value: str) -> str:
    normalized = (value or "").strip().upper()
    if normalized in STATUS_ALIASES:
        normalized = STATUS_ALIASES[normalized]
    if normalized not in VALID_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid status: {value}")
    return normalized


def _to_api_status(value: str | None) -> str:
    if not value:
        return "PENDING_ANALYSIS"
    normalized = value.strip().upper()
    if normalized in STATUS_ALIASES:
        normalized = STATUS_ALIASES[normalized]
    if normalized in VALID_STATUSES:
        return normalized
    return "PENDING_ANALYSIS"


def _normalize_priority(value: str) -> str:
    normalized = (value or "").strip().upper()
    if normalized in PRIORITY_ALIASES:
        normalized = PRIORITY_ALIASES[normalized]
    if normalized not in VALID_PRIORITIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid priority: {value}")
    return normalized


def _to_api_priority(value: str | None) -> str:
    normalized = (value or "").strip().upper()
    if normalized == "LOW":
        return "low"
    if normalized == "HIGH":
        return "high"
    return "medium"


def _normalize_progress(progress_percent: int | None) -> int:
    if progress_percent is None:
        return 0
    return max(0, min(100, int(progress_percent)))


def _apply_progress_by_status(requirement: Requirement, progress_percent: int | None) -> None:
    if progress_percent is not None:
        requirement.progress_percent = _normalize_progress(progress_percent)
        return
    if requirement.status == "COMPLETED":
        requirement.progress_percent = 100
        return
    if requirement.status in ZERO_PROGRESS_STATUSES:
        requirement.progress_percent = 0
        return
    requirement.progress_percent = _normalize_progress(requirement.progress_percent)


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)


def get_pending_requirement_legacy(db: Session) -> dict | None:
    requirement = db.execute(
        select(Requirement)
        .where(Requirement.status == "OPEN")
        .order_by(Requirement.create_date.asc())
        .limit(1)
    ).scalar_one_or_none()
    if not requirement:
        return None
    return serialize_requirement_legacy(requirement)


def search_requirements_legacy(
    db: Session,
    *,
    page_num: int,
    page_size: int,
    project_name: str | None,
    status_value: str | None,
    priority_value: str | None,
    title: str | None,
) -> dict:
    normalized_page_num = max(page_num, 1)
    normalized_page_size = max(page_size, 1)
    stmt = select(Requirement)
    total_stmt = select(func.count()).select_from(Requirement)

    if project_name:
        stmt = stmt.where(Requirement.project_name.ilike(f"%{project_name.strip()}%"))
        total_stmt = total_stmt.where(Requirement.project_name.ilike(f"%{project_name.strip()}%"))
    if title:
        stmt = stmt.where(Requirement.title.ilike(f"%{title.strip()}%"))
        total_stmt = total_stmt.where(Requirement.title.ilike(f"%{title.strip()}%"))
    if status_value:
        db_status = _normalize_status(status_value)
        stmt = stmt.where(Requirement.status == db_status)
        total_stmt = total_stmt.where(Requirement.status == db_status)
    if priority_value:
        db_priority = _normalize_priority(priority_value)
        stmt = stmt.where(Requirement.priority == db_priority)
        total_stmt = total_stmt.where(Requirement.priority == db_priority)

    total = int(db.scalar(total_stmt) or 0)
    rows = db.execute(
        stmt.order_by(Requirement.create_date.desc())
        .offset((normalized_page_num - 1) * normalized_page_size)
        .limit(normalized_page_size)
    ).scalars().all()
    total_pages = math.ceil(total / normalized_page_size) if total > 0 else 0
    return {
        "content": [serialize_requirement_legacy(item) for item in rows],
        "totalElements": total,
        "totalPages": total_pages,
        "size": normalized_page_size,
        "number": normalized_page_num - 1,
    }


def get_requirement_legacy(db: Session, requirement_id: str) -> dict:
    requirement = _require_requirement_exists(db, requirement_id)
    return serialize_requirement_legacy(requirement)


def update_status_legacy(
    db: Session,
    *,
    requirement_id: str,
    status_value: str,
    result_msg: str | None,
    progress_percent: int | None,
    actor_user_id: str | None,
) -> None:
    requirement = _require_requirement_exists(db, requirement_id)
    from_status = requirement.status
    before_descr = requirement.descr

    requirement.status = _normalize_status(status_value)
    if _normalize_str(result_msg):
        requirement.result_msg = _normalize_str(result_msg)
    _apply_progress_by_status(requirement, progress_percent)
    if actor_user_id:
        requirement.update_user = actor_user_id

    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor_user_id,
        event_type="STATUS_CHANGE",
        from_status=from_status,
        to_status=requirement.status,
        before_descr=before_descr,
        after_descr=requirement.descr,
        remark=_normalize_str(result_msg),
    )
    db.commit()


def analyze_requirement_legacy(
    db: Session,
    *,
    requirement_id: str,
    descr: str | None,
    progress_percent: int | None,
    actor_user_id: str | None,
) -> dict:
    requirement = _require_requirement_exists(db, requirement_id)
    if requirement.status != "PENDING_ANALYSIS":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PENDING_ANALYSIS can be analyzed")

    from_status = requirement.status
    before_descr = requirement.descr
    if descr is not None:
        requirement.descr = descr
    requirement.status = "PENDING_REVIEW"
    requirement.progress_percent = _normalize_progress(progress_percent)
    if actor_user_id:
        requirement.update_user = actor_user_id

    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor_user_id,
        event_type="ANALYZE",
        from_status=from_status,
        to_status=requirement.status,
        before_descr=before_descr,
        after_descr=requirement.descr,
        remark=None,
    )
    db.commit()
    return serialize_requirement_legacy(requirement)


def design_requirement_legacy(
    db: Session,
    *,
    requirement_id: str,
    descr: str | None,
    actor_user_id: str | None,
) -> dict:
    requirement = _require_requirement_exists(db, requirement_id)
    if requirement.status != "PENDING_ANALYSIS":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PENDING_ANALYSIS can be designed")

    from_status = requirement.status
    before_descr = requirement.descr
    if descr is not None:
        requirement.descr = descr
    requirement.status = "PENDING_ANALYSIS"
    requirement.progress_percent = 0
    if actor_user_id:
        requirement.update_user = actor_user_id

    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor_user_id,
        event_type="DESIGN",
        from_status=from_status,
        to_status=requirement.status,
        before_descr=before_descr,
        after_descr=requirement.descr,
        remark=None,
    )
    db.commit()
    return serialize_requirement_legacy(requirement)


def review_requirement_legacy(
    db: Session,
    *,
    requirement_id: str,
    decision: str,
    descr: str | None,
    comment: str | None,
    actor_user_id: str | None,
) -> dict:
    requirement = _require_requirement_exists(db, requirement_id)
    normalized_decision = (decision or "").strip().upper()
    if normalized_decision not in {"TO_REVISION", "TO_OPEN"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid review decision")

    from_status = requirement.status
    before_descr = requirement.descr
    if descr is not None:
        requirement.descr = descr
    requirement.status = "PENDING_REVISION" if normalized_decision == "TO_REVISION" else "OPEN"
    requirement.progress_percent = 0
    if actor_user_id:
        requirement.update_user = actor_user_id

    _append_event(
        db,
        requirement_id=requirement.id,
        actor_user_id=actor_user_id,
        event_type="REVIEW",
        from_status=from_status,
        to_status=requirement.status,
        before_descr=before_descr,
        after_descr=requirement.descr,
        remark=_normalize_str(comment),
    )
    db.commit()
    return serialize_requirement_legacy(requirement)


def list_lifecycle_legacy(db: Session, requirement_id: str) -> list[dict]:
    _require_requirement_exists(db, requirement_id)
    logs = db.execute(
        select(RequirementEvent)
        .where(RequirementEvent.requirement_id == requirement_id)
        .order_by(RequirementEvent.create_date.asc(), RequirementEvent.id.asc())
    ).scalars().all()
    return [serialize_lifecycle_log_legacy(item) for item in logs]


def get_history_options_legacy(db: Session) -> dict:
    requirements = db.execute(
        select(Requirement)
        .order_by(Requirement.create_date.desc())
        .limit(200)
    ).scalars().all()
    project_names = []
    git_urls = []
    branches = []
    seen_project = set()
    seen_git = set()
    seen_branch = set()
    for item in requirements:
        if item.project_name:
            value = item.project_name.strip()
            if value and value not in seen_project:
                seen_project.add(value)
                project_names.append(value)
        if item.git_url:
            value = item.git_url.strip()
            if value and value not in seen_git:
                seen_git.add(value)
                git_urls.append(value)
        if item.branch:
            value = item.branch.strip()
            if value and value not in seen_branch:
                seen_branch.add(value)
                branches.append(value)
    return {
        "projectNames": project_names,
        "gitUrls": git_urls,
        "branches": branches,
    }


def serialize_requirement_legacy(requirement: Requirement) -> dict:
    try:
        status_value = _normalize_status(requirement.status or "PENDING_ANALYSIS")
    except HTTPException:
        status_value = "PENDING_ANALYSIS"

    try:
        priority_value = _normalize_priority(requirement.priority or "MEDIUM")
    except HTTPException:
        priority_value = "MEDIUM"

    return {
        "id": requirement.id,
        "title": requirement.title,
        "projectName": requirement.project_name,
        "gitUrl": requirement.git_url,
        "branch": requirement.branch,
        "descr": requirement.descr,
        "resultMsg": requirement.result_msg,
        "progressPercent": _normalize_progress(requirement.progress_percent),
        "status": status_value,
        "priority": priority_value,
        "createDate": requirement.create_date.isoformat() if requirement.create_date else None,
        "createUser": requirement.create_user,
        "updateDate": requirement.update_date.isoformat() if requirement.update_date else None,
        "updateUser": requirement.update_user,
    }


def serialize_lifecycle_log_legacy(log: RequirementEvent) -> dict:
    return {
        "id": log.id,
        "requirementId": log.requirement_id,
        "eventType": log.event_type,
        "fromStatus": log.from_status,
        "toStatus": log.to_status,
        "beforeDescr": log.before_descr,
        "afterDescr": log.after_descr,
        "remark": log.remark,
        "createDate": log.create_date.isoformat() if log.create_date else None,
        "createUser": log.create_user,
        "updateDate": log.update_date.isoformat() if log.update_date else None,
        "updateUser": log.update_user,
    }
