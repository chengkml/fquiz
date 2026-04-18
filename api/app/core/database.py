from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args: dict[str, bool] = {}
if settings.database_url.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(
    settings.database_url,
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


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models so metadata includes every table before create_all.
    from ..models import (
        audit_log,
        auth_session,
        chat,
        file_storage,
        hot_search,
        life_countdown,
        menu,
        model_registry,
        question_bank,
        rbac,
        requirement,
        system_message,
        system_param,
        todo,
        user,
        vocabulary_word,
    )  # noqa: F401
    from ..services.seed_service import seed_defaults

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_defaults(db)
