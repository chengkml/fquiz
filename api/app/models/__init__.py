"""Database model package.

Import all model modules during package initialization so SQLAlchemy can
resolve string-based relationships regardless of route/service import order.
"""

from . import atp_model, audit_log, auth_session, calendar_event, diary, file_storage, hot_search, life_countdown, lightning_event, lightning_sample, line, line_tower, menu, model_registry, object_group, question_bank, rbac, requirement, system_param, todo, user, vocabulary_word

__all__ = [
    "atp_model",
    "audit_log",
    "auth_session",
    "calendar_event",
    "diary",
    "file_storage",
    "hot_search",
    "life_countdown",
    "lightning_event",
    "lightning_sample",
    "line",
    "line_tower",
    "menu",
    "model_registry",
    "object_group",
    "question_bank",
    "rbac",
    "requirement",
    "system_param",
    "todo",
    "user",
    "vocabulary_word",
]
