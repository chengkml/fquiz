from functools import lru_cache
import json
import re
from typing import Literal
from urllib.parse import quote_plus

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    api_name: str = "fquiz-api"
    api_version: str = "0.1.0"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    api_cors_origin_regex: str | None = None

    database_url: str | None = None
    db_host: str = "127.0.0.1"
    db_port: int = 5434
    db_name: str = "postgres"
    db_schema: str = "public"
    db_username: str = "fquiz"
    db_password: str = "fquiz"
    user_username_column: Literal["username", "user_name"] = "username"
    user_password_column: Literal["password", "password_hash"] = "password_hash"
    file_vfs_root: str = "./data/vfs"
    minio_enabled: bool = False
    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "fquiz-files"
    minio_region: str = "us-east-1"

    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    refresh_token_expire_days: int = 30

    refresh_cookie_name: str = "refresh_token"
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    llm_provider_api_keys: str = ""
    llm_request_timeout_seconds: int = 60
    chat_context_message_limit: int = 12
    chat_default_system_prompt: str = "You are a helpful assistant."

    celery_broker_url: str | None = None
    celery_result_backend: str | None = None
    celery_timezone: str = "Asia/Shanghai"
    scheduler_expire_interval_seconds: int = 60

    wine_binary_path: str = "wine"
    wine_allowed_root: str = "./data/wine"
    wine_default_timeout_seconds: int = 300
    wine_max_timeout_seconds: int = 1800

    atp_engine_mode: Literal["wine", "native"] = "wine"
    atp_engine_executable: str = "atp/tpbig.exe"
    atp_storage_root: str = "./data/wine/atp-models"
    atp_engine_workdir: str = "runs"
    atp_engine_default_timeout_seconds: int = 600
    atp_engine_max_timeout_seconds: int = 3600

    initial_admin_email: str | None = None
    initial_admin_username: str = "admin"
    initial_admin_password: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator(
        "access_token_expire_minutes",
        "refresh_token_expire_days",
        "llm_request_timeout_seconds",
        "chat_context_message_limit",
        "db_port",
        "scheduler_expire_interval_seconds",
        "wine_default_timeout_seconds",
        "wine_max_timeout_seconds",
        "atp_engine_default_timeout_seconds",
        "atp_engine_max_timeout_seconds",
    )
    @classmethod
    def validate_positive_numbers(cls, value: int) -> int:
        if value <= 0:
            msg = "Value must be greater than 0"
            raise ValueError(msg)
        return value

    @property
    def cors_origins(self) -> list[str]:
        origins: list[str] = []
        for origin in self.api_cors_origins.split(","):
            normalized = origin.strip()
            if not normalized:
                continue
            if normalized == "*" or "*" in normalized:
                continue
            origins.append(normalized)
        return origins

    @property
    def cors_origin_regex(self) -> str | None:
        regex_parts: list[str] = []
        for origin in self.api_cors_origins.split(","):
            normalized = origin.strip()
            if not normalized:
                continue
            if normalized == "*":
                regex_parts.append(".*")
                continue
            if "*" in normalized:
                wildcard_regex = re.escape(normalized).replace(r"\*", ".*")
                regex_parts.append(f"^{wildcard_regex}$")

        if self.api_cors_origin_regex:
            normalized = self.api_cors_origin_regex.strip()
            if normalized:
                regex_parts.append(normalized)

        if not regex_parts:
            return None
        return "|".join(f"(?:{part})" for part in regex_parts)

    @property
    def llm_provider_key_map(self) -> dict[str, str]:
        raw = self.llm_provider_api_keys.strip()
        if not raw:
            return {}

        if raw.startswith("{"):
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                return {}
            if not isinstance(data, dict):
                return {}
            normalized: dict[str, str] = {}
            for provider, value in data.items():
                if not isinstance(provider, str) or not isinstance(value, str):
                    continue
                provider_key = provider.strip().lower()
                secret = value.strip()
                if provider_key and secret:
                    normalized[provider_key] = secret
            return normalized

        mapping: dict[str, str] = {}
        for token in re.split(r"[,\n;]+", raw):
            pair = token.strip()
            if not pair or "=" not in pair:
                continue
            provider, value = pair.split("=", 1)
            provider_key = provider.strip().lower()
            secret = value.strip()
            if provider_key and secret:
                mapping[provider_key] = secret
        return mapping

    @property
    def resolved_database_url(self) -> str:
        explicit_database_url = (self.database_url or "").strip()
        if explicit_database_url:
            return explicit_database_url

        username = quote_plus(self.db_username.strip())
        password = quote_plus(self.db_password.strip())
        host = self.db_host.strip()
        database = self.db_name.strip()
        return f"postgresql+psycopg://{username}:{password}@{host}:{self.db_port}/{database}"

    @property
    def resolved_db_schema(self) -> str | None:
        schema = self.db_schema.strip()
        if not schema:
            return None
        return schema

    @property
    def resolved_celery_broker_url(self) -> str:
        return (self.celery_broker_url or "redis://redis:6379/0").strip()

    @property
    def resolved_celery_result_backend(self) -> str:
        return (self.celery_result_backend or "redis://redis:6379/1").strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
