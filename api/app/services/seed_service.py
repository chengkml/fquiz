from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import hash_password
from ..models.rbac import Permission, Role
from ..models.user import User

settings = get_settings()

DEFAULT_PERMISSIONS: dict[str, str] = {
    "user.read": "Read user profile",
    "user.write": "Update user profile",
    "user.manage": "Manage all users and roles",
}

DEFAULT_ROLES: dict[str, dict[str, object]] = {
    "admin": {
        "name": "Administrator",
        "permissions": ["user.read", "user.write", "user.manage"],
    },
    "user": {
        "name": "User",
        "permissions": ["user.read"],
    },
}


def seed_defaults(db: Session) -> None:
    permissions = _seed_permissions(db)
    _seed_roles(db, permissions)
    _seed_initial_admin(db)
    db.commit()


def _seed_permissions(db: Session) -> dict[str, Permission]:
    permission_map: dict[str, Permission] = {}
    for code, name in DEFAULT_PERMISSIONS.items():
        permission = db.scalar(select(Permission).where(Permission.code == code))
        if not permission:
            permission = Permission(code=code, name=name)
            db.add(permission)
        permission_map[code] = permission

    db.flush()
    # Refresh map with persisted entities.
    for code in DEFAULT_PERMISSIONS:
        permission = db.scalar(select(Permission).where(Permission.code == code))
        if not permission:
            msg = f"Permission not found after seeding: {code}"
            raise RuntimeError(msg)
        permission_map[code] = permission
    return permission_map


def _seed_roles(db: Session, permission_map: dict[str, Permission]) -> None:
    for code, role_info in DEFAULT_ROLES.items():
        role = db.scalar(select(Role).where(Role.code == code))
        if not role:
            role = Role(code=code, name=str(role_info["name"]))
            db.add(role)
            db.flush()

        role.permissions = [permission_map[p] for p in role_info["permissions"]]
    db.flush()


def _seed_initial_admin(db: Session) -> None:
    if not settings.initial_admin_email or not settings.initial_admin_password:
        return

    admin_role = db.scalar(select(Role).where(Role.code == "admin"))
    if not admin_role:
        return

    admin_email = settings.initial_admin_email.lower()
    user = db.scalar(select(User).where(User.email == admin_email))
    if not user:
        user = User(
            email=admin_email,
            username=settings.initial_admin_username,
            password_hash=hash_password(settings.initial_admin_password),
            status="active",
        )
        db.add(user)
        db.flush()

    role_codes = {role.code for role in user.roles}
    if "admin" not in role_codes:
        user.roles.append(admin_role)
