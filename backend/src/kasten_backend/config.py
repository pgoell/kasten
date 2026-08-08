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

    herdr_sessions_path: Path = Path("/herdr-home/.config/herdr/sessions")
    """Where the shell container keeps one directory per named herdr session.

    That container's home, mounted read-only from the volume it writes, so the
    terminal prompt can offer the sessions that already exist. Nothing here
    starts, stops or reads into a session; the path is only ever listed.

    The default is the container path rather than something relative, because
    production sets no environment variable for it. A backend without the mount
    answers with an empty list and the notebook is unaffected.
    """

    vault_path: Path = Path("vault")
    """Directory of markdown files. This is the source of truth.

    Relative paths resolve against the working directory, so the app is always
    started from the repo root. In production this is overridden with the
    absolute container path /vault.
    """


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, built once."""
    return Settings()
