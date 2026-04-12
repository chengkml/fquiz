from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import hash_password
from ..models.menu import Menu
from ..models.rbac import Permission, Role
from ..models.user import User

settings = get_settings()

DEFAULT_PERMISSIONS: dict[str, str] = {
    "user.read": "Read user profile",
    "user.write": "Update user profile",
    "user.manage": "Manage all users and roles",
    "role.read": "Read roles",
    "role.manage": "Manage roles",
    "menu.read": "Read menus",
    "menu.manage": "Manage menus",
    "model.read": "Read model registry and routing summary",
    "model.manage": "Manage model registry, routes, keys, and health checks",
    "requirement.read": "Read requirements",
    "requirement.create": "Create requirements",
    "requirement.process": "Process requirements",
    "requirement.manage": "Manage all requirements",
}

DEFAULT_ROLES: dict[str, dict[str, object]] = {
    "admin": {
        "name": "Administrator",
        "permissions": [
            "user.read",
            "user.write",
            "user.manage",
            "role.read",
            "role.manage",
            "menu.read",
            "menu.manage",
            "model.read",
            "model.manage",
            "requirement.read",
            "requirement.create",
            "requirement.process",
            "requirement.manage",
        ],
    },
    "user": {
        "name": "User",
        "permissions": ["user.read"],
    },
}

DEFAULT_MENUS: list[dict[str, object]] = [
    {
        "code": "dashboard",
        "name": "仪表盘",
        "path": "/admin",
        "icon": "LayoutDashboard",
        "parent_code": None,
        "type": "menu",
        "sort_order": 10,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": None,
    },
    {
        "code": "admin.users",
        "name": "用户管理",
        "path": "/admin/users",
        "icon": "Users",
        "parent_code": None,
        "type": "menu",
        "sort_order": 20,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "user.manage",
    },
    {
        "code": "admin.roles",
        "name": "角色管理",
        "path": "/admin/roles",
        "icon": "ShieldCheck",
        "parent_code": None,
        "type": "menu",
        "sort_order": 30,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "role.read",
    },
    {
        "code": "admin.menus",
        "name": "菜单管理",
        "path": "/admin/menus",
        "icon": "MenuSquare",
        "parent_code": None,
        "type": "menu",
        "sort_order": 40,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "menu.read",
    },
    {
        "code": "admin.requirements",
        "name": "需求管理",
        "path": "/admin/requirements",
        "icon": "ClipboardList",
        "parent_code": None,
        "type": "menu",
        "sort_order": 50,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "requirement.read",
    },
    {
        "code": "admin.models",
        "name": "模型管理",
        "path": "/admin/models",
        "icon": "Bot",
        "parent_code": None,
        "type": "menu",
        "sort_order": 60,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "model.read",
    },
]

ROLE_MENU_BINDINGS: dict[str, list[str]] = {
    "admin": ["dashboard", "admin.users", "admin.roles", "admin.menus", "admin.requirements", "admin.models"],
    "user": ["dashboard"],
}


def seed_defaults(db: Session) -> None:
    permissions = _seed_permissions(db)
    roles = _seed_roles(db, permissions)
    menus = _seed_menus(db)
    _seed_role_menus(db, roles, menus)
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
    for code in DEFAULT_PERMISSIONS:
        permission = db.scalar(select(Permission).where(Permission.code == code))
        if not permission:
            msg = f"Permission not found after seeding: {code}"
            raise RuntimeError(msg)
        permission_map[code] = permission
    return permission_map


def _seed_roles(db: Session, permission_map: dict[str, Permission]) -> dict[str, Role]:
    role_map: dict[str, Role] = {}
    for code, role_info in DEFAULT_ROLES.items():
        role = db.scalar(select(Role).where(Role.code == code))
        if not role:
            role = Role(code=code, name=str(role_info["name"]))
            db.add(role)
            db.flush()

        role.permissions = [permission_map[p] for p in role_info["permissions"]]
        role_map[code] = role
    db.flush()
    return role_map


def _seed_menus(db: Session) -> dict[str, Menu]:
    menu_map: dict[str, Menu] = {}

    for menu_info in DEFAULT_MENUS:
        code = str(menu_info["code"])
        menu = db.scalar(select(Menu).where(Menu.code == code))
        if not menu:
            menu = Menu(code=code, name=str(menu_info["name"]))
            db.add(menu)
            db.flush()
        menu_map[code] = menu

    for menu_info in DEFAULT_MENUS:
        code = str(menu_info["code"])
        parent_code = menu_info["parent_code"]
        menu = menu_map[code]
        menu.name = str(menu_info["name"])
        menu.path = menu_info["path"] if isinstance(menu_info["path"], str) else None
        menu.icon = menu_info["icon"] if isinstance(menu_info["icon"], str) else None
        menu.parent_id = menu_map[str(parent_code)].id if parent_code else None
        menu.type = str(menu_info["type"])
        menu.sort_order = int(menu_info["sort_order"])
        menu.status = str(menu_info["status"])
        menu.visible = bool(menu_info["visible"])
        menu.cacheable = bool(menu_info["cacheable"])
        menu.permission_code = (
            str(menu_info["permission_code"])
            if menu_info.get("permission_code") is not None
            else None
        )

    db.flush()
    return menu_map


def _seed_role_menus(db: Session, role_map: dict[str, Role], menu_map: dict[str, Menu]) -> None:
    for role_code, menu_codes in ROLE_MENU_BINDINGS.items():
        role = role_map.get(role_code)
        if not role:
            continue
        role.menus = [menu_map[menu_code] for menu_code in menu_codes if menu_code in menu_map]
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
