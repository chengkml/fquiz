from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.database import SessionLocal
from ..core.security import create_access_token
from ..models.user import User
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
            stmt = stmt.where(User.status == status_filter)

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
            total_stmt = total_stmt.where(User.status == status_filter)

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

        items = [
            JwtGeneratorUserItem(
                id=user.id,
                email=user.email,
                username=user.username,
                status=user.status,
                role_codes=sorted({role.code for role in user.roles}),
            )
            for user in users
        ]

    return JwtGeneratorUserListResponse(items=items, total=total, limit=limit, offset=offset)


def generate_jwt_for_user(payload: JwtGenerateRequest) -> JwtGenerateResponse:
    normalized_user_id = payload.user_id.strip()

    with SessionLocal() as db:
        user = get_user_by_id(db, normalized_user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if user.status != "active":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

        role_codes = sorted({role.code for role in user.roles})
        permission_codes = sorted(
            {permission.code for role in user.roles for permission in role.permissions}
        )

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
