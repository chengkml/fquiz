from __future__ import annotations

import asyncio
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from ..models.base import utcnow
from ..models.todo import Todo
from ..models.user import User
from ..schemas.todo import (
    TodoCreateRequest,
    TodoListResponse,
    TodoSummary,
    TodoTransitionRequest,
    TodoUpdateRequest,
)
from .push_service import publish_topic

TOPIC_NAME = "todos"
TODO_ACTIVE_STATUSES = {"SCHEDULED", "IN_PROGRESS"}
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "SCHEDULED": {"IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"},
    "IN_PROGRESS": {"SCHEDULED", "COMPLETED", "CANCELLED", "EXPIRED"},
    "COMPLETED": {"SCHEDULED", "IN_PROGRESS", "CANCELLED"},
    "CANCELLED": {"SCHEDULED", "IN_PROGRESS"},
    "EXPIRED": {"SCHEDULED", "IN_PROGRESS", "CANCELLED", "COMPLETED"},
}


def list_todos(
    db: Session,
    *,
    title: str | None,
    status_filter: str | None,
    priority: str | None,
    page_num: int,
    page_size: int,
    actor: User,
) -> TodoListResponse:
    filters = [Todo.create_user == actor.username]

    if title:
        filters.append(Todo.title.ilike(f"%{title.strip()}%"))
    if status_filter:
        filters.append(Todo.status == status_filter)
    if priority:
        filters.append(Todo.priority == priority)

    total_stmt = select(func.count()).select_from(Todo).where(*filters)
    total = db.execute(total_stmt).scalar_one()

    stmt = (
        select(Todo)
        .where(*filters)
        .order_by(Todo.create_date.desc())
        .offset(page_num * page_size)
        .limit(page_size)
    )
    items = db.execute(stmt).scalars().all()
    return TodoListResponse(items=[serialize_todo(item) for item in items], total=total)


def get_todo_by_id(db: Session, todo_id: str, *, actor: User | None = None) -> Todo | None:
    todo = db.execute(select(Todo).where(Todo.id == todo_id)).scalar_one_or_none()
    if not todo:
        return None
    if actor and todo.create_user != actor.username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to access todo")
    return todo


def create_todo(
    db: Session,
    payload: TodoCreateRequest,
    *,
    actor: User,
    syncing: bool = False,
) -> TodoSummary:
    now = utcnow()
    todo = Todo(
        title=payload.title.strip(),
        descr=_normalize_str(payload.descr) or "",
        status=payload.status,
        priority=payload.priority,
        start_time=payload.start_time,
        due_date=payload.due_date,
        expire_time=payload.expire_time,
        calendar_event_id=_normalize_str(payload.calendar_event_id),
        create_user=actor.username,
        update_user=actor.username,
        create_date=now,
        update_date=now,
    )
    db.add(todo)
    db.commit()

    saved = get_todo_by_id(db, todo.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Todo save failed")

    if not (payload.is_sync or syncing):
        from .calendar_event_service import sync_from_todo_create

        sync_from_todo_create(db, todo=saved, actor=actor)
        saved = get_todo_by_id(db, todo.id) or saved

    _publish_todo_change("todos.created", saved, action="created")
    return serialize_todo(saved)


def update_todo(
    db: Session,
    todo_id: str,
    payload: TodoUpdateRequest,
    *,
    actor: User,
    syncing: bool = False,
) -> TodoSummary:
    todo = get_todo_by_id(db, todo_id, actor=actor)
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Todo not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field in ["title", "descr", "status", "priority", "start_time", "due_date", "expire_time", "calendar_event_id"]:
        if field in update_data:
            value = update_data[field]
            setattr(todo, field, _normalize_str(value) if isinstance(value, str) else value)

    todo.update_user = actor.username
    todo.update_date = utcnow()
    db.commit()

    saved = get_todo_by_id(db, todo.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Todo load failed")

    if not (payload.is_sync or syncing):
        from .calendar_event_service import sync_from_todo_update

        sync_from_todo_update(db, todo=saved, actor=actor)
        saved = get_todo_by_id(db, todo.id) or saved

    _publish_todo_change("todos.updated", saved, action="updated")
    return serialize_todo(saved)


def transition_todo(
    db: Session,
    todo_id: str,
    payload: TodoTransitionRequest,
    *,
    actor: User,
    syncing: bool = False,
) -> TodoSummary:
    todo = get_todo_by_id(db, todo_id, actor=actor)
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Todo not found")

    current_status = todo.status
    target_status = payload.status
    if current_status == target_status:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status is unchanged")
    if target_status not in ALLOWED_TRANSITIONS.get(current_status, set()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transition not allowed: {current_status} -> {target_status}",
        )

    todo.status = target_status
    todo.update_user = actor.username
    todo.update_date = utcnow()
    db.commit()

    saved = get_todo_by_id(db, todo.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Todo load failed")

    if not (payload.is_sync or syncing):
        from .calendar_event_service import sync_from_todo_transition

        sync_from_todo_transition(db, todo=saved, actor=actor)
        saved = get_todo_by_id(db, todo.id) or saved

    _publish_todo_change("todos.transitioned", saved, action="transitioned")
    return serialize_todo(saved)


def complete_todo(
    db: Session,
    todo_id: str,
    *,
    actor: User,
    syncing: bool = False,
) -> TodoSummary:
    todo = get_todo_by_id(db, todo_id, actor=actor)
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Todo not found")

    todo.status = "COMPLETED"
    todo.update_user = actor.username
    todo.update_date = utcnow()
    db.commit()

    saved = get_todo_by_id(db, todo.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Todo load failed")

    if not syncing:
        from .calendar_event_service import sync_from_todo_transition

        sync_from_todo_transition(db, todo=saved, actor=actor)
        saved = get_todo_by_id(db, todo.id) or saved

    _publish_todo_change("todos.completed", saved, action="completed")
    return serialize_todo(saved)


def expire_overdue_todos(db: Session) -> int:
    now = utcnow()
    todos = db.execute(
        select(Todo).where(
            Todo.expire_time.is_not(None),
            Todo.expire_time <= now,
            Todo.status.in_(sorted(TODO_ACTIVE_STATUSES)),
        )
    ).scalars().all()

    if not todos:
        return 0

    for todo in todos:
        todo.status = "EXPIRED"
        todo.update_user = "system"
        todo.update_date = now

    db.commit()
    return len(todos)


def delete_todo(db: Session, todo_id: str, *, actor: User, syncing: bool = False) -> dict[str, bool]:
    todo = get_todo_by_id(db, todo_id, actor=actor)
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Todo not found")

    deleted_id = todo.id
    db.delete(todo)
    db.commit()

    if not syncing:
        from .calendar_event_service import sync_from_todo_delete

        sync_from_todo_delete(db, todo=todo, actor=actor)

    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name="todos.deleted",
            payload={"action": "deleted", "todo_id": deleted_id, "actor_user": actor.username},
            requires_refetch=[],
            dedupe_key=f"todos:deleted:{deleted_id}",
        )
    )
    return {"success": True}


def serialize_todo(todo: Todo) -> TodoSummary:
    return TodoSummary(
        id=todo.id,
        title=todo.title,
        descr=todo.descr,
        status=todo.status,
        priority=todo.priority,
        start_time=todo.start_time,
        due_date=todo.due_date,
        expire_time=todo.expire_time,
        calendar_event_id=todo.calendar_event_id,
        create_date=todo.create_date,
        create_user=todo.create_user,
        update_date=todo.update_date,
        update_user=todo.update_user,
    )


def _publish_todo_change(event_name: str, todo: Todo, *, action: str) -> None:
    payload = {
        "action": action,
        "todo_id": todo.id,
        "status": todo.status,
        "priority": todo.priority,
    }
    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name=event_name,
            payload=payload,
            requires_refetch=[],
            dedupe_key=f"todos:{action}:{todo.id}",
        )
    )


def _normalize_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)
