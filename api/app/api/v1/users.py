from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, get_current_user, require_permission
from ...schemas.auth import MessageResponse
from ...schemas.user import (
    UserCreateRequest,
    UserListResponse,
    UserPasswordResetRequest,
    UserPublic,
    UserRoleUpdateRequest,
    UserUpdateRequest,
    UserIdCheckResponse,
)
from ...services.user_service import (
    UserCreateError,
    UserDuplicateError,
    UserRoleAssignmentError,
    create_user,
    delete_user,
    get_user_by_id,
    list_users,
    reset_user_password,
    serialize_user,
    set_user_roles,
    update_user,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/check-id/{user_id}", response_model=UserIdCheckResponse)
def check_user_id_availability(
    user_id: str,
    exclude_user_id: str | None = Query(default=None),
    _: CurrentUser = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> UserIdCheckResponse:
    """Check if a user ID is available. Use exclude_user_id when editing an existing user."""
    existing_user = get_user_by_id(db, user_id)

    if existing_user:
        if exclude_user_id and existing_user.id.lower() == exclude_user_id.lower():
            return UserIdCheckResponse(available=True, message="当前用户ID")
        return UserIdCheckResponse(available=False, message="用户 ID 已存在，请更换后重试")

    return UserIdCheckResponse(available=True, message="用户 ID 可用")


@router.post("", response_model=UserPublic)
def create_user_account(
    payload: UserCreateRequest,
    current_user: CurrentUser = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> UserPublic:
    try:
        created = create_user(db, payload, actor_user_id=current_user.user.id)
        return created
    except UserDuplicateError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )
    except UserRoleAssignmentError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
    except UserCreateError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("", response_model=UserListResponse)
def list_all_users(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    keyword: str | None = Query(default=None, max_length=128),
    status_filter: str | None = Query(default=None, alias="status"),
    _: CurrentUser = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> UserListResponse:
    return list_users(db, limit=limit, offset=offset, keyword=keyword, status=status_filter)


@router.get("/{user_id}", response_model=UserPublic)
def get_user_detail(
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserPublic:
    can_manage = "admin" in current_user.role_codes or "user.manage" in current_user.permission_codes
    if current_user.user.id != user_id and not can_manage:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )

    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return serialize_user(user)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user_profile(
    user_id: str,
    payload: UserUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> UserPublic:
    updated = update_user(db, user_id, payload, actor_user_id=current_user.user.id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found or email/username exists",
        )
    return updated


@router.post("/{user_id}/password", response_model=UserPublic)
def reset_password(
    user_id: str,
    payload: UserPasswordResetRequest,
    current_user: CurrentUser = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> UserPublic:
    updated = reset_user_password(db, user_id, payload, actor_user_id=current_user.user.id)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return updated


@router.delete("/{user_id}", response_model=MessageResponse)
def remove_user(
    user_id: str,
    current_user: CurrentUser = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> MessageResponse:
    deleted = delete_user(db, user_id, actor_user_id=current_user.user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return MessageResponse(message="User deleted")


@router.post("/{user_id}/roles", response_model=UserPublic)
def assign_roles(
    user_id: str,
    payload: UserRoleUpdateRequest,
    current_user: CurrentUser = Depends(require_permission("user.manage")),
    db: Session = Depends(get_db),
) -> UserPublic:
    updated = set_user_roles(db, user_id, payload, actor_user_id=current_user.user.id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found or invalid roles",
        )
    return updated
