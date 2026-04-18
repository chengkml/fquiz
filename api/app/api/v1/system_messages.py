from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, require_any_permission, require_permission
from ...schemas.system_message import (
    SystemMessageCreateRequest,
    SystemMessageListResponse,
    SystemMessageSummary,
    SystemMessageUpdateRequest,
)
from ...services.system_message_service import (
    create_system_message,
    delete_system_message,
    get_system_message_by_id,
    list_system_messages,
    serialize_system_message,
    update_system_message,
)

router = APIRouter(prefix="/admin/system-messages", tags=["admin-system-messages"])


@router.get("", response_model=SystemMessageListResponse)
def get_system_messages(
    keyword: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    level_filter: str | None = Query(default=None, alias="level"),
    _: CurrentUser = Depends(require_any_permission("system_message.read", "system_message.manage")),
    db: Session = Depends(get_db),
) -> SystemMessageListResponse:
    return list_system_messages(
        db,
        keyword=keyword,
        status_filter=status_filter,
        level_filter=level_filter,
    )


@router.post("", response_model=SystemMessageSummary)
def create_system_message_endpoint(
    payload: SystemMessageCreateRequest,
    current_user: CurrentUser = Depends(require_permission("system_message.manage")),
    db: Session = Depends(get_db),
) -> SystemMessageSummary:
    created = create_system_message(db, payload, actor_user_id=current_user.user.id)
    if not created:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="System message create failed")
    return created


@router.get("/{message_id}", response_model=SystemMessageSummary)
def get_system_message_detail(
    message_id: int,
    _: CurrentUser = Depends(require_any_permission("system_message.read", "system_message.manage")),
    db: Session = Depends(get_db),
) -> SystemMessageSummary:
    item = get_system_message_by_id(db, message_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System message not found")
    return serialize_system_message(item)


@router.patch("/{message_id}", response_model=SystemMessageSummary)
def update_system_message_endpoint(
    message_id: int,
    payload: SystemMessageUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("system_message.manage")),
    db: Session = Depends(get_db),
) -> SystemMessageSummary:
    existing = get_system_message_by_id(db, message_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System message not found")

    updated = update_system_message(db, message_id, payload, actor_user_id=current_user.user.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid system message payload")
    return updated


@router.delete("/{message_id}")
def delete_system_message_endpoint(
    message_id: int,
    _: CurrentUser = Depends(require_permission("system_message.manage")),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    deleted = delete_system_message(db, message_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="System message not found")
    return {"success": True}
