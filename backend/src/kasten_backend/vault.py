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


def _resolve_note(root: Path, relative: str) -> Path | None:
    """Return the real path of one note under `root`, or None when there is none.

    `relative` arrives from the URL and is therefore hostile. Both sides are
    resolved before they are compared, so `..`, an absolute path and a symlink
    pointing out of the vault all land outside `root` and are refused. Anything
    the listing would not show is refused too, so the tree and this function
    agree on what a note is.

    Reading and writing share this, because two copies of these rules would
    drift and the looser copy would be the write.
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

    return path


def read_note(root: Path, relative: str) -> str | None:
    """Return the text of one note under `root`, or None when there is no such note.

    Every refusal reads as absent. Telling a typo apart from an attempt to climb
    out is worth nothing to the one user and something to everyone else.
    """
    path = _resolve_note(root, relative)
    if path is None:
        return None

    return path.read_text(encoding="utf-8")


def write_note(root: Path, relative: str, content: str) -> bool:
    """Write `content` over an existing note, reporting whether there was one.

    Only a note that is already there can be written. Creating notes is a
    separate job with its own way in, and without that rule a typo in a path
    would quietly leave a new file in the vault.

    The text goes to a temp file next to the target and is then renamed over
    it, so a crash halfway through leaves the old note whole rather than half a
    new one. Same directory, so the rename is atomic. The temp name is hidden
    and does not end in `.md`, which keeps a leftover out of the listing twice
    over.

    `newline=""` because the vault is the source of truth: the bytes that
    arrived are the bytes on disk.
    """
    path = _resolve_note(root, relative)
    if path is None:
        return False

    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8", newline="")
    temporary.replace(path)

    return True
