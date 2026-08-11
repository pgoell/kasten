"""Taking a note out of the vault without losing it.

A delete moves the note into `.trash/` and leaves it there. Nothing under a
dot-directory is listed, searched, resolved from a URL or reported on
`/api/events`, so the vault stops holding the note the moment it moves, and the
text is still on disk for as long as the retention allows.

The trash mirrors the vault: a note keeps its path and its leaf takes the moment
it was deleted, `00 Inbox/borges.md@2026-08-11T14-03-02.481337`. That name is the whole
record. It says where the note came from, so a restore needs nothing else to put
it back, it says when it went, so the purge needs no timer file, and it cannot
collide with a note deleted from the same path a second time.

A deleted folder is one entry, not one per note under it, because a folder is
moved in one rename and comes back the same way.

jj holds the history either way, and that is not what this is for: the vault may
be a plain directory with no jj on the box, so getting a note back cannot need a
repo. What jj adds on top is free, since the move is a write like any other and
is recorded like one.
"""

import re
import shutil
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, NamedTuple

from kasten_backend.vault import prune_empty_folders, resolve_folder_path
from kasten_backend.vcs import begin_change, snapshot

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

TRASH = ".trash"
"""Where a deleted note waits, inside the vault.

Hidden, which is what makes it invisible to everything that reads the vault, and
inside, so one bind mount carries the notes and the way back to them.
"""

STAMP = "%Y-%m-%dT%H-%M-%S.%f"
"""How the moment is spelled in the name. UTC, the way the frontmatter is.

Dashes rather than colons in the time. A colon is legal on the filesystems
kasten runs on and a nuisance in every shell that has to name the file.

Down to the microsecond, unlike the frontmatter's seconds, because this is what
orders the list: two notes deleted in the same second are two rows, and
`<leader>u` takes the first of them. The dot is ISO 8601's own separator for
what follows the seconds.
"""

STAMPED = re.compile(r"@(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{6})$")
"""The stamp on the end of an entry's leaf, which is what makes it an entry.

Searched rather than matched, and anchored at the end, so a note called
`mail@work.md` keeps its name and is still told apart from what was deleted.
"""


class Entry(NamedTuple):
    """One thing in the trash: where it is now, where it was, and when it went."""

    entry: str
    """Its path under `.trash`, which is the name the API takes to restore it."""

    path: str
    """Where it lived in the vault, which is where a restore puts it back."""

    deleted: datetime


def _stamped(name: str) -> datetime | None:
    """The moment `name` says it was deleted, or None when it says none."""
    found = STAMPED.search(name)
    if found is None:
        return None

    return datetime.strptime(found.group(1), STAMP).replace(tzinfo=UTC)


def _walk(directory: Path, prefix: str) -> Iterator[Entry]:
    """Every entry at or under `directory`, which is `prefix` inside the trash.

    A stamped name is an entry and is not walked into: a deleted folder is one
    entry, and the notes under it went with it rather than on their own. An
    unstamped directory is a folder the trash kept to hold an entry's path, so
    it is walked. An unstamped file is not ours and is left alone.
    """
    for child in sorted(directory.iterdir()):
        when = _stamped(child.name)
        if when is not None:
            yield Entry(
                entry=f"{prefix}{child.name}",
                path=f"{prefix}{STAMPED.sub('', child.name)}",
                deleted=when,
            )
        elif child.is_dir():
            yield from _walk(child, f"{prefix}{child.name}/")


def list_trash(root: Path) -> list[Entry]:
    """Everything the trash holds, newest first.

    Newest first because the one thing anyone wants back is usually the last
    thing they deleted, and `<leader>u` takes the first row without asking.
    """
    trash = root / TRASH
    if not trash.is_dir():
        return []

    return sorted(_walk(trash, ""), key=lambda found: found.deleted, reverse=True)


def resolve_entry(root: Path, entry: str) -> Entry | None:
    """One entry the trash holds, read off its name, or None when it holds none.

    The entry arrives from a URL and is therefore hostile, so it goes through
    the vault's own rule for a legal location, read against the trash as the
    root: `..`, an absolute path and a link out of it are all refused there
    already. The folder spelling of that rule, because an entry is a note or a
    folder and this is the one that does not ask which.

    What comes back is the canonical spelling rather than the URL's, the way a
    note's is, so the path a restore writes to cannot be talked into a
    roundabout one.
    """
    path = resolve_folder_path(root / TRASH, entry)
    if path is None or not path.exists():
        return None

    when = _stamped(path.name)
    if when is None:
        return None

    inside = path.relative_to((root / TRASH).resolve()).as_posix()
    return Entry(entry=inside, path=STAMPED.sub("", inside), deleted=when)


def _move(source: Path, target: Path) -> None:
    """Move one path over to another, making the folders on the way.

    Sync, the way every other write in kasten is: a `Path` method blocks, and
    the calls that block belong outside the coroutines that would hold the loop
    while they ran.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)


def _remove(path: Path) -> None:
    """Delete one entry for good, note or folder alike. Sync, the way `_move` is."""
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


async def move_to_trash(
    root: Path, node: Path, relative: str, *, now: datetime | None = None
) -> Entry:
    """Move one note or folder out of the vault, and say where it went.

    The folder it emptied goes with it, the way a move's does: a folder here is
    the prefix of the notes under it and an empty one is a row nothing shows.

    Recorded as its own jj change, named after the entry rather than the note,
    so a delete never amends the change holding the edit before it.
    """
    when = now or datetime.now(UTC)
    entry = Entry(
        entry=f"{relative}@{when.strftime(STAMP)}",
        path=relative,
        deleted=when,
    )
    target = root / TRASH / entry.entry

    await begin_change(root, f"{TRASH}/{entry.entry}")
    _move(node, target)
    prune_empty_folders(root, node.parent)
    await snapshot(root)

    return entry


async def restore(root: Path, found: Entry) -> None:
    """Move one entry `resolve_entry` returned back where it was deleted from.

    The caller has already refused a path that is taken, and the folders on the
    way back are made here, because the delete took the empty ones with it.

    The trash folders the entry leaves behind go too, so the trash does not
    fill with directories holding nothing.
    """
    source = root / TRASH / found.entry

    await begin_change(root, found.path)
    _move(source, root / found.path)
    prune_empty_folders(root / TRASH, source.parent)
    await snapshot(root)


async def purge_trash(root: Path, days: int) -> None:
    """Drop what the trash has held for longer than `days`, and nothing else.

    This is the one place in kasten that removes a note for good, and it runs at
    startup rather than on a timer: a delete is the moment the trash grows, and
    a process that has not restarted for a month is not a reason to hold the
    event loop for a scan nobody asked for.

    ponytail: the trash therefore keeps a little longer than the setting says on
    a long-running process. Move it onto the delete path if that ever matters.
    """
    trash = root / TRASH
    cutoff = datetime.now(UTC) - timedelta(days=days)
    expired = [found for found in list_trash(root) if found.deleted < cutoff]
    if not expired:
        return

    await begin_change(root, TRASH)
    for found in expired:
        path = trash / found.entry
        _remove(path)
        prune_empty_folders(trash, path.parent)
    await snapshot(root)
