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


def _created(text: str) -> str | None:
    """The block's `created` as written, when it is a day or an instant with an offset.

    A naive timestamp has no zone to read it in, so it counts for nothing and the
    file's own time stands in for it.
    """
    value = frontmatter.created(text)
    if value is None:
        return None
    if _as_date(value) is not None:
        return value
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return value if moment.tzinfo is not None else None


def _day(root: Path, path: str, text: str | None) -> str | None:
    """The date a note counts on, as ISO 8601: its name's day, else `created`, else mtime."""
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


def _tags(text: str) -> list[str]:
    """The note's tags with their hashes, sorted, read the way the tags route reads them."""
    found = {text[start:end] for start, end in todos.tags_in(text)} | field_tags(text)
    return sorted(found)


def _read_all(root: Path, paths: list[str]) -> dict[str, tuple[str | None, list[str] | None]]:
    meta: dict[str, tuple[str | None, list[str] | None]] = {}
    for path in paths:
        try:
            text = read_note(root, path)
        except UnicodeDecodeError, OSError:
            # A note the client cannot open is still dated by its name and its file.
            text = None
        day = _day(root, path, text)
        meta[path] = (day, None if text is None else _tags(text))
    return meta


async def notes_meta(
    root: Path, paths: list[str]
) -> dict[str, tuple[str | None, list[str] | None]]:
    """The date and tags of each note in `paths`, keyed by path, each note read once.

    Read in a thread, because a note is read whole to find its tags and the event
    loop should not wait on the disk for it.
    """
    return await asyncio.to_thread(_read_all, root, sorted(set(paths)))
