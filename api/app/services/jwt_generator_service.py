from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.security import create_access_token
from ..models.user import User
from .legacy_authz_service import get_user_authorization, is_user_enabled, normalize_user_status
from ..schemas.jwt_generator import (
    JwtGenerateRequest,
    JwtGenerateResponse,
    JwtGeneratorUserItem,
    JwtGeneratorUserListResponse,
)
from .user_service import _user_with_rbac_stmt, get_user_by_id


def list_jwt_generator_users(
    *,
    keyword: str | None,
    status_filter: str | None,
    limit: int,
    offset: int,
) -> JwtGeneratorUserListResponse:
    with SessionLocal() as db:
        stmt = _user_with_rbac_stmt()

        if keyword:
            normalized = keyword.strip()
            if normalized:
                like = f"%{normalized}%"
                stmt = stmt.where(
                    User.id.ilike(like)
                    | User.email.ilike(like)
                    | User.username.ilike(like)
                )

        if status_filter in {"active", "disabled"}:
            if status_filter == "active":
                stmt = stmt.where(User.status.in_(["active", "ACTIVE", "ENABLED"]))
            else:
                stmt = stmt.where(User.status.in_(["disabled", "DISABLED", "INACTIVE"]))

        total_stmt = select(func.count()).select_from(User)
        if keyword:
            normalized = keyword.strip()
            if normalized:
                like = f"%{normalized}%"
                total_stmt = total_stmt.where(
                    User.id.ilike(like)
                    | User.email.ilike(like)
                    | User.username.ilike(like)
                )
        if status_filter in {"active", "disabled"}:
            if status_filter == "active":
                total_stmt = total_stmt.where(User.status.in_(["active", "ACTIVE", "ENABLED"]))
            else:
                total_stmt = total_stmt.where(User.status.in_(["disabled", "DISABLED", "INACTIVE"]))

        total = db.scalar(total_stmt) or 0
        users = (
            db.execute(
                stmt.order_by(User.created_at.desc(), User.id.asc())
                .offset(offset)
                .limit(limit)
            )
            .unique()
            .scalars()
            .all()
        )

        items = []
        for user in users:
            authz = get_user_authorization(db, user.id)
            items.append(
                JwtGeneratorUserItem(
                    id=user.id,
                    email=user.email or "",
                    username=user.username,
                    status=normalize_user_status(user.status),
                    role_codes=sorted(authz.role_codes),
                )
            )

    return JwtGeneratorUserListResponse(items=items, total=total, limit=limit, offset=offset)


def generate_jwt_for_user(payload: JwtGenerateRequest) -> JwtGenerateResponse:
    normalized_user_id = payload.user_id.strip()

    with SessionLocal() as db:
        user = get_user_by_id(db, normalized_user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if not is_user_enabled(user.status):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

        authz = get_user_authorization(db, user.id)
        role_codes = sorted(authz.role_codes)
        permission_codes = sorted(authz.permission_codes)

    access_token, expires_in = create_access_token(
        user_id=normalized_user_id,
        role_codes=role_codes,
        permission_codes=permission_codes,
        expires_minutes=payload.expires_minutes,
    )

    expires_at = datetime.now(UTC) + timedelta(seconds=expires_in)

    return JwtGenerateResponse(
        access_token=access_token,
        expires_in=expires_in,
        expires_at=expires_at,
        user_id=normalized_user_id,
        role_codes=role_codes,
        permission_codes=permission_codes,
    )
