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


def _ensure_user_timestamp_column_compatibility() -> None:
    """
    Keep `users` timestamp columns aligned with the current ORM mapping.

    Legacy deployments may still use `create_date` / `update_date`,
    while current models expect `created_at` / `updated_at`.
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

        if "created_at" not in column_names and "create_date" in column_names:
            connection.execute(text("ALTER TABLE users RENAME COLUMN create_date TO created_at"))
            logger.warning(
                "Detected legacy users.create_date; renamed to users.created_at for schema compatibility.",
            )
            column_names.remove("create_date")
            column_names.add("created_at")

        if "updated_at" not in column_names and "update_date" in column_names:
            connection.execute(text("ALTER TABLE users RENAME COLUMN update_date TO updated_at"))
            logger.warning(
                "Detected legacy users.update_date; renamed to users.updated_at for schema compatibility.",
            )

def _rename_user_column_if_needed(
    connection: Any,
    *,
    column_names: set[str],
    target_column: str,
    legacy_candidates: tuple[str, ...],
) -> set[str]:
    if target_column in column_names:
        return column_names

    legacy_column = next(
        (candidate for candidate in legacy_candidates if candidate in column_names),
        None,
    )
    if not legacy_column:
        return column_names

    connection.execute(
        text(f"ALTER TABLE users RENAME COLUMN {legacy_column} TO {target_column}"),
    )
    logger.warning(
        "Detected legacy users.%s; renamed to users.%s for schema compatibility.",
        legacy_column,
        target_column,
    )
    column_names.remove(legacy_column)
    column_names.add(target_column)
    return column_names


def _ensure_user_audit_column_compatibility() -> None:
    """
    Keep `users` audit columns aligned with the current ORM mapping.

    Some legacy deployments use `create_by` / `created_by` and
    `update_by` / `updated_by`, or may miss these nullable columns.
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

        column_names = _rename_user_column_if_needed(
            connection,
            column_names=column_names,
            target_column="create_user",
            legacy_candidates=("create_by", "created_by"),
        )
        column_names = _rename_user_column_if_needed(
            connection,
            column_names=column_names,
            target_column="update_user",
            legacy_candidates=("update_by", "updated_by"),
        )

        if "create_user" not in column_names:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN IF NOT EXISTS create_user VARCHAR(64)"),
            )
            logger.warning(
                "Detected missing users.create_user; added nullable create_user column for schema compatibility.",
            )
            column_names.add("create_user")

        if "update_user" not in column_names:
            connection.execute(
                text("ALTER TABLE users ADD COLUMN IF NOT EXISTS update_user VARCHAR(64)"),
            )
            logger.warning(
                "Detected missing users.update_user; added nullable update_user column for schema compatibility.",
            )


def _ensure_elevation_dataset_column_compatibility() -> None:
    """
    Keep `elevation_dataset` columns aligned with the current ORM mapping.
    """
    if not database_url.startswith("postgresql"):
        return

    schema = settings.resolved_db_schema
    with engine.begin() as connection:
        db_inspector = inspect(connection)
        if not db_inspector.has_table("elevation_dataset", schema=schema):
            return

        column_names = {
            column["name"]
            for column in db_inspector.get_columns("elevation_dataset", schema=schema)
        }

        if "dataset_dir" not in column_names:
            connection.execute(
                text("ALTER TABLE elevation_dataset ADD COLUMN IF NOT EXISTS dataset_dir VARCHAR(2048)"),
            )
            connection.execute(
                text("UPDATE elevation_dataset SET dataset_dir = '/elevation/datasets/' || code WHERE dataset_dir IS NULL"),
            )
            connection.execute(
                text("ALTER TABLE elevation_dataset ALTER COLUMN dataset_dir SET NOT NULL"),
            )
            logger.warning(
                "Detected missing elevation_dataset.dataset_dir; added and backfilled from dataset code.",
            )

        if "usage_status" not in column_names:
            connection.execute(
                text("ALTER TABLE elevation_dataset ADD COLUMN IF NOT EXISTS usage_status VARCHAR(32)"),
            )
            connection.execute(
                text("UPDATE elevation_dataset SET usage_status = 'idle' WHERE usage_status IS NULL"),
            )
            connection.execute(
                text("ALTER TABLE elevation_dataset ALTER COLUMN usage_status SET NOT NULL"),
            )
            logger.warning(
                "Detected missing elevation_dataset.usage_status; added with default 'idle'.",
            )

        if "analysis_task_id" not in column_names:
            connection.execute(
                text("ALTER TABLE elevation_dataset ADD COLUMN IF NOT EXISTS analysis_task_id VARCHAR(128)"),
            )
            logger.warning(
                "Detected missing elevation_dataset.analysis_task_id; added nullable analysis task id column.",
            )

        if "analysis_status" not in column_names:
            connection.execute(
                text("ALTER TABLE elevation_dataset ADD COLUMN IF NOT EXISTS analysis_status VARCHAR(32)"),
            )
            connection.execute(
                text("UPDATE elevation_dataset SET analysis_status = 'not_started' WHERE analysis_status IS NULL"),
            )
            connection.execute(
                text("ALTER TABLE elevation_dataset ALTER COLUMN analysis_status SET NOT NULL"),
            )
            logger.warning(
                "Detected missing elevation_dataset.analysis_status; added with default 'not_started'.",
            )

        if "analysis_error_message" not in column_names:
            connection.execute(
                text("ALTER TABLE elevation_dataset ADD COLUMN IF NOT EXISTS analysis_error_message TEXT"),
            )
            logger.warning(
                "Detected missing elevation_dataset.analysis_error_message; added nullable analysis error column.",
            )

        if "analysis_started_at" not in column_names:
            connection.execute(
                text("ALTER TABLE elevation_dataset ADD COLUMN IF NOT EXISTS analysis_started_at TIMESTAMPTZ"),
            )
            logger.warning(
                "Detected missing elevation_dataset.analysis_started_at; added nullable analysis start time column.",
            )

        if "analysis_finished_at" not in column_names:
            connection.execute(
                text("ALTER TABLE elevation_dataset ADD COLUMN IF NOT EXISTS analysis_finished_at TIMESTAMPTZ"),
            )
            logger.warning(
                "Detected missing elevation_dataset.analysis_finished_at; added nullable analysis finish time column.",
            )


def _ensure_tower_model_column_compatibility() -> None:
    """
    Keep `tower_model` columns aligned with the current ORM mapping.
    """
    if not database_url.startswith("postgresql"):
        return

    schema = settings.resolved_db_schema
    with engine.begin() as connection:
        db_inspector = inspect(connection)
        if not db_inspector.has_table("tower_model", schema=schema):
            return

        column_names = {
            column["name"]
            for column in db_inspector.get_columns("tower_model", schema=schema)
        }

        if "source_tag" not in column_names:
            connection.execute(
                text("ALTER TABLE tower_model ADD COLUMN IF NOT EXISTS source_tag VARCHAR(64)"),
            )
            logger.warning(
                "Detected missing tower_model.source_tag; added nullable source tag column.",
            )

        if "sort_order" not in column_names:
            connection.execute(
                text("ALTER TABLE tower_model ADD COLUMN IF NOT EXISTS sort_order INTEGER"),
            )
            connection.execute(
                text("UPDATE tower_model SET sort_order = 0 WHERE sort_order IS NULL"),
            )
            connection.execute(
                text("ALTER TABLE tower_model ALTER COLUMN sort_order SET NOT NULL"),
            )
            logger.warning(
                "Detected missing tower_model.sort_order; added with default 0.",
            )

        if "default_raw_json" not in column_names:
            connection.execute(
                text("ALTER TABLE tower_model ADD COLUMN IF NOT EXISTS default_raw_json JSON"),
            )
            connection.execute(
                text("UPDATE tower_model SET default_raw_json = '{}'::json WHERE default_raw_json IS NULL"),
            )
            connection.execute(
                text("ALTER TABLE tower_model ALTER COLUMN default_raw_json SET NOT NULL"),
            )
            logger.warning(
                "Detected missing tower_model.default_raw_json; added with default empty JSON.",
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
        elevation,
        file_storage,
        hot_search,
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
        tower_model,
        user,
        worker_registry,
    )  # noqa: F401
    from ..services.seed_service import seed_defaults

    _ensure_user_pk_column_compatibility()
    _ensure_user_timestamp_column_compatibility()
    _ensure_user_audit_column_compatibility()
    _ensure_elevation_dataset_column_compatibility()
    _ensure_tower_model_column_compatibility()
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
