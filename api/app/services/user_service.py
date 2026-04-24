from __future__ import annotations

import asyncio
from uuid import uuid4

from sqlalchemy import and_, bindparam, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, object_session

from ..models.auth_session import AuthSession
from ..models.base import utcnow
from ..models.user import User
from ..schemas.user import (
    UserCreateRequest,
    UserListResponse,
    UserPasswordResetRequest,
    UserPublic,
    UserRoleUpdateRequest,
    UserUpdateRequest,
)
from ..core.security import hash_password
from .legacy_authz_service import (
    UserAuthorization,
    get_user_authorization,
    is_user_enabled,
    normalize_user_status,
)
from .push_service import publish_topic, publish_to_user
from .ws_manager import ws_connection_manager


def _user_with_rbac_stmt():
    return select(User)


def list_users(db: Session, *, limit: int, offset: int) -> UserListResponse:
    total = db.scalar(select(func.count()).select_from(User)) or 0
    stmt = (
        _user_with_rbac_stmt()
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    users = db.execute(stmt).unique().scalars().all()
    return UserListResponse(items=[serialize_user(user) for user in users], total=total)


def get_user_by_id(db: Session, user_id: str) -> User | None:
    stmt = _user_with_rbac_stmt().where(User.id == user_id)
    return db.execute(stmt).unique().scalar_one_or_none()


def get_user_by_email(db: Session, email: str) -> User | None:
    stmt = _user_with_rbac_stmt().where(User.email == email)
    return db.execute(stmt).unique().scalar_one_or_none()


def get_user_by_username(db: Session, username: str) -> User | None:
    stmt = _user_with_rbac_stmt().where(User.username == username)
    return db.execute(stmt).unique().scalar_one_or_none()


def create_user(
    db: Session,
    payload: UserCreateRequest,
) -> UserPublic | None:
    user_id = payload.user_id.strip()

    duplicate = db.scalar(
        select(User.id).where(
            (User.id == user_id) | (User.email == payload.email.lower()) | (User.username == payload.username)
        )
    )
    if duplicate:
        return None

    user = User(
        id=user_id,
        email=payload.email.lower(),
        username=payload.username,
        password_hash=hash_password(payload.password),
        status="ENABLED",
    )

    db.add(user)
    db.commit()
    _assign_legacy_roles(db, user_id, [])

    created = get_user_by_id(db, user_id)
    if created:
        queue_user_auth_refresh(created)
        _fire_and_forget(
            publish_topic(
                "admin.users",
                name="users.changed",
                payload={"action": "created", "user_id": created.id},
                requires_refetch=["/api/v1/users"],
                dedupe_key=f"users:created:{created.id}",
            )
        )
    return serialize_user(created) if created else None


def delete_user(db: Session, user_id: str) -> bool:
    user = get_user_by_id(db, user_id)
    if not user:
        return False

    revoke_active_sessions_for_user(db, user_id)
    db.delete(user)
    db.commit()

    _fire_and_forget(
        publish_topic(
            "admin.users",
            name="users.changed",
            payload={"action": "deleted", "user_id": user_id},
            requires_refetch=["/api/v1/users"],
            dedupe_key=f"users:deleted:{user_id}",
        )
    )
    return True


def reset_user_password(
    db: Session,
    user_id: str,
    payload: UserPasswordResetRequest,
) -> UserPublic | None:
    user = get_user_by_id(db, user_id)
    if not user:
        return None

    user.password_hash = hash_password(payload.new_password)
    revoke_active_sessions_for_user(db, user_id)
    db.commit()

    updated = get_user_by_id(db, user_id)
    if updated:
        _fire_and_forget(
            publish_to_user(
                updated.id,
                topic="auth",
                name="auth.password_reset",
                payload={"user_id": updated.id},
                requires_refetch=["/api/v1/auth/me"],
                dedupe_key=f"auth:password_reset:{updated.id}",
            )
        )
        _fire_and_forget(
            publish_topic(
                "admin.users",
                name="users.changed",
                payload={"action": "password_reset", "user_id": updated.id},
                requires_refetch=["/api/v1/users"],
                dedupe_key=f"users:password_reset:{updated.id}",
            )
        )
    return serialize_user(updated) if updated else None


def update_user(
    db: Session,
    user_id: str,
    payload: UserUpdateRequest,
) -> UserPublic | None:
    user = get_user_by_id(db, user_id)
    if not user:
        return None

    if payload.username and payload.username != user.username:
        duplicate = db.scalar(
            select(User.id).where(User.username == payload.username, User.id != user.id)
        )
        if duplicate:
            return None
        user.username = payload.username

    status_changed = False
    if payload.status:
        next_status = _to_storage_user_status(payload.status)
        if next_status != user.status:
            user.status = next_status
            status_changed = True

    db.commit()
    updated = get_user_by_id(db, user_id)
    if updated:
        queue_user_auth_refresh(updated, status_changed=status_changed)
        _fire_and_forget(
            publish_topic(
                "admin.users",
                name="users.changed",
                payload={"action": "updated", "user_id": updated.id},
                requires_refetch=["/api/v1/users"],
                dedupe_key=f"users:updated:{updated.id}",
            )
        )
        _fire_and_forget(
            publish_to_user(
                updated.id,
                topic="auth",
                name="auth.profile_changed",
                payload={"user_id": updated.id, "status": updated.status},
                requires_refetch=["/api/v1/auth/me"],
                dedupe_key=f"auth:profile_changed:{updated.id}:{updated.status}",
            )
        )
    return serialize_user(updated) if updated else None


def set_user_roles(
    db: Session,
    user_id: str,
    payload: UserRoleUpdateRequest,
) -> UserPublic | None:
    user = get_user_by_id(db, user_id)
    if not user:
        return None

    role_codes = sorted(set(code.strip() for code in payload.role_codes if code.strip()))
    if not role_codes:
        return None
    if not _role_ids_exist(db, role_codes):
        return None

    if not _replace_legacy_user_roles(db, user_id, role_codes):
        return None
    updated = get_user_by_id(db, user_id)
    if updated:
        authz = get_user_authorization(db, updated.id)
        queue_user_auth_refresh(updated)
        _fire_and_forget(
            publish_topic(
                "admin.users",
                name="users.changed",
                payload={"action": "roles_updated", "user_id": updated.id, "role_codes": sorted(authz.role_codes)},
                requires_refetch=["/api/v1/users"],
                dedupe_key=f"users:roles_updated:{updated.id}",
            )
        )
        _fire_and_forget(
            publish_to_user(
                updated.id,
                topic="auth",
                name="auth.permission_changed",
                payload={"user_id": updated.id, "role_codes": sorted(authz.role_codes)},
                requires_refetch=["/api/v1/auth/me", "/api/v1/admin/me/menus"],
                dedupe_key=f"auth:permission_changed:{updated.id}",
            )
        )
    return serialize_user(updated)


def serialize_user(user: User | None) -> UserPublic:
    if user is None:
        msg = "User is required"
        raise ValueError(msg)

    authz = _resolve_authz_for_user(user)
    return UserPublic(
        id=user.id,
        email=user.email or "",
        username=user.username,
        status=normalize_user_status(user.status),
        role_codes=sorted(authz.role_codes),
        permission_codes=sorted(authz.permission_codes),
        created_at=user.created_at or utcnow(),
        last_login_at=user.last_login_at,
    )


def queue_user_auth_refresh(user: User, *, status_changed: bool = False) -> None:
    authz = _resolve_authz_for_user(user)
    _fire_and_forget(
        ws_connection_manager.refresh_user_authorization(
            user.id,
            role_codes=authz.role_codes,
            permission_codes=authz.permission_codes,
        )
    )
    if status_changed and not is_user_enabled(user.status):
        revoke_active_sessions_for_user_by_id(user.id)
        _fire_and_forget(
            ws_connection_manager.disconnect_user(
                user.id,
                code=4403,
                reason="user_not_allowed",
            )
        )


def queue_users_auth_refresh(db: Session, user_ids: list[str]) -> None:
    normalized = sorted(set(user_ids))
    if not normalized:
        return
    users = db.execute(_user_with_rbac_stmt().where(User.id.in_(normalized))).unique().scalars().all()
    for user in users:
        queue_user_auth_refresh(user)


def revoke_active_sessions_for_user(db: Session, user_id: str) -> None:
    now = utcnow()
    sessions = db.execute(
        select(AuthSession).where(
            and_(
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    if not sessions:
        return
    for session in sessions:
        session.revoked_at = now
    db.commit()


def revoke_active_sessions_for_user_by_id(user_id: str) -> None:
    from ..core.database import SessionLocal

    with SessionLocal() as session:
        revoke_active_sessions_for_user(session, user_id)


def _fire_and_forget(coro: object) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(coro)


def _resolve_authz_for_user(user: User) -> UserAuthorization:
    session = object_session(user)
    if session is None:
        return UserAuthorization(role_codes=set(), permission_codes=set())
    return get_user_authorization(session, user.id)


def _to_storage_user_status(raw_status: str) -> str:
    return "ENABLED" if normalize_user_status(raw_status) == "active" else "DISABLED"


def _role_ids_exist(db: Session, role_ids: list[str]) -> bool:
    stmt = text(
        "SELECT id FROM user_role WHERE id IN :role_ids"
    ).bindparams(bindparam("role_ids", expanding=True))
    try:
        existing = {str(row[0]) for row in db.execute(stmt, {"role_ids": role_ids}).all()}
    except SQLAlchemyError:
        return False
    return set(role_ids).issubset(existing)


def _replace_legacy_user_roles(db: Session, user_id: str, role_ids: list[str]) -> bool:
    try:
        db.execute(text("DELETE FROM user_role_rela WHERE user_id = :user_id"), {"user_id": user_id})
        insert_stmt = text(
            """
            INSERT INTO user_role_rela (rela_id, user_id, role_id)
            VALUES (:rela_id, :user_id, :role_id)
            """
        )
        for role_id in role_ids:
            db.execute(
                insert_stmt,
                {
                    "rela_id": uuid4().hex,
                    "user_id": user_id,
                    "role_id": role_id,
                },
            )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        return False
    return True


def _assign_legacy_roles(db: Session, user_id: str, role_ids: list[str]) -> None:
    normalized = sorted(set(role_id.strip() for role_id in role_ids if role_id.strip()))
    # Keep create-user path backward compatible: if no explicit role given, try legacy "user".
    if not normalized:
        try:
            exists = db.scalar(text("SELECT id FROM user_role WHERE id = 'user' LIMIT 1"))
            if exists:
                normalized = ["user"]
        except SQLAlchemyError:
            return
    if not normalized:
        return
    _replace_legacy_user_roles(db, user_id, normalized)
