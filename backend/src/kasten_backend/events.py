"""Telling open editors that the vault changed under them.

A note written by anything else, an agent, an ssh session or a sync, is as real as one
written through the API. This module watches the directory and says what moved.
"""

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from watchfiles import Change, awatch

from kasten_backend.vault import HTML_SUFFIX, SUFFIX

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

DEBOUNCE_MS = 100
"""How long watchfiles gathers changes before handing over a batch.

An agent rewriting forty notes then costs a handful of messages, not forty. Well under the
editor's quiet period, so a note the user is not typing in reloads before its next autosave.
"""

ChangeKind = Literal["written", "removed", "listing", "page"]
"""What happened, in the client's words rather than watchfiles'.

Four kinds, with no fifth for a new note: a save's rename reads as an addition, so a note
held for weeks would arrive as new on every save. `page` is an html page the pane shows,
and rides beside the `listing` its write sends.
"""


@dataclass(frozen=True, slots=True)
class VaultEvent:
    """One thing the vault says happened."""

    path: str
    """Where the note lives, relative to the vault root, POSIX spelling.

    Empty on a `listing`, which names no note.
    """

    change: ChangeKind

    digest: str | None
    """sha256 of the text now on disk, or None when there is no text to read.

    The note itself does not travel. The digest lets a client tell its own write coming back
    from someone else's.
    """


def is_inside(root: Path, changed: str) -> bool:
    """Whether a path watchfiles reported is part of the vault at all.

    Under the root, with nothing hidden along the way, as `list_markdown_files` walks it. A
    change in the colocated `.jj` must never reach the client, since every write kasten makes
    touches it. The root is already resolved, so nothing here resolves.
    """
    path = Path(changed)
    return path.is_relative_to(root) and not any(
        part.startswith(".") for part in path.relative_to(root).parts
    )


def is_watchable(root: Path, changed: str) -> bool:
    """Whether a path watchfiles reported is a note the vault would list.

    What `is_inside` says, plus the markdown suffix. A directory is refused whatever it is
    named, as the listing does, so a folder called `notes.md` never reads as a note.
    `is_dir` rather than `is_file`: a removal names a path already gone, and must stay reportable.
    """
    path = Path(changed)
    return path.suffix == SUFFIX and is_inside(root, changed) and not path.is_dir()


def _digest(note: Path) -> str | None:
    """sha256 of what the note holds, or None when it cannot be read.

    Gone is the ordinary case: halfway through a move the old path fires. Unreadable and absent
    look alike from the far end, so both answer None. An exception here would end the stream for
    good, in the middle of a response.
    """
    try:
        return hashlib.sha256(note.read_bytes()).hexdigest()
    except OSError:
        return None


def to_events(root: Path, changes: set[tuple[Change, str]]) -> list[VaultEvent]:
    """Turn one batch of watchfiles changes into what the client is told.

    One event per note, however many times the batch names it: a save's temp file fires a
    delete and an add, and those must collapse. A note that will not open is a removal, whatever
    fired. Anything else changed adds one `listing`, first, since a folder move names no notes.
    """
    inside = {changed for _change, changed in changes if is_inside(root, changed)}
    notes = {changed for changed in inside if is_watchable(root, changed)}
    pages = {
        changed
        for changed in inside - notes
        if Path(changed).suffix.lower() == HTML_SUFFIX and not Path(changed).is_dir()
    }

    events = []

    if inside - notes:
        events.append(VaultEvent(path="", change="listing", digest=None))

    for changed in sorted(notes):
        note = Path(changed)
        digest = _digest(note)
        events.append(
            VaultEvent(
                path=note.relative_to(root).as_posix(),
                change="removed" if digest is None else "written",
                digest=digest,
            )
        )

    for changed in sorted(pages):
        page = Path(changed)
        digest = _digest(page)
        if digest is not None:
            events.append(
                VaultEvent(path=page.relative_to(root).as_posix(), change="page", digest=digest)
            )

    return events


KEEPALIVE = ": \n\n"
"""A line that says nothing, for a stream with nothing to say.

A comment on the wire, which `EventSource` drops silently. It proves the socket is still there.
"""


def format_sse(event: VaultEvent) -> str:
    """Write one event as a server-sent event.

    The blank line ends the message. The JSON has no newline, so one `data:` line carries it all.
    """
    return f"data: {json.dumps(asdict(event))}\n\n"


def format_retry(seconds: float) -> str:
    """Tell the client how long to wait before it opens the stream again.

    Sent first, since a stream that closes at once is the one that needs it. `EventSource`
    keeps the number for the life of the page. Milliseconds on the wire, seconds in the caller,
    so the conversion lives here.
    """
    return f"retry: {round(seconds * 1000)}\n\n"


def _watched_root(root: Path) -> Path | None:
    """The vault's real path, or None when there is no directory there.

    Resolved because watchfiles reports resolved paths, and behind a symlinked vault every change
    would read as coming from outside. The two stats block the loop, but only at connect time.
    """
    base = root.resolve()
    return base if base.is_dir() else None


async def watch_vault(root: Path) -> AsyncIterator[list[VaultEvent]]:
    """Yield a batch of events every time the vault changes, forever.

    One watcher per caller, costing nothing while nobody is connected. The filter is `is_inside`,
    not `is_watchable`, since a folder move names only a directory. A missing vault yields
    nothing, because `awatch` raises on a missing path.
    """
    base = _watched_root(root)
    if base is None:
        return

    async for changes in awatch(
        base,
        debounce=DEBOUNCE_MS,
        watch_filter=lambda _change, changed: is_inside(base, changed),
    ):
        events = to_events(base, changes)
        if events:
            yield events
