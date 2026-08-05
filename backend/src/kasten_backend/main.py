"""FastAPI application entrypoint."""

from typing import Annotated

from fastapi import Depends, FastAPI
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.vault import list_markdown_files

app = FastAPI(title="kasten", version="0.1.0")


class Health(BaseModel):
    """Liveness response."""

    status: str


@app.get("/api/health")
async def health() -> Health:
    """Report that the process is up. Deliberately does not touch the database."""
    return Health(status="ok")


@app.get("/api/files")
async def list_files(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """List every note in the vault as a relative POSIX path, sorted.

    The client folds these into a folder tree; the server stays flat.
    """
    return list_markdown_files(settings.vault_path)
