"""Taking a note out of the vault without losing it.

A delete moves the note to `.trash/`, a dot-directory nothing lists. Its leaf takes the
moment it was deleted, so the name says where to restore to and when it went. A folder
is one entry, not one per note under it.
"""

import re
import shutil
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, NamedTuple

from kasten_backend.change import vault_change, vault_write
from kasten_backend.folders import prune_empty_folders
from kasten_backend.vault import resolve_folder_path

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

Dashes, not colons: a colon is legal here but a nuisance in every shell. Down to the
microsecond, since this orders the list and `<leader>u` takes the first row.
"""

STAMPED = re.compile(r"@(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{6})$")
"""The stamp on the end of an entry's leaf, which is what makes it an entry.

Anchored at the end, so a note called `mail@work.md` is still told apart from a delete.
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

    A stamped name is an entry and is not walked into, so a deleted folder counts once.
    An unstamped directory holds an entry's path and is walked; an unstamped file is left alone.
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

    `<leader>u` takes the first row, so the last thing deleted is the one to find.
    """
    trash = root / TRASH
    if not trash.is_dir():
        return []

    return sorted(_walk(trash, ""), key=lambda found: found.deleted, reverse=True)


def resolve_entry(root: Path, entry: str) -> Entry | None:
    """One entry the trash holds, read off its name, or None when it holds none.

    The entry comes from a URL, so it is resolved as a legal location inside the trash. The
    result is the canonical spelling, so a restore cannot be talked into a roundabout path.
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
    """Move one path over to another, making the folders on the way. Sync, as writes are.

    Calls that block belong outside the coroutines, so they never hold the event loop.
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

    The folder it emptied goes too, since an empty folder is a row nothing shows. The
    jj change is named after the entry, so a delete never amends the change before it.
    """
    when = now or datetime.now(UTC)
    entry = Entry(
        entry=f"{relative}@{when.strftime(STAMP)}",
        path=relative,
        deleted=when,
    )
    target = root / TRASH / entry.entry

    async with vault_change(root, f"{TRASH}/{entry.entry}"):
        _move(node, target)
        prune_empty_folders(root, node.parent)

    return entry


async def restore(root: Path, found: Entry) -> None:
    """Move one entry `resolve_entry` returned back where it was deleted from.

    The caller refuses a taken path. Folders on the way back are made here, and the trash
    folders the entry leaves are pruned, so the trash does not fill with empty directories.
    """
    source = root / TRASH / found.entry

    async with vault_change(root, found.path):
        _move(source, root / found.path)
        prune_empty_folders(root / TRASH, source.parent)


async def purge_trash(root: Path, days: int) -> None:
    """Drop what the trash has held for longer than `days`, and nothing else.

    The one place kasten removes a note for good, run at startup, not on a timer.
    ponytail: a long-running process keeps its trash a little longer than the setting says.
    """
    trash = root / TRASH
    cutoff = datetime.now(UTC) - timedelta(days=days)
    async with vault_write():
        expired = [found for found in list_trash(root) if found.deleted < cutoff]
        if not expired:
            return

        async with vault_change(root, TRASH):
            for found in expired:
                path = trash / found.entry
                _remove(path)
                prune_empty_folders(trash, path.parent)
