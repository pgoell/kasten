"""Reading the markdown vault off disk.

The vault is the source of truth, so everything here goes straight to the
filesystem. Postgres holds a derived index and never answers these questions.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path


def list_markdown_files(root: Path) -> list[str]:
    """Return every markdown file under `root`, as sorted relative POSIX paths.

    Hidden files and directories are skipped, which keeps `.git` and editor
    dotfiles out of the tree. A vault directory that does not exist reads as an
    empty one, so a fresh checkout still serves.
    """
    if not root.is_dir():
        return []

    found = []
    for path in root.rglob("*.md"):
        relative = path.relative_to(root)
        if any(part.startswith(".") for part in relative.parts):
            continue
        found.append(relative.as_posix())

    return sorted(found)


def read_note(root: Path, relative: str) -> str | None:
    """Return the text of one note under `root`, or None when there is no such note.

    `relative` arrives from the URL and is therefore hostile. Both sides are
    resolved before they are compared, so `..`, an absolute path and a symlink
    pointing out of the vault all land outside `root` and are refused. Anything
    the listing would not show is refused too, so the tree and this function
    agree on what a note is.

    Every refusal reads as absent. Telling a typo apart from an attempt to climb
    out is worth nothing to the one user and something to everyone else.
    """
    # Checked before anything touches the filesystem, because an embedded null
    # makes every call raise rather than return.
    if "\0" in relative:
        return None

    base = root.resolve()
    path = (base / relative).resolve()

    if not path.is_relative_to(base):
        return None

    parts = path.relative_to(base).parts
    if not parts or path.suffix != ".md":
        return None
    if any(part.startswith(".") for part in parts):
        return None
    if not path.is_file():
        return None

    return path.read_text(encoding="utf-8")
