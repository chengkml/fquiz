from __future__ import annotations

import asyncio

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

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
from .user_service import serialize_user

TODO_LOAD_OPTIONS = (
    selectinload(Todo.creator).selectinload(User.roles),
    selectinload(Todo.assignee).selectinload(User.roles),
)
TOPIC_NAME = "todos"
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "TODO": {"IN_PROGRESS", "DONE"},
    "IN_PROGRESS": {"TODO", "DONE"},
    "DONE": {"TODO", "IN_PROGRESS"},
}


def _todo_stmt():
    return select(Todo).options(*TODO_LOAD_OPTIONS)


def list_todos(
    db: Session,
    *,
    keyword: str | None,
    status_filter: str | None,
    priority: str | None,
    assignee_user_id: str | None,
) -> TodoListResponse:
    stmt = _todo_stmt()
    if keyword:
        like = f"%{keyword.strip()}%"
        stmt = stmt.where(or_(Todo.title.ilike(like), Todo.description.ilike(like)))
    if status_filter:
        stmt = stmt.where(Todo.status == status_filter)
    if priority:
        stmt = stmt.where(Todo.priority == priority)
    if assignee_user_id:
        stmt = stmt.where(Todo.assignee_user_id == assignee_user_id)

    todos = db.execute(stmt.order_by(Todo.updated_at.desc())).scalars().all()
    return TodoListResponse(items=[serialize_todo(item) for item in todos], total=len(todos))


def get_todo_by_id(db: Session, todo_id: str) -> Todo | None:
    return db.execute(_todo_stmt().where(Todo.id == todo_id)).scalar_one_or_none()


def create_todo(
    db: Session,
    payload: TodoCreateRequest,
    *,
    actor: User,
) -> TodoSummary:
    assignee = _load_user_if_exists(db, payload.assignee_user_id)
    if payload.assignee_user_id and not assignee:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")

    todo = Todo(
        title=payload.title.strip(),
        description=payload.description.strip(),
        status=payload.status,
        priority=payload.priority,
        assignee_user_id=assignee.id if assignee else None,
        creator_user_id=actor.id,
        due_at=payload.due_at,
        completed_at=utcnow() if payload.status == "DONE" else None,
    )
    db.add(todo)
    db.commit()

    saved = get_todo_by_id(db, todo.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Todo save failed")
    _publish_todo_change("todos.created", saved, action="created")
    return serialize_todo(saved)


def update_todo(
    db: Session,
    todo_id: str,
    payload: TodoUpdateRequest,
    *,
    actor: User,
) -> TodoSummary:
    todo = get_todo_by_id(db, todo_id)
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Todo not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "assignee_user_id" in update_data:
        assignee = _load_user_if_exists(db, update_data["assignee_user_id"])
        if update_data["assignee_user_id"] and not assignee:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee not found")
        todo.assignee_user_id = assignee.id if assignee else None

    for field in ["title", "description", "priority", "due_at"]:
        if field in update_data:
            value = update_data[field]
            setattr(todo, field, _normalize_str(value) if isinstance(value, str) else value)

    db.commit()

    saved = get_todo_by_id(db, todo.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Todo load failed")
    _publish_todo_change("todos.updated", saved, action="updated")
    return serialize_todo(saved)


def transition_todo(
    db: Session,
    todo_id: str,
    payload: TodoTransitionRequest,
    *,
    actor: User,
) -> TodoSummary:
    todo = get_todo_by_id(db, todo_id)
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
    todo.completed_at = utcnow() if target_status == "DONE" else None
    db.commit()

    saved = get_todo_by_id(db, todo.id)
    if not saved:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Todo load failed")
    _publish_todo_change("todos.transitioned", saved, action="transitioned")
    return serialize_todo(saved)


def delete_todo(db: Session, todo_id: str, *, actor: User) -> dict[str, bool]:
    todo = get_todo_by_id(db, todo_id)
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Todo not found")

    deleted_id = todo.id
    db.delete(todo)
    db.commit()

    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name="todos.deleted",
            payload={"action": "deleted", "todo_id": deleted_id, "actor_user_id": actor.id},
            requires_refetch=["/api/v1/todos"],
            dedupe_key=f"todos:deleted:{deleted_id}",
        )
    )
    return {"success": True}


def serialize_todo(todo: Todo) -> TodoSummary:
    return TodoSummary(
        id=todo.id,
        title=todo.title,
        description=todo.description,
        status=todo.status,
        priority=todo.priority,
        assignee_user_id=todo.assignee_user_id,
        creator_user_id=todo.creator_user_id,
        due_at=todo.due_at,
        completed_at=todo.completed_at,
        created_at=todo.created_at,
        updated_at=todo.updated_at,
        creator=serialize_user(todo.creator) if todo.creator else None,
        assignee=serialize_user(todo.assignee) if todo.assignee else None,
    )


def _publish_todo_change(event_name: str, todo: Todo, *, action: str) -> None:
    payload = {
        "action": action,
        "todo_id": todo.id,
        "status": todo.status,
        "priority": todo.priority,
        "assignee_user_id": todo.assignee_user_id,
    }
    _fire_and_forget(
        publish_topic(
            TOPIC_NAME,
            name=event_name,
            payload=payload,
            requires_refetch=[
                "/api/v1/todos",
                f"/api/v1/todos/{todo.id}",
            ],
            dedupe_key=f"todos:{action}:{todo.id}",
        )
    )


def _load_user_if_exists(db: Session, user_id: str | None) -> User | None:
    if not user_id:
        return None
    return db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()


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
