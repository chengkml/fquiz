from functools import lru_cache
import re
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    api_name: str = "fquiz-api"
    api_version: str = "0.1.0"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    api_cors_origin_regex: str | None = None

    database_url: str = "sqlite:///./fquiz.db"
    file_vfs_root: str = "./data/vfs"

    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    refresh_cookie_name: str = "refresh_token"
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    initial_admin_email: str | None = None
    initial_admin_username: str = "admin"
    initial_admin_password: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("access_token_expire_minutes", "refresh_token_expire_days")
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
