"""FastAPI application entrypoint."""

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.vault import (
    create_note,
    list_markdown_files,
    read_note,
    relative_path,
    resolve_note,
    resolve_path,
    write_note,
)
from kasten_backend.vcs import begin_change, snapshot

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


class NoteEdit(BaseModel):
    """The new text for a note. The path it belongs to comes from the URL."""

    content: str


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


@app.post("/api/files/{path:path}", status_code=201)
async def create_file(path: str, settings: Annotated[Settings, Depends(get_settings)]) -> Note:
    """Start a new, empty note in the vault.

    This one says why it refused, unlike the read and the write: a 409 for a
    path already taken and a 400 for one the vault will not have. The user is
    about to retype the path and has to know which it was, and the one user
    behind oauth2-proxy learns nothing from a 409 that `GET /api/files` did not
    already hand them.

    The path that comes back is the canonical spelling, not the URL's, because
    the client navigates to it and `ideas/./kasten.md` must not end up in the
    address bar.

    The new note gets its own jj change, bracketed the way a save is. Both
    refusals return before any of that, so a bounced create leaves no change
    behind.
    """
    note = resolve_path(settings.vault_path, path)
    if note is None:
        raise HTTPException(status_code=400, detail="The vault will not take that path")
    if note.exists():
        raise HTTPException(status_code=409, detail="A note is already there")

    relative = relative_path(settings.vault_path, note)

    await begin_change(settings.vault_path, relative)
    create_note(note)
    await snapshot(settings.vault_path)

    return Note(path=relative, content="")


@app.put("/api/files/{path:path}")
async def save_file(
    path: str, edit: NoteEdit, settings: Annotated[Settings, Depends(get_settings)]
) -> Note:
    """Write one note back to the vault.

    Only over a note that is already there. Everything the read refuses is
    refused here too, and for the same reason, so a note you cannot open is a
    note you cannot overwrite.

    The jj change is started before the write and the snapshot taken after, so
    the edit is bracketed by the history rather than trailing it. A vault that
    is not a jj repo skips both.
    """
    note = resolve_note(settings.vault_path, path)
    if note is None:
        raise HTTPException(status_code=404, detail="No such note")

    await begin_change(settings.vault_path, relative_path(settings.vault_path, note))
    write_note(note, edit.content)
    await snapshot(settings.vault_path)

    return Note(path=path, content=edit.content)
