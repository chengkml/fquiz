from __future__ import annotations

import asyncio

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..models.system_message import SystemMessage
from ..schemas.system_message import (
    SystemMessageCreateRequest,
    SystemMessageListResponse,
    SystemMessageSummary,
    SystemMessageUpdateRequest,
)
from .push_service import publish_topic
from .user_service import serialize_user

SYSTEM_MESSAGE_TOPIC = "admin.system-messages"


def _system_message_stmt():
    return select(SystemMessage).options(
        selectinload(SystemMessage.created_by),
        selectinload(SystemMessage.updated_by),
    )


def serialize_system_message(item: SystemMessage) -> SystemMessageSummary:
    return SystemMessageSummary(
        id=item.id,
        title=item.title,
        content=item.content,
        level=item.level,
        status=item.status,
        start_at=item.start_at,
        end_at=item.end_at,
        created_by_user_id=item.created_by_user_id,
        updated_by_user_id=item.updated_by_user_id,
        created_at=item.created_at,
        updated_at=item.updated_at,
        created_by=serialize_user(item.created_by) if item.created_by else None,
        updated_by=serialize_user(item.updated_by) if item.updated_by else None,
    )


def list_system_messages(
    db: Session,
    *,
    keyword: str | None,
    status_filter: str | None,
    level_filter: str | None,
) -> SystemMessageListResponse:
    stmt = _system_message_stmt()

    normalized_keyword = (keyword or "").strip()
    if normalized_keyword:
        like = f"%{normalized_keyword}%"
        stmt = stmt.where(
            or_(
                SystemMessage.title.ilike(like),
                SystemMessage.content.ilike(like),
            )
        )

    if status_filter in {"draft", "published", "archived"}:
        stmt = stmt.where(SystemMessage.status == status_filter)
    if level_filter in {"info", "success", "warning", "error"}:
        stmt = stmt.where(SystemMessage.level == level_filter)

    total_stmt = select(func.count()).select_from(SystemMessage)
    if normalized_keyword:
        like = f"%{normalized_keyword}%"
        total_stmt = total_stmt.where(
            or_(
                SystemMessage.title.ilike(like),
                SystemMessage.content.ilike(like),
            )
        )
    if status_filter in {"draft", "published", "archived"}:
        total_stmt = total_stmt.where(SystemMessage.status == status_filter)
    if level_filter in {"info", "success", "warning", "error"}:
        total_stmt = total_stmt.where(SystemMessage.level == level_filter)

    total = db.scalar(total_stmt) or 0
    items = db.execute(stmt.order_by(SystemMessage.updated_at.desc(), SystemMessage.id.desc())).scalars().all()
    return SystemMessageListResponse(items=[serialize_system_message(item) for item in items], total=total)


def get_system_message_by_id(db: Session, message_id: int) -> SystemMessage | None:
    return db.execute(_system_message_stmt().where(SystemMessage.id == message_id)).scalar_one_or_none()


def create_system_message(
    db: Session,
    payload: SystemMessageCreateRequest,
    *,
    actor_user_id: str,
) -> SystemMessageSummary | None:
    item = SystemMessage(
        title=payload.title.strip(),
        content=payload.content.strip(),
        level=payload.level,
        status=payload.status,
        start_at=payload.start_at,
        end_at=payload.end_at,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(item)
    db.commit()

    saved = get_system_message_by_id(db, item.id)
    if not saved:
        return None

    _fire_and_forget(
        publish_topic(
            SYSTEM_MESSAGE_TOPIC,
            name="system_messages.changed",
            payload={"action": "created", "message_id": saved.id},
            requires_refetch=["/api/v1/admin/system-messages"],
            dedupe_key=f"system-messages:created:{saved.id}",
        )
    )
    return serialize_system_message(saved)


def update_system_message(
    db: Session,
    message_id: int,
    payload: SystemMessageUpdateRequest,
    *,
    actor_user_id: str,
) -> SystemMessageSummary | None:
    item = get_system_message_by_id(db, message_id)
    if not item:
        return None

    update_data = payload.model_dump(exclude_unset=True)
    if "title" in update_data and update_data["title"] is not None:
        item.title = str(update_data["title"]).strip()
    if "content" in update_data and update_data["content"] is not None:
        item.content = str(update_data["content"]).strip()
    if "level" in update_data and update_data["level"] is not None:
        item.level = str(update_data["level"])
    if "status" in update_data and update_data["status"] is not None:
        item.status = str(update_data["status"])
    if "start_at" in update_data:
        item.start_at = update_data["start_at"]
    if "end_at" in update_data:
        item.end_at = update_data["end_at"]

    if item.start_at and item.end_at and item.start_at > item.end_at:
        return None

    item.updated_by_user_id = actor_user_id
    db.commit()

    saved = get_system_message_by_id(db, message_id)
    if not saved:
        return None

    _fire_and_forget(
        publish_topic(
            SYSTEM_MESSAGE_TOPIC,
            name="system_messages.changed",
            payload={"action": "updated", "message_id": saved.id},
            requires_refetch=["/api/v1/admin/system-messages", f"/api/v1/admin/system-messages/{saved.id}"],
            dedupe_key=f"system-messages:updated:{saved.id}",
        )
    )
    return serialize_system_message(saved)


def delete_system_message(db: Session, message_id: int) -> bool:
    item = get_system_message_by_id(db, message_id)
    if not item:
        return False

    deleted_id = item.id
    db.delete(item)
    db.commit()

    _fire_and_forget(
        publish_topic(
            SYSTEM_MESSAGE_TOPIC,
            name="system_messages.changed",
            payload={"action": "deleted", "message_id": deleted_id},
            requires_refetch=["/api/v1/admin/system-messages"],
            dedupe_key=f"system-messages:deleted:{deleted_id}",
        )
    )
    return True


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
