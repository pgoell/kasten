"""Routes that read, create, save and dump the text of a note."""

import asyncio
import hashlib
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from kasten_backend import agent
from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import Settings, get_settings
from kasten_backend.folders import create_note
from kasten_backend.frontmatter import bases, reserved, stamp, unstamped
from kasten_backend.vault import (
    read_note,
    relative_path,
    resolve_note,
    resolve_path,
    write_note,
)

router = APIRouter()


class Note(BaseModel):
    """One note, as it sits on disk."""

    path: str
    """Where the note lives, relative to the vault root."""

    content: str
    """The file's text, unchanged."""


class NoteEdit(BaseModel):
    """The text for a note. The path it belongs to comes from the URL.

    A save carries one and a create may. Both write the same thing, the note's
    text below its block, so both read the same body.
    """

    content: str
    base: str | None = None
    """Hex sha256 of the UTF-8 text the client believes is on disk, `modified` left out.

    A save that names one is refused when the disk has moved past it. None
    writes unconditionally, as the agent API and the todo writes do.
    """


class NoteSave(NoteEdit):
    """A save's body, which may say the text is a restore from the history pane."""

    restored_from: Annotated[str | None, Field(pattern=r"^[k-z]{1,64}$")] = None
    """The short id of the jj change the text was restored from, or None.

    Names the change after the restore, which keeps it out of the change in hand:
    amended in, the restore would leave the text it replaced in no change. The
    pattern is jj's change-id alphabet, so nothing else reaches a description.
    """


@router.get("/api/files/{path:path}")
async def read_file(path: str, settings: Annotated[Settings, Depends(get_settings)]) -> Note:
    """Read one note out of the vault.

    Anything that is not a readable markdown file inside the vault is a 404,
    including paths that try to climb out of it.
    """
    content = await asyncio.to_thread(read_note, settings.vault_path, path)
    if content is None:
        raise HTTPException(status_code=404, detail="No such note")

    return Note(path=path, content=content)


@router.post("/api/files/{path:path}", status_code=201)
async def create_file(
    path: str,
    settings: Annotated[Settings, Depends(get_settings)],
    edit: NoteEdit | None = None,
) -> Note:
    """Start a new note in the vault, empty unless a body comes with it.

    A 409 for a path taken and a 400 for one the vault will not have, both before any write.
    """
    async with vault_write():
        note = resolve_path(settings.vault_path, path)
        if note is None:
            raise HTTPException(status_code=400, detail="The vault will not take that path")
        if note.exists():
            raise HTTPException(status_code=409, detail="A note is already there")

        relative = relative_path(settings.vault_path, note)
        raw = edit.content if edit else ""
        content = raw if reserved(relative) else stamp(raw)

        async with vault_change(settings.vault_path, relative):
            create_note(note, content)

    return Note(path=relative, content=content)


@router.put("/api/files/{path:path}")
async def save_file(
    path: str, edit: NoteSave, settings: Annotated[Settings, Depends(get_settings)]
) -> Note:
    """Write one note back to the vault, conditional on `base` when one is sent."""
    async with vault_write():
        note = resolve_note(settings.vault_path, path)
        if note is None:
            raise HTTPException(status_code=404, detail="No such note")

        current = note.read_text(encoding="utf-8")
        # Served text has every CR turned to LF, but a client that sent CR names the bytes (#1470).
        texts = {current, note.read_bytes().decode("utf-8")}
        relative = relative_path(settings.vault_path, note)
        candidates = [
            found
            for text in texts
            for found in ([unstamped(text)] if reserved(relative) else bases(text))
        ]
        if edit.base is not None and edit.base not in {
            hashlib.sha256(text.encode("utf-8")).hexdigest() for text in candidates
        }:
            held = any(
                edit.content == text
                if reserved(relative)
                else unstamped(stamp(edit.content, current)) == unstamped(text)
                for text in texts
            )
            if not held:
                raise HTTPException(status_code=409, detail="Changed on disk")
            return Note(path=path, content=current)

        content = edit.content if reserved(relative) else stamp(edit.content, current)

        # A label unlike the plain save's opens a change for the restore, and the
        # next plain save opens another, which seals the restore in its own.
        label = relative
        if edit.restored_from is not None:
            label = f"{relative} (restored from {edit.restored_from})"

        async with vault_change(settings.vault_path, label):
            # A client that sent a CR chose its own endings; its next base names them (#1470).
            write_note(note, content, as_sent="\r" in edit.content)

    return Note(path=path, content=content)


@router.post("/api/dump")
async def capture_dump(
    capture: agent.Capture, settings: Annotated[Settings, Depends(get_settings)]
) -> Note:
    """Add one paragraph to the `## Dump` section of a day's note, under one hold of the lock."""
    landed = await agent.dump(settings, capture.text, capture.date, capture.id)
    if landed is None:
        raise HTTPException(status_code=400, detail="The vault will not take that path")

    return Note(path=landed.path, content=landed.content)
