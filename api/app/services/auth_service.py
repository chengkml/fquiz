from dataclasses import dataclass
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..models.audit_log import AuditLog
from ..models.auth_session import AuthSession
from ..models.base import utcnow
from ..models.rbac import Role
from ..models.user import User
from ..schemas.auth import LoginRequest, RegisterRequest
from .legacy_authz_service import (
    get_user_authorization,
    is_user_enabled,
)
from .user_service import get_user_by_id
from ..core.config import get_settings
from ..core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)

settings = get_settings()


@dataclass
class AuthResult:
    access_token: str
    expires_in: int
    refresh_token: str
    user: User


def register_user(
    db: Session,
    payload: RegisterRequest,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> AuthResult:
    email = payload.email.lower()

    duplicate = db.scalar(
        select(User.id).where(or_(User.email == email, User.username == payload.username))
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email or username already exists",
        )

    role: Role | None = None
    try:
        role = db.scalar(select(Role).where(Role.code == "user"))
    except SQLAlchemyError:
        role = None

    user = User(
        email=email,
        username=payload.username,
        password_hash=hash_password(payload.password),
        status="ENABLED",
    )
    if role is not None:
        user.roles.append(role)
    db.add(user)
    db.commit()

    db.add(AuditLog(user_id=user.id, action="auth.register", detail="User registered"))
    db.commit()

    return issue_auth_result_for_user(
        db,
        user_id=user.id,
        user_agent=user_agent,
        ip_address=ip_address,
        action="auth.login_after_register",
    )


def login_user(
    db: Session,
    payload: LoginRequest,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> AuthResult:
    user = get_user_by_id(db, payload.user_id.strip())
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user_id or password",
        )

    if not is_user_enabled(user.status):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is disabled",
        )

    return issue_auth_result_for_user(
        db,
        user_id=user.id,
        user_agent=user_agent,
        ip_address=ip_address,
        action="auth.login",
    )


def refresh_user_session(
    db: Session,
    refresh_token: str | None,
    *,
    user_agent: str | None,
    ip_address: str | None,
) -> AuthResult:
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    now = utcnow()
    token_hash = hash_token(refresh_token)
    session = db.scalar(
        select(AuthSession).where(
            and_(
                AuthSession.refresh_token_hash == token_hash,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > now,
            )
        )
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh session",
        )

    session.revoked_at = now
    db.add(AuditLog(user_id=session.user_id, action="auth.refresh", detail="Session rotated"))
    db.commit()

    return issue_auth_result_for_user(
        db,
        user_id=session.user_id,
        user_agent=user_agent,
        ip_address=ip_address,
        action="auth.refresh_issued",
    )


def logout_user_session(db: Session, refresh_token: str | None, *, user_id: str | None) -> None:
    if not refresh_token:
        return

    token_hash = hash_token(refresh_token)
    now = utcnow()
    session = db.scalar(
        select(AuthSession).where(
            and_(
                AuthSession.refresh_token_hash == token_hash,
                AuthSession.revoked_at.is_(None),
            )
        )
    )
    if not session:
        return

    if user_id and session.user_id != user_id:
        return

    session.revoked_at = now
    db.add(AuditLog(user_id=session.user_id, action="auth.logout", detail="Session revoked"))
    db.commit()


def issue_auth_result_for_user(
    db: Session,
    *,
    user_id: str,
    user_agent: str | None,
    ip_address: str | None,
    action: str,
) -> AuthResult:
    user = get_user_by_id_with_rbac(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    if not is_user_enabled(user.status):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is disabled",
        )

    refresh_token = create_refresh_token()
    refresh_expires_at = utcnow() + timedelta(days=settings.refresh_token_expire_days)

    db.add(
        AuthSession(
            user_id=user.id,
            refresh_token_hash=hash_token(refresh_token),
            user_agent=user_agent,
            ip_address=ip_address,
            expires_at=refresh_expires_at,
        )
    )

    user.last_login_at = utcnow()
    db.add(AuditLog(user_id=user.id, action=action, detail="Access token issued"))
    db.commit()

    user = get_user_by_id_with_rbac(db, user_id)
    authz = get_user_authorization(db, user.id)
    role_codes = sorted(authz.role_codes)
    permission_codes = sorted(authz.permission_codes)
    access_token, expires_in = create_access_token(
        user_id=user.id,
        role_codes=role_codes,
        permission_codes=permission_codes,
    )

    return AuthResult(
        access_token=access_token,
        expires_in=expires_in,
        refresh_token=refresh_token,
        user=user,
    )


def get_user_by_id_with_rbac(db: Session, user_id: str) -> User | None:
    from .user_service import get_user_by_id

    return get_user_by_id(db, user_id)
