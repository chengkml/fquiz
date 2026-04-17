"""Database model package.

Import all model modules during package initialization so SQLAlchemy can
resolve string-based relationships regardless of route/service import order.
"""

from . import audit_log, auth_session, chat, file_storage, menu, model_registry, rbac, requirement, todo, user

__all__ = [
    "audit_log",
    "auth_session",
    "chat",
    "file_storage",
    "menu",
    "model_registry",
    "rbac",
    "requirement",
    "todo",
    "user",
]
