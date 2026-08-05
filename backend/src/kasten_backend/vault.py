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
