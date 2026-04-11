from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..models.rbac import Role
from ..models.user import User
from ..schemas.user import UserListResponse, UserPublic, UserRoleUpdateRequest, UserUpdateRequest


def _user_with_rbac_stmt():
    return select(User).options(joinedload(User.roles).joinedload(Role.permissions))


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

    if payload.status:
        user.status = payload.status

    db.commit()
    updated = get_user_by_id(db, user_id)
    return serialize_user(updated) if updated else None


def set_user_roles(
    db: Session,
    user_id: str,
    payload: UserRoleUpdateRequest,
) -> UserPublic | None:
    user = get_user_by_id(db, user_id)
    if not user:
        return None

    role_codes = sorted(set(payload.role_codes))
    roles = db.execute(select(Role).where(Role.code.in_(role_codes))).scalars().all()
    if len(roles) != len(role_codes):
        return None

    user.roles = roles
    db.commit()
    updated = get_user_by_id(db, user_id)
    return serialize_user(updated)


def serialize_user(user: User | None) -> UserPublic:
    if user is None:
        msg = "User is required"
        raise ValueError(msg)

    role_codes = sorted({role.code for role in user.roles})
    permission_codes = sorted(
        {permission.code for role in user.roles for permission in role.permissions}
    )
    return UserPublic(
        id=user.id,
        email=user.email,
        username=user.username,
        status=user.status,
        role_codes=role_codes,
        permission_codes=permission_codes,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )
