from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..core.security import hash_password
from ..models.file_storage import FileStorageBackend, FileStorageMount
from ..models.menu import Menu
from ..models.rbac import Permission, Role
from ..models.tower_model import TowerModel
from ..models.user import User
from .tower_model_service import seed_tower_models_from_legacy

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
    "file.read": "Read file mounts and indexed entries",
    "file.manage": "Manage file operations and storage sync",
    "question_bank.read": "Read question bank entries",
    "question_bank.manage": "Manage question bank entries",
    "line.read": "Read power lines",
    "line.manage": "Manage power lines",
    "tower.read": "Read line towers",
    "tower.manage": "Manage line towers",
    "tower_model.read": "Read tower model library",
    "tower_model.manage": "Manage tower model library and images",
    "lightning.read": "Read lightning current events and features",
    "lightning.manage": "Manage lightning current events and data imports",
    "elevation.read": "Read elevation datasets and apply jobs",
    "elevation.manage": "Manage elevation datasets and run altitude apply jobs",
    "atp.read": "Read ATP models and versions",
    "atp.manage": "Manage ATP models and version artifacts",
    "atp.run": "Run ATP simulations",
    "celery.read": "Read Celery workers, queues, and task statuses",
    "celery.manage": "Manage Celery worker control operations",
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
            "file.read",
            "file.manage",
            "question_bank.read",
            "question_bank.manage",
            "line.read",
            "line.manage",
            "tower.read",
            "tower.manage",
            "tower_model.read",
            "tower_model.manage",
            "lightning.read",
            "lightning.manage",
            "elevation.read",
            "elevation.manage",
            "atp.read",
            "atp.manage",
            "atp.run",
            "celery.read",
            "celery.manage",
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
        "code": "admin.users",
        "name": "用户管理",
        "path": "/admin/users",
        "icon": "Users",
        "parent_code": None,
        "type": "menu",
        "sort_order": 10,
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
        "code": "admin.fl_analysis",
        "name": "防雷分析结果",
        "path": "/admin/fl-analysis",
        "icon": "BarChart3",
        "parent_code": None,
        "type": "menu",
        "sort_order": 50,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "line.read",
    },
    {
        "code": "admin.fault_recurrence",
        "name": "故障复现",
        "path": "/admin/fault-recurrence",
        "icon": "Experiment",
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
        "code": "admin.workers",
        "name": "Worker监控",
        "path": "/admin/workers",
        "icon": "DeploymentUnitOutlined",
        "parent_code": None,
        "type": "menu",
        "sort_order": 53,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "celery.read",
    },
    {
        "code": "admin.task_monitor",
        "name": "任务监控",
        "path": "/admin/task-monitor",
        "icon": "RadarChart",
        "parent_code": None,
        "type": "menu",
        "sort_order": 54,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "celery.read",
    },
    {
        "code": "admin.atp_models",
        "name": "ATP模型管理",
        "path": "/admin/power-lines/atp-viewer",
        "icon": "Experiment",
        "parent_code": None,
        "type": "menu",
        "sort_order": 55,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "atp.read",
    },
    {
        "code": "admin.tower_models",
        "name": "杆塔模型管理",
        "path": "/admin/tower-models",
        "icon": "Apartment",
        "parent_code": None,
        "type": "menu",
        "sort_order": 56,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "tower_model.read",
    },
    {
        "code": "admin.files",
        "name": "文件管理",
        "path": "/admin/files",
        "icon": "FolderTree",
        "parent_code": None,
        "type": "menu",
        "sort_order": 57,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "file.read",
    },
    {
        "code": "admin.elevation",
        "name": "高程数据管理",
        "path": "/admin/elevation",
        "icon": "Database",
        "parent_code": None,
        "type": "menu",
        "sort_order": 58,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "elevation.read",
    },
    {
        "code": "admin.syslog",
        "name": "系统日志",
        "path": "/admin/syslog",
        "icon": "FileText",
        "parent_code": None,
        "type": "menu",
        "sort_order": 59,
        "status": "enabled",
        "visible": True,
        "cacheable": False,
        "permission_code": "menu.read",
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
    "admin": ["admin.users", "admin.roles", "admin.menus", "admin.system_params", "admin.power_lines", "admin.fl_analysis", "admin.fault_recurrence", "admin.lightning_currents", "admin.lightning_distribution", "admin.workers", "admin.task_monitor", "admin.atp_models", "admin.tower_models", "admin.files", "admin.elevation", "admin.syslog", "admin.wine_runner"],
    "user": [],
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
    _seed_legacy_tower_models_if_empty(db)


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


def _seed_initial_admin(db: Session) -> None:
    if not settings.initial_admin_email or not settings.initial_admin_password:
        return

    admin_role = db.scalar(select(Role).where(Role.code == "admin"))
    if not admin_role:
        return

    admin_user_id = settings.initial_admin_user_id.strip()
    if not admin_user_id:
        return

    admin_email = settings.initial_admin_email.lower()
    user = db.scalar(select(User).where((User.id == admin_user_id) | (User.email == admin_email)))
    if not user:
        user = User(
            id=admin_user_id,
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


def _seed_legacy_tower_models_if_empty(db: Session) -> None:
    existing_count = int(db.scalar(select(func.count()).select_from(TowerModel)) or 0)
    if existing_count > 0:
        return

    actor = db.scalar(select(User).where(User.id == settings.initial_admin_user_id))
    if actor is None:
        actor = db.scalar(select(User).where(User.username == settings.initial_admin_username))
    if actor is None:
        actor = db.scalar(select(User).order_by(User.created_at.asc()))
    if actor is None:
        return

    try:
        seed_tower_models_from_legacy(
            db,
            actor=actor,
            overwrite_existing=False,
        )
    except Exception:
        db.rollback()
