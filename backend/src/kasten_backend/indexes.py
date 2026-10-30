"""The `index.md` in each folder, kept in step with what the folder holds.

`folders.py` writes a new folder's listing. This module carries a moved note's entry between
folders' indexes, and backfills folders that never got one. An entry is a bullet with a
markdown link; any text after the link is someone's description and travels with it.
"""

import posixpath
import re
from pathlib import Path

from kasten_backend.change import vault_change, vault_write
from kasten_backend.folders import INDEX, listing
from kasten_backend.frontmatter import reserved
from kasten_backend.links import MARKDOWN_LINK, markdown_target, relink_markdown
from kasten_backend.vault import write_note

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
        markdown_target(match.group(2), here, embed=match.group(1).startswith("!")) == path
        for match in MARKDOWN_LINK.finditer(line)
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

    None when the move stays in its folder, when the thing moving is an index or log, and when its
    old folder's index never listed it. An index is curated, so no entry is invented at the other
    end.
    """
    if posixpath.dirname(old) == posixpath.dirname(new) or reserved(old):
        return None
    return _index(posixpath.dirname(new)) if has_entry(root, old) else None


def rehome_entry(root: Path, old: str, new: str) -> None:
    """Move the entry for what moved from its old folder's index to the new one's.

    Run after the move and the link rewrite, so the old index already points at `new`. The entry is
    respelled from the new folder and written in. A new index is made from what the folder holds,
    which lists the moved thing: its plain line is dropped for the one with the description.
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
        relink_markdown(line, _index(here), _index(there), (new, new)).rstrip("\n") + "\n"
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

    Only the outermost has a parent left to hold an index, so a missing index is the common case,
    not a mistake.
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

    Hidden folders are not walked, which keeps `.trash` and the jj repo out, and the root is
    skipped as OKF makes its index optional. Not run at startup: a deleted index would come back on
    every boot.
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
    # Reached from a terminal, as the type backfill is. The vault is an argument, so the dev vault
    # and a container's both work.
    import asyncio
    import sys

    _, *given = sys.argv
    if len(given) != 1:
        sys.exit("usage: python -m kasten_backend.indexes <vault>")

    for written in asyncio.run(backfill(Path(given[0]))):
        print(written)
