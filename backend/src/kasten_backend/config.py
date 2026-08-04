"""Application settings, read from the environment and backend/.env."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every field is overridable via a KASTEN_* env var."""

    model_config = SettingsConfigDict(
        env_prefix="KASTEN_",
        env_file=".env",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://kasten:kasten@localhost:5434/kasten_dev"
    """Async SQLAlchemy URL for the derived index. Never holds note content."""

    vault_path: Path = Path("../vault")
    """Directory of markdown files. This is the source of truth."""


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, built once."""
    return Settings()
