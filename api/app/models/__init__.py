"""Database model package.

Import all model modules during package initialization so SQLAlchemy can
resolve string-based relationships regardless of route/service import order.
"""

from . import audit_log, auth_session, chat, file_storage, hot_search, life_countdown, menu, model_registry, question_bank, rbac, requirement, system_message, system_param, todo, user, vocabulary_word

__all__ = [
    "audit_log",
    "auth_session",
    "chat",
    "file_storage",
    "hot_search",
    "life_countdown",
    "menu",
    "model_registry",
    "question_bank",
    "rbac",
    "requirement",
    "system_message",
    "system_param",
    "todo",
    "user",
    "vocabulary_word",
]
