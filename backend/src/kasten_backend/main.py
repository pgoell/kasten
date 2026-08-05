"""FastAPI application entrypoint."""

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.vault import list_markdown_files, read_note

app = FastAPI(title="kasten", version="0.1.0")


class Health(BaseModel):
    """Liveness response."""

    status: str


class Note(BaseModel):
    """One note, as it sits on disk."""

    path: str
    """Where the note lives, relative to the vault root."""

    content: str
    """The file's text, unchanged."""


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


@app.get("/api/files/{path:path}")
async def read_file(path: str, settings: Annotated[Settings, Depends(get_settings)]) -> Note:
    """Read one note out of the vault.

    Anything that is not a readable markdown file inside the vault is a 404,
    including paths that try to climb out of it.
    """
    content = read_note(settings.vault_path, path)
    if content is None:
        raise HTTPException(status_code=404, detail="No such note")

    return Note(path=path, content=content)
