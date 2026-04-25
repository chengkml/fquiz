from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import hash_password
from ..models.file_storage import FileStorageBackend, FileStorageMount
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
    "system_param.read": "Read system parameters",
    "system_param.manage": "Manage system parameters",
    "model.read": "Read model registry and routing summary",
    "model.manage": "Manage model registry, routes, keys, and health checks",
    "file.read": "Read file mounts and indexed entries",
    "file.manage": "Manage file operations and storage sync",
    "chat.use": "Use AI chat feature",
    "requirement.read": "Read requirements",
    "requirement.create": "Create requirements",
    "requirement.process": "Process requirements",
    "requirement.manage": "Manage all requirements",
    "todo.read": "Read todos",
    "todo.create": "Create todos",
    "todo.process": "Process todos",
    "todo.manage": "Manage all todos",
    "question_bank.read": "Read question bank entries",
    "question_bank.manage": "Manage question bank entries",
    "vocabulary.read": "Read vocabulary words",
    "vocabulary.manage": "Manage vocabulary words",
    "line.read": "Read power lines",
    "line.manage": "Manage power lines",
    "tower.read": "Read line towers",
    "tower.manage": "Manage line towers",
    "lightning.read": "Read lightning current events and features",
    "lightning.manage": "Manage lightning current events and data imports",
    "wine.read": "Read Wine executor status",
    "wine.manage": "Run Windows executables through Wine",
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
            "system_param.read",
            "system_param.manage",
            "model.read",
            "model.manage",
            "file.read",
            "file.manage",
            "chat.use",
            "requirement.read",
            "requirement.create",
            "requirement.process",
            "requirement.manage",
            "todo.read",
            "todo.create",
            "todo.process",
            "todo.manage",
            "question_bank.read",
            "question_bank.manage",
            "vocabulary.read",
            "vocabulary.manage",
            "line.read",
            "line.manage",
            "tower.read",
            "tower.manage",
            "lightning.read",
            "lightning.manage",
            "wine.read",
            "wine.manage",
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
        "code": "admin.system_params",
        "name": "系统参数",
        "path": "/admin/system-params",
        "icon": "Settings2",
        "parent_code": None,
        "type": "menu",
        "sort_order": 45,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "system_param.read",
    },
    {
        "code": "admin.agent",
        "name": "编排管理",
        "path": "/admin/orchestration",
        "icon": "Bot",
        "parent_code": None,
        "type": "menu",
        "sort_order": 63,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "model.read",
    },
    {
        "code": "admin.mcp_server",
        "name": "MCP管理",
        "path": "/admin/mcp-server",
        "icon": "Server",
        "parent_code": None,
        "type": "menu",
        "sort_order": 63,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "model.read",
    },
    {
        "code": "admin.mermaid_mgr",
        "name": "流程图",
        "path": "/admin/mermaid-mgr",
        "icon": "Workflow",
        "parent_code": None,
        "type": "menu",
        "sort_order": 54,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "question_bank.read",
    },
    {
        "code": "admin.files",
        "name": "知识集管理",
        "path": "/admin/knowledge-set",
        "icon": "FolderTree",
        "parent_code": None,
        "type": "menu",
        "sort_order": 54,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "file.read",
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
        "code": "admin.power_lines",
        "name": "线路管理",
        "path": "/admin/power-lines",
        "icon": "Network",
        "parent_code": None,
        "type": "menu",
        "sort_order": 50,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "line.read",
    },
    {
        "code": "admin.lightning_currents",
        "name": "雷电幅值统计",
        "path": "/admin/lightning-currents",
        "icon": "Zap",
        "parent_code": None,
        "type": "menu",
        "sort_order": 51,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "lightning.read",
    },
    {
        "code": "admin.lightning_distribution",
        "name": "雷电分布统计",
        "path": "/admin/lightning-distribution",
        "icon": "Map",
        "parent_code": None,
        "type": "menu",
        "sort_order": 52,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "lightning.read",
    },
    {
        "code": "admin.mindmap",
        "name": "思维导图",
        "path": "/admin/mindmap",
        "icon": "ChartBar",
        "parent_code": None,
        "type": "menu",
        "sort_order": 51,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "question_bank.read",
    },
    {
        "code": "admin.schedule",
        "name": "日程管理",
        "path": "/admin/schedule",
        "icon": "CalendarDays",
        "parent_code": None,
        "type": "menu",
        "sort_order": 52,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "todo.read",
    },
    {
        "code": "admin.task_monitor",
        "name": "任务监控",
        "path": "/admin/task-monitor",
        "icon": "RadarChart",
        "parent_code": None,
        "type": "menu",
        "sort_order": 53,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "requirement.read",
    },
    {
        "code": "admin.syslog",
        "name": "系统日志",
        "path": "/admin/syslog",
        "icon": "FileText",
        "parent_code": None,
        "type": "menu",
        "sort_order": 57,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "menu.read",
    },
    {
        "code": "admin.chat",
        "name": "AI 聊天",
        "path": "/admin/chat",
        "icon": "MessagesSquare",
        "parent_code": None,
        "type": "menu",
        "sort_order": 58,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "chat.use",
    },
    {
        "code": "admin.api_tester",
        "name": "API测试",
        "path": "/admin/api-tester",
        "icon": "TestTube2",
        "parent_code": None,
        "type": "menu",
        "sort_order": 63,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "model.read",
    },
    {
        "code": "admin.models",
        "name": "模型管理",
        "path": "/admin/models",
        "icon": "Bot",
        "parent_code": None,
        "type": "menu",
        "sort_order": 64,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "model.read",
    },
    {
        "code": "admin.wine_runner",
        "name": "Wine执行器",
        "path": "/admin/wine-runner",
        "icon": "Terminal",
        "parent_code": None,
        "type": "menu",
        "sort_order": 65,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "wine.read",
    },
]

ROLE_MENU_BINDINGS: dict[str, list[str]] = {
    "admin": ["dashboard", "admin.users", "admin.roles", "admin.menus", "admin.system_params", "admin.agent", "admin.mcp_server", "admin.files", "admin.requirements", "admin.power_lines", "admin.lightning_currents", "admin.lightning_distribution", "admin.mindmap", "admin.schedule", "admin.task_monitor", "admin.mermaid_mgr", "admin.syslog", "admin.chat", "admin.api_tester", "admin.models", "admin.wine_runner"],
    "user": ["dashboard"],
}

def _default_file_storage_backends() -> list[dict[str, object]]:
    minio_enabled = bool(settings.minio_enabled)
    return [
        {
            "code": "files.vfs.default",
            "name": "本地 VFS 存储",
            "driver_type": "VFS",
            "status": "disabled" if minio_enabled else "enabled",
            "is_default": not minio_enabled,
            "config_json": {"root_dir": settings.file_vfs_root},
        },
        {
            "code": "files.s3.default",
            "name": "S3 对象存储",
            "driver_type": "S3",
            "status": "enabled" if minio_enabled else "disabled",
            "is_default": minio_enabled,
            "config_json": {
                "bucket": settings.minio_bucket,
                "region_name": settings.minio_region,
                "endpoint_url": settings.minio_endpoint,
                "access_key_id": settings.minio_access_key,
                "secret_access_key": settings.minio_secret_key,
            },
        },
    ]


def _default_file_storage_mounts() -> list[dict[str, object]]:
    default_backend_code = "files.s3.default" if settings.minio_enabled else "files.vfs.default"
    return [
        {
            "code": "main",
            "name": "主文件区",
            "backend_code": default_backend_code,
            "mount_path": "/",
            "root_path": "/",
            "is_enabled": True,
        },
    ]


def seed_defaults(db: Session) -> None:
    permissions = _seed_permissions(db)
    roles = _seed_roles(db, permissions)
    menus = _seed_menus(db)
    _seed_role_menus(db, roles, menus)
    _seed_file_storage(db)
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
            status="ENABLED",
        )
        db.add(user)
        db.flush()

    role_codes = {role.code for role in user.roles}
    if "admin" not in role_codes:
        user.roles.append(admin_role)


def _seed_file_storage(db: Session) -> None:
    backend_map: dict[str, FileStorageBackend] = {}

    for backend_info in _default_file_storage_backends():
        code = str(backend_info["code"])
        backend = db.scalar(select(FileStorageBackend).where(FileStorageBackend.code == code))
        config_json = backend_info.get("config_json")
        normalized_config = config_json if isinstance(config_json, dict) else {}

        if not backend:
            backend = FileStorageBackend(
                code=code,
                name=str(backend_info["name"]),
                driver_type=str(backend_info["driver_type"]),
                status=str(backend_info["status"]),
                is_default=bool(backend_info["is_default"]),
                config_json=normalized_config,
            )
            db.add(backend)
            db.flush()
        else:
            backend.name = str(backend_info["name"])
            backend.driver_type = str(backend_info["driver_type"])
            backend.status = str(backend_info["status"])
            backend.is_default = bool(backend_info["is_default"])
            backend.config_json = normalized_config
        backend_map[code] = backend

    for mount_info in _default_file_storage_mounts():
        code = str(mount_info["code"])
        backend_code = str(mount_info["backend_code"])
        backend = backend_map.get(backend_code)
        if not backend:
            continue

        mount = db.scalar(select(FileStorageMount).where(FileStorageMount.code == code))
        if not mount:
            mount = FileStorageMount(
                code=code,
                name=str(mount_info["name"]),
                backend_id=backend.id,
                mount_path=str(mount_info["mount_path"]),
                root_path=str(mount_info["root_path"]),
                is_enabled=bool(mount_info["is_enabled"]),
            )
            db.add(mount)
            db.flush()
            continue

        mount.name = str(mount_info["name"])
        mount.backend_id = backend.id
        mount.mount_path = str(mount_info["mount_path"])
        mount.root_path = str(mount_info["root_path"])
        if mount_info.get("is_enabled") is not None:
            mount.is_enabled = bool(mount_info["is_enabled"])
