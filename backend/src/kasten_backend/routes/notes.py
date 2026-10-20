"""Routes that read, create, save and dump the text of a note."""

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
    content = read_note(settings.vault_path, path)
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

    This one says why it refused, unlike the read and the write: a 409 for a
    path already taken and a 400 for one the vault will not have. The user is
    about to retype the path and has to know which it was, and the one user
    behind oauth2-proxy learns nothing from a 409 that `GET /api/files` did not
    already hand them.

    The path that comes back is the canonical spelling, not the URL's, because
    the client navigates to it and `ideas/./kasten.md` must not end up in the
    address bar.

    The note starts with its frontmatter, so it has an id from the first moment
    it exists rather than from its first save. A body is written under that
    block and is stamped on the way through, the way a save's text is, so a
    body carrying a block of its own keeps the fields in it.

    The body is optional because most creates have nothing to write: a note the
    reader is about to type is one they type themselves. It exists for the
    client that already knows the text, the periodic notes above all, which
    would otherwise have to save straight over the note they just made. That
    second write is a second event on `/api/events`, and one arriving while the
    reader types into the note it names reads as another writer.

    The new note gets its own jj change, bracketed the way a save is. Both
    refusals return before any of that, so a bounced create leaves no change
    behind.
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
    """Write one note back to the vault.

    Only over a note that is already there. Everything the read refuses is
    refused here too, and for the same reason, so a note you cannot open is a
    note you cannot overwrite.

    The text is stamped on the way through, which dates the note and gives one
    written before kasten its id. The note on disk is read for that, so the id
    it already has outlives a client that sends the note back without one. What
    comes back is therefore what landed on disk rather than what arrived, and it
    is the only thing the client may believe: its own copy is a save behind from
    the moment it sends it.

    The jj change is started before the write and the snapshot taken after, so
    the edit is bracketed by the history rather than trailing it. A vault that
    is not a jj repo skips both.

    A `base` makes the write conditional, a 409 when the disk no longer holds
    that text. An autosave in the air when another writer wrote would otherwise
    land over that writer's text unasked. The base sets `modified` aside because
    every save restamps it, so a client that sent its text and has not heard
    back yet can still name that text as its base.

    For the same reason the base may name the text with the lines `stamp` added
    set aside: an id, a creation date or a type at the head of the block, or the
    whole block on a note sent without one. A page-hide keepalive typed behind a
    quiet write names the text that write sent, and the stamp it landed with is
    no other writer's. The body must match exactly, and anything else is a 409.

    A stale base over a disk that already holds the text is a 200 with the note
    as it stands, and nothing is written. A page-hide keepalive and the quiet
    write it repeats can land in either order, and the second is no conflict.
    """
    async with vault_write():
        note = resolve_note(settings.vault_path, path)
        if note is None:
            raise HTTPException(status_code=404, detail="No such note")

        current = note.read_text(encoding="utf-8")
        relative = relative_path(settings.vault_path, note)
        candidates = [unstamped(current)] if reserved(relative) else bases(current)
        if edit.base is not None and edit.base not in {
            hashlib.sha256(text.encode("utf-8")).hexdigest() for text in candidates
        }:
            held = (
                edit.content == current
                if reserved(relative)
                else unstamped(stamp(edit.content, current)) == unstamped(current)
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
            write_note(note, content)

    return Note(path=path, content=content)


@router.post("/api/dump")
async def capture_dump(
    capture: agent.Capture, settings: Annotated[Settings, Depends(get_settings)]
) -> Note:
    """Add one paragraph to the `## Dump` section of a day's note.

    The daily ritual reads that section at 17:00 and plans the next day from it,
    and this is the way into it from anywhere else: a key in the app, a page on
    a phone, a share from another app. The note and the section are made where
    the vault has neither, the note exactly as `<leader>gd` would make it.

    A route of its own rather than a read and a `PUT` from the client, because
    the read and the write happen under one hold of the lock. A phone and an
    editor autosaving the same note would otherwise race, and the loser's
    paragraph would vanish.

    `agent.dump` is the whole of it, and `POST /agent/dump` calls the same
    function: one rule about where a thought lands, whoever sent it. Text with
    nothing in it after the trim is a 422, answered by the handler registered
    above. Only this route takes the capture's `id`, which makes a phone's
    resend of a queued capture write nothing the second time.
    """
    landed = await agent.dump(settings, capture.text, capture.date, capture.id)
    if landed is None:
        raise HTTPException(status_code=400, detail="The vault will not take that path")

    return Note(path=landed.path, content=landed.content)
