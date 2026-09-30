"""What a token holder may do to the vault. No HTTP, no MCP, no auth.

Two surfaces call these: the `/agent/` routes and the MCP tools. One
implementation, so there is one path validator, one write bracket and one set of
rules about what an agent may do, rather than two that drift.

Every path argument goes through the resolvers in `vault.py`, so the boundary
that keeps a caller inside the vault is the existing one rather than a second
copy of it. Each function takes a `Settings` rather than a bare path, because
the archive folder is a setting and a capability that hardcoded `98 Archive`
would break the moment a vault filed things differently.

Deliberately seven things and not the twenty-four `/api/*` serves. There is no
delete, no move and no folder operation: a move rewrites wikilinks across the
whole vault, and getting that wrong from outside the box is a vault-wide edit.
The shell container keeps the knife.
"""

import hashlib
from datetime import date  # noqa: TC003  pydantic reads the annotation at runtime
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend.change import vault_change, vault_write
from kasten_backend.frontmatter import reserved, stamp
from kasten_backend.graph import Graph, query_graph
from kasten_backend.periodic import append_dump, daily_note, daily_path
from kasten_backend.search import search_vault
from kasten_backend.vault import (
    create_note,
    list_markdown_files,
    relative_path,
    resolve_folder,
    resolve_note,
    resolve_path,
    write_note,
)

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.config import Settings


class NoteRead(BaseModel):
    """One note, and the digest a conditional write presents back."""

    path: str
    content: str
    sha: str


class Hit(BaseModel):
    """One matching line: where it lives, which line it is, and what it says.

    Its own model rather than `main.SearchHit`, because nothing here may import
    from `main.py`: that would point the dependency at the surface instead of
    away from it, and the MCP tools import this module too.
    """

    path: str
    line: int
    text: str


class Save(BaseModel):
    """A whole note, and the digest of the one the caller read."""

    content: str
    sha: str | None = None


class Append(BaseModel):
    """A line to add, and the digest of the note the caller read, when it read one."""

    text: str
    sha: str | None = None


class Dump(BaseModel):
    """One thought for a day's dump, and the day the sender is having."""

    text: str

    date: date
    """The sender's own date, not the server's.

    The server's clock may sit in another timezone, and a thought typed at half
    past midnight belongs to the day the person typing it is in. Required for
    the same reason: the process has no notion of the vault's zone to fall back
    on, and a guess made in UTC files an evening's thought under tomorrow.
    """


class ConflictError(Exception):
    """The note on disk is not the one the caller read."""

    def __init__(self, current: str | None) -> None:
        """Refuse the write, carrying the digest the caller needs to read and retry."""
        super().__init__(CHANGED)
        self.current = current
        """The digest on disk, or None when there is no note there to digest."""


class TooLargeError(Exception):
    """The write would leave more on disk than the vault's history will hold.

    Its own class rather than a `ValueError`, because the handler that answers it
    is registered on the whole application: a blanket `ValueError` there would
    turn every unrelated one raised anywhere into a 413.
    """


class EmptyCaptureError(Exception):
    """A dump was asked to take text with nothing in it once trimmed.

    Its own class for the reason `TooLargeError` is one: its handler is
    registered on the whole application.
    """


CHANGED = "The note changed since you read it"
"""What both surfaces say when a write is refused, word for word."""

NOTHING = "Nothing to capture"
"""What every surface says when a dump is handed no words."""

MOST_CONTENT_BYTES = 1024 * 1024
"""The most one write may leave on disk.

One mebibyte because that is the size above which jj stops tracking a new file
by default, and therefore the size above which "jj holds the history" stops
being true.
"""


def digest(content: bytes) -> str:
    """The SHA-256 hex of the bytes on disk, which is what `sha` always means here."""
    return hashlib.sha256(content).hexdigest()


def _read(root: Path, note: Path) -> NoteRead:
    """One note off disk, byte for byte.

    Read as bytes and decoded rather than through `vault.read_note`, which is
    `read_text` and turns every CRLF into an LF. A translated read would hand
    back a `content` whose digest is not the `sha` beside it, and a round trip
    would rewrite every line of a note written on Windows.
    """
    raw = note.read_bytes()

    return NoteRead(path=relative_path(root, note), content=raw.decode("utf-8"), sha=digest(raw))


async def read_note(settings: Settings, path: str) -> NoteRead | None:
    """One note out of the vault, or None when the vault holds no such note.

    Every refusal reads as absent, the way `vault.read_note`'s does: telling a
    typo apart from an attempt to climb out is worth nothing to the caller and
    something to everyone else.
    """
    note = resolve_note(settings.vault_path, path)
    if note is None:
        return None

    return _read(settings.vault_path, note)


async def list_notes(settings: Settings, folder: str = "") -> list[str]:
    """Every note in the vault, or in one folder of it, as sorted relative paths.

    `""` is an explicit sentinel for the whole vault and does not go through the
    folder resolver, which refuses the vault root by design. The root case
    filters the listing by prefix instead.

    A folder outside the vault is an empty list rather than a refusal, matching
    how every other escape in `vault.py` reads as absent.
    """
    notes = list_markdown_files(settings.vault_path)
    if not folder:
        return notes

    found = resolve_folder(settings.vault_path, folder)
    if found is None:
        return []

    prefix = f"{relative_path(settings.vault_path, found)}/"

    return [note for note in notes if note.startswith(prefix)]


async def search_notes(settings: Settings, query: str, archive: bool = False) -> list[Hit]:
    """Every line in the vault holding `query`, ignoring case, up to the same cap.

    The archive folder is walked past unless it is asked for, and its name comes
    off the settings rather than a literal `98 Archive`, which is one vault's
    filing convention and not kasten's.
    """
    skip = None if archive else settings.archive_path
    hits = await search_vault(settings.vault_path, query, skip)

    return [Hit(path=hit.path, line=hit.line, text=hit.text) for hit in hits]


async def graph(
    settings: Settings,
    query: str = "",
    around: str | None = None,
    depth: int = 1,
    archive: bool = False,
) -> Graph:
    """The notes as a graph, narrowed by a filter or asked a pattern.

    The function `GET /api/graph` calls, so the browser's graph and the agent's
    answer from one parser. A seventh capability and a read: it walks the same
    notes a search walks, and an agent asking what depends on a note would
    otherwise read every note that names it and parse the relations itself.
    """
    skip = None if archive else settings.archive_path
    return await query_graph(settings.vault_path, query, around, depth, skip)


def _agree(previous: bytes | None, sha: str | None, *, optional: bool) -> None:
    """Refuse a write whose caller read a different note, or none at all.

    One comparison covers every rule a save has. A `sha` must be absent when the
    note is, present when the note is, and equal to the note on disk when both
    are there. `current` is None in exactly one case, a digest presented for a
    note that does not exist, which is why it is `str | None` rather than `str`.

    `optional` is an append, whose `sha` may be left off entirely: the read and
    the write happen under one acquisition of the lock, so adding a line races
    nothing and needs no digest to be safe. A digest given anyway is checked.
    """
    if optional and sha is None:
        return

    current = None if previous is None else digest(previous)
    if sha != current:
        raise ConflictError(current)


def _write(relative: str, content: str, previous: bytes | None) -> str:
    r"""The bytes a save leaves on disk: stamped, unless the name is reserved.

    `stamp` rebuilds the file with `"\n".join(...)`, so CRLF text passed through
    it comes out with every line ending rewritten. Normalised before and put back
    after, the dance `PUT /api/files` and the type backfill already do: a note
    that was CRLF stays CRLF, and one that was LF is unaffected.

    The note on disk is what the id, the creation date and the type come from
    when the text being written carries none of them, exactly as a browser save
    does, so an agent that dropped the block does not mint the note a second id.
    """
    if reserved(relative):
        return content

    crlf = "\r\n" in content
    held = "" if previous is None else previous.decode("utf-8").replace("\r\n", "\n")
    stamped = stamp(content.replace("\r\n", "\n"), held)

    return stamped.replace("\n", "\r\n") if crlf else stamped


def _bounded(content: str) -> str:
    """`content`, or a refusal when it would not fit.

    Measured on the bytes that would land, after the join and after the stamp.
    Bounding the incoming text alone would let a note just under the line plus a
    small append cross it.
    """
    if len(content.encode("utf-8")) > MOST_CONTENT_BYTES:
        raise TooLargeError(f"That write would leave more than {MOST_CONTENT_BYTES} bytes on disk")

    return content


async def _put(
    settings: Settings, path: str, body: str, sha: str | None, *, appending: bool
) -> NoteRead | None:
    """Write one note under the lock, and hand back what landed.

    The digest is taken inside `vault_write` and immediately before the write,
    so the comparison and the write it guards cannot be separated. That is what
    closes the direction that matters: an agent cannot overwrite an edit the
    browser made between the agent's read and its write.
    """
    note = resolve_path(settings.vault_path, path)
    if note is None:
        return None

    relative = relative_path(settings.vault_path, note)
    async with vault_write():
        previous = note.read_bytes() if note.is_file() else None
        _agree(previous, sha, optional=appending)

        if appending and previous is not None:
            # Exactly one blank line between what was there and what arrives,
            # and a trailing newline when the caller left one off. The stripped
            # text keeps its own CRLF, which is what tells `_write` below that
            # the note is a CRLF one even when the appended line is not.
            tail = body if body.endswith("\n") else f"{body}\n"
            body = f"{previous.decode('utf-8').rstrip(chr(13) + chr(10))}\n\n{tail}"

        content = _bounded(_write(relative, body, previous))
        async with vault_change(settings.vault_path, relative):
            if previous is None:
                create_note(note, content)
            else:
                write_note(note, content)

        return _read(settings.vault_path, note)


async def save_note(
    settings: Settings, path: str, content: str, sha: str | None
) -> NoteRead | None:
    """Write one note, creating it when `sha` is absent and it is."""
    return await _put(settings, path, content, sha, appending=False)


async def append_note(settings: Settings, path: str, text: str, sha: str | None) -> NoteRead | None:
    """Add `text` to the end of one note, creating it with `text` as its whole body.

    A created note gets `text` and no leading blank line, through the same
    `create_note(note, stamp(text))` a browser create makes, rather than an
    empty note appended to.
    """
    return await _put(settings, path, text, sha, appending=True)


async def dump(settings: Settings, text: str, day: date) -> NoteRead | None:
    """Add `text` as a paragraph at the end of the `## Dump` section of `day`'s note.

    The one implementation behind both `POST /api/dump` and the agent's `dump`.
    The note is made where the vault has none, exactly as `<leader>gd` would
    make it, and the section where the note has none.

    A sixth capability, and a narrower one than the append beside it: the path
    is not the caller's to choose, and nothing already in the note can be
    overwritten. No digest, for the reason an append needs none: the read and
    the write happen under one hold of the lock.
    """
    capture = text.strip()
    if capture == "":
        raise EmptyCaptureError(NOTHING)

    note = resolve_path(settings.vault_path, daily_path(day))
    if note is None:
        return None

    relative = relative_path(settings.vault_path, note)
    async with vault_write():
        previous = note.read_bytes() if note.is_file() else None
        held = daily_note(day) if previous is None else previous.decode("utf-8")
        content = _bounded(_write(relative, append_dump(held, capture), previous))

        async with vault_change(settings.vault_path, relative):
            if previous is None:
                create_note(note, content)
            else:
                write_note(note, content)

        return _read(settings.vault_path, note)
