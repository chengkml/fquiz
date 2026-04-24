from dataclasses import dataclass
from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.user import User
from ..services.legacy_authz_service import get_user_authorization, is_user_enabled
from .database import get_db
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


@dataclass
class CurrentUser:
    user: User
    role_codes: set[str]
    permission_codes: set[str]


def _load_user_with_rbac(db: Session, user_id: str) -> User | None:
    stmt = select(User).where(User.id == user_id)
    return db.execute(stmt).unique().scalar_one_or_none()


def get_current_user(
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> CurrentUser:
    payload = decode_access_token(token)
    user_id = str(payload["sub"])
    user = _load_user_with_rbac(db, user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if not is_user_enabled(user.status):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is disabled",
        )

    authz = get_user_authorization(db, user.id)
    return CurrentUser(
        user=user,
        role_codes=authz.role_codes,
        permission_codes=authz.permission_codes,
    )


def require_permission(permission_code: str):
    def dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if "admin" in current_user.role_codes:
            return current_user
        if permission_code not in current_user.permission_codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {permission_code}",
            )
        return current_user

    return dependency


def require_any_permission(*permission_codes: str) -> Callable[[CurrentUser], CurrentUser]:
    required = tuple(dict.fromkeys(permission_codes))

    def dependency(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if "admin" in current_user.role_codes:
            return current_user
        if any(code in current_user.permission_codes for code in required):
            return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Missing any permission: {', '.join(required)}",
        )

    return dependency
