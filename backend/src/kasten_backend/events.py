"""Telling open editors that the vault changed under them.

The vault is the source of truth, so a note written by anything else, an agent,
an ssh session, a sync, is as real as one written through the API. This watches
the directory and says what moved, and nothing here knows about HTTP.
"""

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from watchfiles import Change

from kasten_backend.vault import SUFFIX

ChangeKind = Literal["written", "added", "removed"]
"""What happened to a note, in the client's words rather than watchfiles'."""

_KINDS: dict[Change, ChangeKind] = {
    Change.added: "added",
    Change.modified: "written",
    Change.deleted: "removed",
}


@dataclass(frozen=True, slots=True)
class VaultEvent:
    """One note the vault says changed."""

    path: str
    """Where the note lives, relative to the vault root, POSIX spelling."""

    change: ChangeKind

    digest: str | None
    """sha256 of the text now on disk, or None when there is no text left.

    The note itself does not travel: a client that wants the new content asks
    for it. The digest is here so a client can tell its own write coming back
    from someone else's, and refetch only for the second.
    """


def is_watchable(root: Path, changed: str) -> bool:
    """Whether a path watchfiles reported is a note the vault would list.

    The listing's rules, read for one path: markdown, under the root, and
    nothing hidden anywhere along the way. The hidden rule is what keeps the
    vault's colocated jj repo quiet, and it has to be the same rule
    `list_markdown_files` applies or the watcher would report notes the tree
    never shows.

    `is_relative_to` rather than a `resolve` on each change: this runs once per
    changed path and the caller watches an already resolved root.
    """
    path = Path(changed)
    if path.suffix != SUFFIX or not path.is_relative_to(root):
        return False

    return not any(part.startswith(".") for part in path.relative_to(root).parts)


def _digest(note: Path) -> str | None:
    """sha256 of what the note holds, or None when the note is no longer there."""
    try:
        return hashlib.sha256(note.read_bytes()).hexdigest()
    except FileNotFoundError:
        return None


def to_events(root: Path, changes: set[tuple[Change, str]]) -> list[VaultEvent]:
    """Turn one batch of watchfiles changes into what the client is told.

    Sorted by path, because a set has no order and two runs over the same batch
    have to read the same.

    A note that is gone by the time this reads it is a removal whatever
    watchfiles called the change. Halfway through a move the old path fires as
    modified and is already at its new name, and that race is normal rather than
    an error.
    """
    events = []

    for change, changed in sorted(changes, key=lambda pair: pair[1]):
        if not is_watchable(root, changed):
            continue

        note = Path(changed)
        digest = None if change is Change.deleted else _digest(note)
        events.append(
            VaultEvent(
                path=note.relative_to(root).as_posix(),
                change="removed" if digest is None else _KINDS[change],
                digest=digest,
            )
        )

    return events


def format_sse(event: VaultEvent) -> str:
    """Write one event as a server-sent event.

    A blank line ends the message, which is what the wire format says and what
    tells `EventSource` the payload is whole. The JSON holds no newline of its
    own, so one `data:` line carries all of it.
    """
    return f"data: {json.dumps(asdict(event))}\n\n"
