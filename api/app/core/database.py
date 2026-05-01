from collections.abc import Generator
import logging
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

database_url = settings.resolved_database_url

connect_args: dict[str, Any] = {}
if database_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False
elif database_url.startswith("postgresql"):
    schema = settings.resolved_db_schema
    if schema:
        connect_args["options"] = f"-csearch_path={schema}"

engine = create_engine(
    database_url,
    pool_pre_ping=True,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


def _ensure_user_pk_column_compatibility() -> None:
    """
    Keep legacy databases compatible with the current ORM mapping.

    Historical deployments may still use `users.id` as the primary key column.
    Current models and foreign keys uniformly target `users.user_id`.
    """
    if not database_url.startswith("postgresql"):
        return

    schema = settings.resolved_db_schema
    with engine.begin() as connection:
        db_inspector = inspect(connection)
        if not db_inspector.has_table("users", schema=schema):
            return

        column_names = {
            column["name"]
            for column in db_inspector.get_columns("users", schema=schema)
        }
        if "user_id" in column_names or "id" not in column_names:
            return

        connection.execute(text("ALTER TABLE users RENAME COLUMN id TO user_id"))
        logger.warning(
            "Detected legacy users.id primary key; renamed to users.user_id for schema compatibility.",
        )


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models so metadata includes every table before create_all.
    from ..models import (
        atp_model,
        audit_log,
        auth_session,
        calendar_event,
        diary,
        file_storage,
        hot_search,
        life_countdown,
        lightning_event,
        lightning_sample,
        line,
        line_tower,
        menu,
        model_registry,
        object_group,
        question_bank,
        rbac,
        requirement,
        system_param,
        todo,
        user,
        vocabulary_word,
    )  # noqa: F401
    from ..services.seed_service import seed_defaults

    _ensure_user_pk_column_compatibility()
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        local_hosts = {"db", "localhost", "127.0.0.1", "::1"}
        database_url = (settings.database_url or "").strip().lower()
        database_url_targets_local = any(
            token in database_url for token in ("@db:", "@localhost:", "@127.0.0.1:", "@[::1]:")
        )
        should_seed_defaults = (
            settings.db_host.strip().lower() in local_hosts
            or database_url_targets_local
        )

        if should_seed_defaults:
            seed_defaults(db)
        else:
            logger.info(
                "Skip seed defaults for non-local database target: host=%s",
                settings.db_host,
            )
