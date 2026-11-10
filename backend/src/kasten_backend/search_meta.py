"""The date and the tags of each note a search hit is in, read once per note.

A hit takes its note's day, since a line's own date would need a `jj annotate` per query.
The day is the name's date, else `created`, else the file's mtime. An instant keeps its
offset, because the day it falls on depends on the reader's zone.
"""

import asyncio
import os
import re
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

from kasten_backend import frontmatter, tags
from kasten_backend.vault import Stamp, held_fact, read_note, stamp_of

if TYPE_CHECKING:
    from pathlib import Path

_SHAPE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
"""The spelling of a date. Whether it is a real one is `fromisoformat`'s to say."""


def _as_date(text: str) -> date | None:
    """The date `text` spells as `YYYY-MM-DD`, or None when it spells none.

    Shape first: `date.fromisoformat` also reads `2026-W41-3`, a week, not a day.
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
"""The instants a browser's `new Date` reads, which `created` may pass through as.

The shape decides, since `fromisoformat` also takes week dates a browser cannot read.
"""


def _created(text: str) -> str | None:
    """The block's `created` as written, when a browser can read it as a day or a time.

    Anything else falls through to the file's own time.
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

    Public so the written route uses this rule, not a copy that could drift.
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


def stamp(root: Path, path: str) -> Stamp | None:
    """The note's stamp, or None when it is a link or gone."""
    try:
        return stamp_of(os.lstat(root / path))
    except OSError:
        # The note went between the list and this, so there is nothing to keep.
        return None


def cached_tags(root: Path, path: str, text: str, moment: Stamp | None) -> list[str]:
    """The tags of a note whose text is `text`, from the tags route's cache while `moment` holds.

    Caching matters because a note holding `<!--` is slow to parse (#1238).
    """
    return sorted(held_fact(root, "tags", path, moment, lambda: frozenset(tags.tags_of(text))))


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
