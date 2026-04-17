from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.todo import (
    TodoCreateRequest,
    TodoListResponse,
    TodoSummary,
    TodoTransitionRequest,
    TodoUpdateRequest,
)
from ...services.todo_service import (
    create_todo,
    delete_todo,
    get_todo_by_id,
    list_todos,
    serialize_todo,
    transition_todo,
    update_todo,
)

router = APIRouter(prefix="/todos", tags=["todos"])


@router.get("", response_model=TodoListResponse)
def get_todo_list(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    assignee_user_id: str | None = Query(default=None),
    _: CurrentUser = Depends(require_permission("todo.read")),
    db: Session = Depends(get_db),
) -> TodoListResponse:
    return list_todos(
        db,
        keyword=keyword,
        status_filter=status_filter,
        priority=priority,
        assignee_user_id=assignee_user_id,
    )


@router.post("", response_model=TodoSummary)
def create_todo_endpoint(
    payload: TodoCreateRequest,
    current_user: CurrentUser = Depends(require_any_permission("todo.create", "todo.manage")),
    db: Session = Depends(get_db),
) -> TodoSummary:
    return create_todo(db, payload, actor=current_user.user)


@router.get("/{todo_id}", response_model=TodoSummary)
def get_todo_detail(
    todo_id: str,
    _: CurrentUser = Depends(require_permission("todo.read")),
    db: Session = Depends(get_db),
) -> TodoSummary:
    todo = get_todo_by_id(db, todo_id)
    if not todo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Todo not found")
    return serialize_todo(todo)


@router.patch("/{todo_id}", response_model=TodoSummary)
def update_todo_endpoint(
    todo_id: str,
    payload: TodoUpdateRequest,
    current_user: CurrentUser = Depends(require_any_permission("todo.process", "todo.manage")),
    db: Session = Depends(get_db),
) -> TodoSummary:
    return update_todo(db, todo_id, payload, actor=current_user.user)


@router.post("/{todo_id}/transition", response_model=TodoSummary)
def transition_todo_endpoint(
    todo_id: str,
    payload: TodoTransitionRequest,
    current_user: CurrentUser = Depends(require_any_permission("todo.process", "todo.manage")),
    db: Session = Depends(get_db),
) -> TodoSummary:
    return transition_todo(db, todo_id, payload, actor=current_user.user)


@router.delete("/{todo_id}")
def delete_todo_endpoint(
    todo_id: str,
    current_user: CurrentUser = Depends(require_any_permission("todo.manage", "todo.process")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    return delete_todo(db, todo_id, actor=current_user.user)
