"""The date and the tags of each note a search hit is in, read once per note.

The search histogram counts matching lines per ISO week, so each hit needs the
day its note counts on. A line's own date would take a `jj annotate` of every
note on every query, so the note's date stands for its lines instead. It comes
from the name when the name is dated, then from the block's `created`, which is
when the note was written, then from the file's modification time.

A dated name gives its calendar day, which needs no zone. The other two give an
instant with its offset, because `created` is written in UTC and the day it
falls on depends on whose clock reads it: a note written at 00:30 in Berlin is
the day before in UTC. The client reads the instant in the reader's own zone.
"""

import asyncio
import re
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

from kasten_backend import frontmatter, todos
from kasten_backend.tags import field_tags
from kasten_backend.vault import read_note

if TYPE_CHECKING:
    from pathlib import Path

_SHAPE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
"""The spelling of a date. Whether it is a real one is `fromisoformat`'s to say."""


def _as_date(text: str) -> date | None:
    """The date `text` spells as `YYYY-MM-DD`, or None when it spells none.

    Shape first, because `date.fromisoformat` also reads `2026-W41-3`, and a
    `created` that said so would be a week's worth of noise rather than a day.
    """
    if not _SHAPE.fullmatch(text):
        return None

    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


_INSTANT = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}"
    r"(:[0-9]{2}(\.[0-9]{3})?)?"
    r"(Z|[+-][0-9]{2}:[0-9]{2})?"
)
"""The instants a browser's `new Date` reads, which are the ones `created` may pass through as.

A week date such as `2026-W43-1T10:00:00+00:00` parses in Python and reads as
nothing in a browser, so the shape is what decides, and `fromisoformat` only
checks the numbers are a real time.
"""


def _created(text: str) -> str | None:
    """The block's `created` as written, when a browser can read it as a day or a time.

    With no offset it is the reader's own local time, which is what an imported
    note means by it. Anything else falls through to the file's own time.
    """
    value = frontmatter.created(text)
    if value is None:
        return None
    if _as_date(value) is not None:
        return value
    if not _INSTANT.fullmatch(value):
        return None
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return None
    return value


def day_of(root: Path, path: str, text: str | None) -> str | None:
    """The date a note counts on, as ISO 8601: its name's day, else `created`, else mtime.

    Public because the written route counts notes on the same day, and a second
    copy of this rule would drift from the one search dates its hits by.
    """
    named = _as_date(path.rsplit("/", 1)[-1][:10])
    if named is not None:
        return named.isoformat()
    if text is not None:
        created = _created(text)
        if created is not None:
            return created
    try:
        moment = (root / path).stat().st_mtime
    except OSError:
        # The note went between the search and this, so no date is the answer.
        return None
    return datetime.fromtimestamp(moment, UTC).isoformat(timespec="seconds")


def tags_of(text: str) -> list[str]:
    """The note's tags with their hashes, sorted, read the way the tags route reads them.

    Public so the written notes take their tags off the one read of a note they
    already make, rather than through a second parse of the whole vault.
    """
    found = {text[start:end] for start, end in todos.tags_in(text)} | field_tags(text)
    return sorted(found)


_held: dict[str, tuple[int, int, list[str]]] = {}
"""The tags each note was last parsed to, with the stamp it had then, by absolute path.

One entry per note the written notes or a search have read. The written notes
prune it to the live notes outside the archive on each read, so it holds at most
the vault and the notes gone since that read; a search only adds, because its
hits are not the whole vault. Parsing a note holding `<!--`
takes the slow path through `code_spans`, which is most of a flashcard note's
cost. An edit changes the file's modification time or its size, so an entry whose
stamp no longer matches is parsed again and never served.
"""


def stamp(root: Path, path: str) -> tuple[int, int] | None:
    """The modification time in nanoseconds and the size of a note, or None when it is gone."""
    try:
        status = (root / path).stat()
    except OSError:
        # The note went between the list and this, so there is nothing to keep.
        return None
    return status.st_mtime_ns, status.st_size


def cached_tags(root: Path, path: str, text: str, moment: tuple[int, int] | None) -> list[str]:
    """The tags of a note whose text is `text`, from the cache while its stamp `moment` holds."""
    if moment is None:
        return tags_of(text)
    key = str(root / path)
    held = _held.get(key)
    if held is not None and (held[0], held[1]) == moment:
        return list(held[2])
    tags = tags_of(text)
    _held[key] = (moment[0], moment[1], tags)
    return tags


def forget_except(root: Path, paths: list[str]) -> None:
    """Drop the cached tags of every note not in `paths`, so the cache holds only live notes."""
    live = {str(root / path) for path in paths}
    for key in list(_held):
        if key not in live:
            _held.pop(key, None)


def _read_all(root: Path, paths: list[str]) -> dict[str, tuple[str | None, list[str] | None]]:
    meta: dict[str, tuple[str | None, list[str] | None]] = {}
    for path in paths:
        # Stamped before the read, as the written notes do: an edit in between is then
        # seen as a change on the next search rather than kept under the new stamp.
        moment = stamp(root, path)
        try:
            text = read_note(root, path)
        except UnicodeDecodeError, OSError:
            # A note the client cannot open is still dated by its name and its file.
            text = None
        day = day_of(root, path, text)
        meta[path] = (day, None if text is None else cached_tags(root, path, text, moment))
    return meta


async def notes_meta(
    root: Path, paths: list[str]
) -> dict[str, tuple[str | None, list[str] | None]]:
    """The date and tags of each note in `paths`, keyed by path, each note read once.

    Read in a thread, because a note is read whole to find its tags and the event
    loop should not wait on the disk for it.
    """
    return await asyncio.to_thread(_read_all, root, sorted(set(paths)))
