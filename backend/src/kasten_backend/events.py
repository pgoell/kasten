"""Telling open editors that the vault changed under them.

The vault is the source of truth, so a note written by anything else, an agent,
an ssh session, a sync, is as real as one written through the API. This watches
the directory and says what moved, and nothing here knows about HTTP.
"""

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from watchfiles import Change, awatch

from kasten_backend.vault import SUFFIX

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

DEBOUNCE_MS = 100
"""How long watchfiles gathers changes before handing over a batch.

An agent rewriting forty notes then costs a handful of messages rather than
forty. Well under the editor's quiet period, so a note the user is not typing
into reloads before the next autosave would have fired.
"""

ChangeKind = Literal["written", "removed", "listing"]
"""What happened, in the client's words rather than watchfiles'.

Three kinds, and no fourth for a note that is new. Told apart from a write it
would be a lie: a save renames a temp file over the note, Linux reports a move
into place, and watchfiles calls that an addition, so a note kasten has held for
weeks would arrive as new on every save. Whether a note is new is a question
about what the client already holds, and the client holds the file list to
answer it with.
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

    The note itself does not travel: a client that wants the new content asks
    for it. The digest is here so a client can tell its own write coming back
    from someone else's, and refetch only for the second.
    """


def is_inside(root: Path, changed: str) -> bool:
    """Whether a path watchfiles reported is part of the vault at all.

    Under the root, with nothing hidden along the way, which is the rule
    `list_markdown_files` walks by. Everything the client hears about passes
    this first, notes and the listing signal alike, and that is what keeps the
    colocated jj repo quiet: every write kasten makes touches `.jj`, and a
    change in there must reach the client in no shape whatever.

    `is_relative_to` rather than a `resolve` on each change: this runs once per
    changed path and the caller watches an already resolved root.
    """
    path = Path(changed)
    return path.is_relative_to(root) and not any(
        part.startswith(".") for part in path.relative_to(root).parts
    )


def is_watchable(root: Path, changed: str) -> bool:
    """Whether a path watchfiles reported is a note the vault would list.

    What `is_inside` says, and markdown on top of it, which is the one rule a
    folder does not share. A path this refuses but `is_inside` allows is what
    asks the client for a new file listing.

    A directory is refused whatever it is called, which is the rule the listing
    reaches by walking directories rather than matching their names, and the one
    `resolve_note` spells out. A folder called `notes.md` fires changes like
    anything else, and reading one as a note raises rather than returns.
    `is_dir` and not `is_file`, because a removal names a path that is already
    gone and has to stay reportable.

    The suffix is asked first, so only a markdown path inside the vault costs
    the syscall that `is_dir` is.
    """
    path = Path(changed)
    return path.suffix == SUFFIX and is_inside(root, changed) and not path.is_dir()


def _digest(note: Path) -> str | None:
    """sha256 of what the note holds, or None when it cannot be read.

    Gone is the ordinary case and not an error: halfway through a move the old
    path fires and is already at its new name. A note that is there but will not
    open answers the same, because unreadable and absent look alike from the far
    end of the stream, and both beat the alternative. An exception raised here
    escapes into a response that is already on its way, which ends the stream
    for good and explains itself to nobody.
    """
    try:
        return hashlib.sha256(note.read_bytes()).hexdigest()
    except OSError:
        return None


def to_events(root: Path, changes: set[tuple[Change, str]]) -> list[VaultEvent]:
    """Turn one batch of watchfiles changes into what the client is told.

    One event per note, however many times the batch names it. A note made and
    then written inside one window fires twice, and a save through a temp file
    fires a delete and an add, which is the one that has to collapse rather than
    merely being tidier: reported separately, the order the set happened to hand
    them over in would decide, and a removal arriving last would take a note
    that is on disk out of the client's tree.

    Which leaves the disk to say what happened, not watchfiles. A note that will
    not open is a removal whatever fired, so the old path of a move reads as one,
    and a note that opens is a write. Whether that write made the note is not
    asked, because the answer here would be wrong: see `ChangeKind`.

    Anything else the vault holds gets one `listing` between the lot of them,
    which is how a folder move is reported at all. `rename_folder` is a single
    rename, so the notes under it never fire: inotify names the directory and
    stops. One per batch and not one per path, because the client has one file
    list to read whatever moved.

    The listing comes first, and its empty path is what sorts it there: the
    shape of the vault is what the note paths below are spelled against, so a
    client that reads in order learns where things are before it is told what
    changed inside them.

    Notes sorted by path, because a set has no order and two clients reading one
    batch have to be told the same story.
    """
    inside = {changed for _change, changed in changes if is_inside(root, changed)}
    notes = {changed for changed in inside if is_watchable(root, changed)}

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

    return events


KEEPALIVE = ": \n\n"
"""A line that says nothing, for a stream with nothing to say.

A comment on the wire, which the format defines and `EventSource` drops without
telling anyone. Written to prove the socket is still there; when to write it is
the route's business, not the watcher's.
"""


def format_sse(event: VaultEvent) -> str:
    """Write one event as a server-sent event.

    A blank line ends the message, which is what the wire format says and what
    tells `EventSource` the payload is whole. The JSON holds no newline of its
    own, so one `data:` line carries all of it.
    """
    return f"data: {json.dumps(asdict(event))}\n\n"


def _watched_root(root: Path) -> Path | None:
    """The vault's real path, or None when there is no directory there.

    Resolved because watchfiles reports resolved paths and `is_relative_to`
    compares them as text: behind a symlinked vault every change would otherwise
    read as coming from outside.

    Both calls block the event loop, and moving them into a function of their
    own does not change that. It is where ruff stops asking, which is honest
    enough for two stats at connect time and no answer at all for `to_events`,
    which reads every changed note in the loop. That one is bounded by what a
    single debounce window can hold, and the vault is local disk.
    """
    base = root.resolve()
    return base if base.is_dir() else None


async def watch_vault(root: Path) -> AsyncIterator[list[VaultEvent]]:
    """Yield a batch of events every time the vault changes, forever.

    One watcher per caller rather than one for the process. A watcher costs
    nothing while nobody is connected, and this way the root comes in as an
    argument, which is what keeps the caller free to inject it.

    The filter is `is_inside` and not `is_watchable`, because a folder move
    names a directory and nothing else, and refusing directories here would
    leave the batch empty and the move unreported. watchfiles runs the filter
    over each raw batch once its own thread hands one back, in Python and after
    the fact, and yields nothing when that leaves the batch empty. So a window
    holding only jj's own writes never wakes the loop below, though the thread
    did the work of collecting them. `to_events` sorts notes from the rest, and
    filters again because it has to be right on its own.

    A vault that is not there reads as one nothing ever happens in, matching
    the listing. `awatch` raises on a missing path, and a fresh checkout must
    not take the endpoint down with it. One deleted after this point stops
    reporting until the client opens the stream again.
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
