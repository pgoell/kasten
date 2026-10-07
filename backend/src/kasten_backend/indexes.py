"""The `index.md` in each folder, kept in step with what the folder holds.

A folder kasten makes gets a listing the moment it is made, which `vault.py`
writes. What lives here is the rest: carrying a note's entry from one folder's
index to another's when the note moves between them, and giving every folder
already in the vault the listing it never got.

An entry is a bullet holding a markdown link, the shape the index guide asks
for. Whatever follows the link on that line is a description someone wrote, and
it travels with the entry.
"""

import posixpath
import re
from pathlib import Path

from kasten_backend.change import vault_change, vault_write
from kasten_backend.frontmatter import reserved
from kasten_backend.links import MARKDOWN_LINK, markdown_target, relink_markdown
from kasten_backend.vault import INDEX, listing, write_note

BACKFILL_LABEL = "index backfill"
"""What the backfill calls its jj change, in the slot a note's path usually fills."""

ENTRY = re.compile(r"^\s*[-*+]\s")
"""The start of a bullet, which is what an index line has to be to be an entry."""


def _index(parent: str) -> str:
    """The vault path of the index for folder `parent`, `""` being the vault root."""
    return posixpath.join(parent, INDEX)


def _names(line: str, here: str, path: str) -> bool:
    """Whether `line`, in an index in folder `here`, is an entry for `path`."""
    return ENTRY.match(line) is not None and any(
        markdown_target(match.group(2), here) == path for match in MARKDOWN_LINK.finditer(line)
    )


def has_entry(root: Path, path: str) -> bool:
    """Whether the index in `path`'s folder holds an entry for it."""
    parent = posixpath.dirname(path)
    index = root / _index(parent)
    if not index.is_file():
        return False
    lines = index.read_text(encoding="utf-8").splitlines()
    return any(_names(line, parent, path) for line in lines)


def carries(root: Path, old: str, new: str) -> str | None:
    """The index a move of `old` to `new` adds an entry to, or None when it adds none.

    None when the move stays in its folder, when the thing moving is an index or
    a log itself, and when its old folder's index never listed it: an index is
    curated, and an entry nobody wrote is not one to invent at the other end.
    """
    if posixpath.dirname(old) == posixpath.dirname(new) or reserved(old):
        return None
    return _index(posixpath.dirname(new)) if has_entry(root, old) else None


def rehome_entry(root: Path, old: str, new: str) -> None:
    """Take the entry for what moved out of its old folder's index and put it in the new one's.

    Run after the move and after the links were rewritten, so the entry in the
    old index already points at `new`, from the wrong folder. It is cut there,
    respelled from the new folder and written in. The new folder's index is
    made if it has none, from what the folder holds now, which includes the
    thing that moved, so its plain line is dropped for the one that carries a
    description rather than listed twice.
    """
    if posixpath.dirname(old) == posixpath.dirname(new) or reserved(old):
        return

    here = posixpath.dirname(old)
    there = posixpath.dirname(new)
    source = root / _index(here)
    if not source.is_file():
        return

    lines = source.read_text(encoding="utf-8").splitlines(keepends=True)
    carried = [line for line in lines if _names(line, here, new)]
    if not carried:
        return
    write_note(source, "".join(line for line in lines if line not in carried))

    moved = [
        relink_markdown(line, _index(here), _index(there), new, new).rstrip("\n") + "\n"
        for line in carried
    ]
    target = root / _index(there)
    text = target.read_text(encoding="utf-8") if target.is_file() else listing(target.parent)
    kept = [line for line in text.splitlines(keepends=True) if not _names(line, there, new)]
    if kept and not kept[-1].endswith("\n"):
        kept[-1] += "\n"
    kept.extend(moved)
    write_note(target, "".join(kept))


def drop_entries(root: Path, folders: list[Path]) -> None:
    """Take the entry for each of `folders`, which a move emptied, out of its parent's index.

    Only the outermost one has a parent left to hold an index; the rest went
    with it, so a missing index is the common case and not a mistake.
    """
    base = root.resolve()
    for folder in folders:
        path = folder.relative_to(base).as_posix()
        here = posixpath.dirname(path)
        index = base / _index(here)
        if not index.is_file():
            continue
        lines = index.read_text(encoding="utf-8").splitlines(keepends=True)
        kept = [line for line in lines if not _names(line, here, path)]
        if kept != lines:
            write_note(index, "".join(kept))


async def backfill(root: Path) -> list[str]:
    """Give every folder in the vault that has no `index.md` one. Returns what was written.

    Hidden folders are skipped without being walked into, which keeps `.trash`
    and the jj repo out, and the vault root is skipped because OKF makes its
    index optional. One jj change for the pass, and none when nothing needed one.

    Not run at startup. A folder whose index you deleted would get it back on
    every boot, and that would make deleting one impossible.
    """
    async with vault_write():
        missing = _unlisted(root)
        if not missing:
            return []

        async with vault_change(root, BACKFILL_LABEL):
            return _write_listings(root, missing)


def _unlisted(root: Path) -> list[Path]:
    """Every folder under `root`, not hidden and not `root`, that holds no `index.md`."""
    base = root.resolve()
    missing = []
    for folder, folders, _ in base.walk():
        folders[:] = [name for name in folders if not name.startswith(".")]
        if folder != base and not (folder / INDEX).exists():
            missing.append(folder)
    return missing


def _write_listings(root: Path, folders: list[Path]) -> list[str]:
    """Write a listing into each of `folders`, and answer with the vault paths written."""
    base = root.resolve()
    for folder in folders:
        (folder / INDEX).write_text(listing(folder), encoding="utf-8")
    return [(folder / INDEX).relative_to(base).as_posix() for folder in folders]


if __name__ == "__main__":
    # The one implementation, reached from a terminal, the way the type backfill
    # is. The vault is an argument, so this reaches the dev vault and a
    # container's alike.
    import asyncio
    import sys

    _, *given = sys.argv
    if len(given) != 1:
        sys.exit("usage: python -m kasten_backend.indexes <vault>")

    for written in asyncio.run(backfill(Path(given[0]))):
        print(written)
