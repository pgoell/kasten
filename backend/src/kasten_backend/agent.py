"""What a token holder may do to the vault. No HTTP, no MCP, no auth.

The `/agent/` routes and the MCP tools both call these, so the path rules and
write lock live once. There is no delete, move or folder operation: a move
rewrites wikilinks across the whole vault.
"""

import hashlib
import json
import logging
import os
import tempfile
from datetime import date  # noqa: TC003  pydantic reads the annotation at runtime
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import UUID  # noqa: TC003  pydantic reads the annotation at runtime

from pydantic import BaseModel

from kasten_backend import db
from kasten_backend.change import vault_change, vault_write
from kasten_backend.file_search import FilePlace, search_files
from kasten_backend.folders import create_note
from kasten_backend.frontmatter import reserved, stamp
from kasten_backend.graph_query import query_graph
from kasten_backend.periodic import append_dump, daily_note, daily_path
from kasten_backend.pieces import indexer
from kasten_backend.pieces.route import RankedHit, alike, rank
from kasten_backend.search import search_vault
from kasten_backend.vault import (
    landing,
    list_markdown_files,
    relative_path,
    resolve_folder,
    resolve_note,
    resolve_path,
    write_note,
)

if TYPE_CHECKING:
    from kasten_backend.config import Settings
    from kasten_backend.graph import Graph

logger = logging.getLogger(__name__)


class NoteRead(BaseModel):
    """One note, and the digest a conditional write presents back."""

    path: str
    content: str
    sha: str


class Hit(BaseModel):
    """One matching line: where it lives, which line it is, and what it says.

    Its own model rather than `routes.search.SearchHit`, because nothing here may
    import from `routes/`: that would point the dependency at the surface instead of
    away from it, and the MCP tools import this module too.
    """

    path: str
    line: int
    text: str

    place: FilePlace | None = None
    """Where in a pdf, an epub or an html file the line sits, for a hit in one.

    Left unset for a line of a note, so that hit is dumped as `path`, `line` and
    `text` alone, as it was before files were searched. For a file hit, `line`
    counts lines of its extracted text, not of the file.
    """


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


class Capture(Dump):
    """A dump from the app, which may carry the id its sender minted at typing.

    `POST /api/dump` only. The agent's route and its MCP tool keep `Dump`, so
    an agent's schema never grows a field it has no use for: an agent that
    lost an answer reads the note again rather than resending blind.
    """

    id: UUID | None = None
    """Minted by the phone at typing and sent with every retry.

    It tells a resent capture from a second thought when an answer was lost.
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

    Not a `ValueError`: its 413 handler is registered app-wide.
    """


class EmptyCaptureError(Exception):
    """A dump was asked to take text with nothing in it once trimmed.

    Not a `ValueError`, for the same app-wide handler reason as `TooLargeError`.
    """


CHANGED = "The note changed since you read it"
"""What both surfaces say when a write is refused, word for word."""

NOTHING = "Nothing to capture"
"""What every surface says when a dump is handed no words."""

MOST_CONTENT_BYTES = 1024 * 1024
"""The most one write may leave on disk.

One mebibyte, where jj stops tracking new files by default.
"""


MOST_RECEIPTS = 1000
"""How many capture ids the receipts file keeps, the oldest dropped first.

A phone resends within days, so a thousand captures is months: an id that has
fallen off is one no phone still holds.
"""


def _receipts(store: Path) -> list[str]:
    """Every capture id written so far, oldest first, or none when there is no file.

    A file that cannot be read, is not JSON or is not a list of strings reads as
    none, with a warning. Refusing would stall the phone's queue behind a 500.
    """
    try:
        ids = json.loads(store.read_text("utf-8"))
    except FileNotFoundError:
        return []
    # A permission error or a directory standing at the path, bytes that are
    # not UTF-8, text that is not JSON: each would stall the queue the same way.
    except OSError, UnicodeDecodeError, json.JSONDecodeError:
        ids = None

    if not isinstance(ids, list) or not all(isinstance(each, str) for each in ids):
        logger.warning("%s is not a list of capture ids, so it reads as none", store)
        return []

    return ids


def _receipt(store: Path, ids: list[str]) -> None:
    """Replace the receipts file with `ids`, atomically, as `tokens._write` does.

    A crash mid-write must leave the old list: half a list would fail every capture after.
    """
    store.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=store.parent, prefix=".dump-receipts", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            json.dump(ids[-MOST_RECEIPTS:], output)
        os.replace(temporary, store)  # noqa: PTH105  Path has no atomic replace of a str
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def digest(content: bytes) -> str:
    """The SHA-256 hex of the bytes on disk, which is what `sha` always means here."""
    return hashlib.sha256(content).hexdigest()


def _read(root: Path, note: Path) -> NoteRead:
    """One note off disk, byte for byte.

    Not `vault.read_note`, which turns CRLF into LF: `sha` would no longer match
    `content`, and a round trip would rewrite every line of a CRLF note.
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

    `""` means the whole vault and skips the folder resolver, which refuses the root.
    A folder outside the vault is an empty list, as every escape in `vault.py` is.
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

    Notes first, then the pdf, epub and html files, as `GET /api/search` reads them.
    The archive folder is skipped unless asked for.
    """
    if not query.strip():
        return []
    skip = None if archive else settings.archive_path
    notes = await search_vault(settings.vault_path, query, skip)
    files = await search_files(
        settings.vault_path, settings.text_cache_path, query, len(notes), skip
    )

    return [Hit(path=hit.path, line=hit.line, text=hit.text) for hit in notes] + [
        Hit(path=hit.path, line=hit.line, text=hit.text, place=hit.place) for hit in files
    ]


async def graph(
    settings: Settings,
    query: str = "",
    around: str | None = None,
    depth: int = 1,
    archive: bool = False,
) -> Graph:
    """The notes as a graph, narrowed by a filter or asked a pattern.

    The same function `GET /api/graph` calls, so both answer from one parser.
    """
    skip = None if archive else settings.archive_path
    return await query_graph(settings.vault_path, query, around, depth, skip)


class Meaning(BaseModel):
    """What a search by meaning found, best first."""

    hits: list[RankedHit]
    status: str
    """Empty when the model and the whole index stood behind the hits, else what fell short."""


async def search_meaning(
    settings: Settings, query: str = "", like: str | None = None, archive: bool = False
) -> Meaning:
    """The notes best matching `query` by words and meaning, or with `like`, the notes like it.

    The finder's ranked search and the margin's notes like this one, so all three answer alike.
    """
    running = indexer.running
    said = []
    async with db.session() as session:
        if like:
            note = resolve_note(settings.vault_path, like)
            # The spelling `read_note` would name it by, so both tools take the same paths.
            like = like if note is None else relative_path(settings.vault_path, note)
            found = await alike(settings, session, running, like, archive)
            if not found.read:
                said.append(f"The index holds no note at {like}, so it knows no notes like it.")
        else:
            found = await rank(settings, session, running, query, archive)
            if query.strip() and not found.meaning:
                said.append(_words_only(running))
    if found.indexed < found.notes:
        said.append(f"The index has read {found.indexed} of {found.notes} notes so far.")
    return Meaning(hits=found.hits, status=" ".join(said))


def _words_only(running: indexer.Indexer | None) -> str:
    if running is None:
        return "No embedding model is configured, so these rank by words alone."
    if not running.ready:
        return "The model is still loading, so these rank by words alone."
    return "The model could not embed the query, so these rank by words alone."


def _agree(previous: bytes | None, sha: str | None, *, optional: bool) -> None:
    """Refuse a write whose caller read a different note, or none at all.

    `sha` must be absent when the note is absent, and equal to the digest on disk
    when it is there. `optional` is for an append, which may omit `sha`: its read
    and write share one lock hold, so it races nothing.
    """
    if optional and sha is None:
        return

    current = None if previous is None else digest(previous)
    if sha != current:
        raise ConflictError(current)


def _write(relative: str, content: str, previous: bytes | None) -> str:
    r"""The bytes a save leaves on disk: stamped, unless the name is reserved.

    `stamp` joins lines with `"\n"`, so CRLF is normalised around it and restored
    after. Missing id, creation date and type come from the note on disk.
    """
    if reserved(relative):
        return content

    crlf = "\r\n" in content
    held = "" if previous is None else previous.decode("utf-8").replace("\r\n", "\n")
    stamped = stamp(content.replace("\r\n", "\n"), held)

    return stamped.replace("\n", "\r\n") if crlf else stamped


def _bounded(note: Path, content: str) -> str:
    """`content`, or a refusal when it would not fit at `note`.

    Measured on the bytes that would land: bounding the incoming text alone lets
    a note just under the limit cross it with a small append.
    """
    if len(landing(note, content).encode("utf-8")) > MOST_CONTENT_BYTES:
        raise TooLargeError(f"That write would leave more than {MOST_CONTENT_BYTES} bytes on disk")

    return content


async def _put(
    settings: Settings, path: str, body: str, sha: str | None, *, appending: bool
) -> NoteRead | None:
    """Write one note under the lock, and hand back what landed.

    The digest is taken inside `vault_write`, right before the write, so an agent
    cannot overwrite an edit the browser made after the agent's read.
    """
    note = resolve_path(settings.vault_path, path)
    if note is None:
        return None

    relative = relative_path(settings.vault_path, note)
    async with vault_write():
        previous = note.read_bytes() if note.is_file() else None
        _agree(previous, sha, optional=appending)

        if appending and previous is not None:
            # One blank line between the old text and the new, and a trailing newline.
            tail = body if body.endswith("\n") else f"{body}\n"
            body = f"{previous.decode('utf-8').rstrip(chr(13) + chr(10))}\n\n{tail}"

        content = _bounded(note, _write(relative, body, previous))
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

    A created note gets no leading blank line: it is made as a browser create makes it.
    """
    return await _put(settings, path, text, sha, appending=True)


async def dump(
    settings: Settings, text: str, day: date, sent: UUID | None = None
) -> NoteRead | None:
    """Add `text` as a paragraph at the end of the `## Dump` section of `day`'s note.

    The path is not the caller's to choose, and nothing already in the note is overwritten.
    `sent` is a phone's id, passed only by `POST /api/dump`: an id already written is a no-op.
    Receipts live in `dump-receipts.json` beside the token store. The paragraph is written first.
    """
    capture = text.strip()
    if capture == "":
        raise EmptyCaptureError(NOTHING)

    note = resolve_path(settings.vault_path, daily_path(day, settings.periodic_path))
    if note is None:
        return None

    relative = relative_path(settings.vault_path, note)
    store = settings.tokens_path.with_name("dump-receipts.json")
    async with vault_write():
        written = _receipts(store) if sent is not None else []
        # `is_file` because the note may have been deleted since, and a resend
        # then has nothing to hand back but a fresh note with the paragraph.
        if str(sent) in written and note.is_file():
            return _read(settings.vault_path, note)

        previous = note.read_bytes() if note.is_file() else None
        held = (
            daily_note(day, settings.periodic_path)
            if previous is None
            else previous.decode("utf-8")
        )
        content = _bounded(note, _write(relative, append_dump(held, capture), previous))

        async with vault_change(settings.vault_path, relative):
            if previous is None:
                create_note(note, content)
            else:
                write_note(note, content)

        if sent is not None and str(sent) not in written:
            # The paragraph has landed, so answer with the note whatever happens here.
            try:
                _receipt(store, [*written, str(sent)])
            except OSError:
                logger.exception("Could not record capture %s in %s", sent, store)

        return _read(settings.vault_path, note)
