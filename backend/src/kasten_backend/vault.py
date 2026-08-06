"""Reading the markdown vault off disk.

The vault is the source of truth, so everything here goes straight to the
filesystem. Postgres holds a derived index and never answers these questions.
"""

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

SUFFIX = ".md"
"""What a note's name ends in, which is the one rule a folder does not share."""

_NAME_LIMIT_BYTES = 255
"""The longest one path segment may be, in UTF-8 bytes.

Every filesystem kasten runs on enforces this, and a name over it makes the
write raise rather than answer.
"""


def list_markdown_files(root: Path) -> list[str]:
    """Return every markdown file under `root`, as sorted relative POSIX paths.

    Hidden files and directories are skipped, which keeps `.git` and editor
    dotfiles out of the tree. A hidden directory is skipped without being walked
    into, which is most of what this costs on a real vault: the jj repo beside
    the notes holds thousands of files nothing here would ever show. A vault
    directory that does not exist reads as an empty one, so a fresh checkout
    still serves.

    `os.scandir` rather than `rglob`, which is the same walk with a `Path` built
    per entry and the relative path parsed back out of it three times over. At
    10,000 notes that was 154ms and this is 14ms, and every caller pays it: the
    listing is what the tree, the finder and the link rewrite all start from.
    The prefix is carried down rather than worked out per file, which is what
    keeps these POSIX paths without a separator to swap afterwards.

    A directory is walked and never listed, the suffix on its name
    notwithstanding. `resolve_note` refuses one, so a folder called `notes.md`
    used to be a row in the tree that answered 404 when you opened it.
    """
    if not root.is_dir():
        return []

    found: list[str] = []

    def walk(directory: str, prefix: str) -> None:
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name.startswith("."):
                    continue
                # Not followed, so a link pointing at an ancestor cannot walk
                # forever, and a link out of the vault cannot list what is on
                # the other side. `rglob` declined one for the same reason.
                if entry.is_dir(follow_symlinks=False):
                    walk(entry.path, f"{prefix}{entry.name}/")
                elif entry.name.endswith(SUFFIX):
                    found.append(f"{prefix}{entry.name}")

    walk(str(root), "")
    return sorted(found)


def _resolve_inside(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal location under `root`, or None.

    `relative` arrives from the URL and is therefore hostile. Both sides are
    resolved before they are compared, so `..`, an absolute path and a symlink
    pointing out of the vault all land outside `root` and are refused. Anything
    the listing would not show is refused too, so the tree and this function
    agree on what lives in the vault.

    Everything the vault will take, note or folder, passes through here, because
    several copies of these rules would drift and the loosest copy would be a
    write. What a note adds on top is its suffix, and `resolve_path` is where
    that sits.
    """
    # Checked before anything touches the filesystem, because an embedded null
    # makes every call raise rather than return.
    if "\0" in relative:
        return None

    base = root.resolve()
    path = (base / relative).resolve()

    if not path.is_relative_to(base):
        return None

    # The rules about the name alone, so nothing below this asks the filesystem
    # a question a name has already answered. The length rule sits here rather
    # than in a catch around the write, which would read a full disk as a bad
    # path, and refusing before mkdir runs is what keeps a refused note from
    # leaving its folder behind. No parts at all is the vault root, which is a
    # path the vault holds rather than one it will move or write.
    parts = path.relative_to(base).parts
    if not parts or any(
        part.startswith(".") or len(part.encode("utf-8")) > _NAME_LIMIT_BYTES for part in parts
    ):
        return None

    # A path that is still a link after `resolve` is a link `resolve` could not
    # follow, which means a loop. Refused here because the write raises on one
    # rather than refusing; a read already sees it as absent.
    if path.is_symlink():
        return None

    # A note cannot live inside a file, nor inside a link that leads nowhere:
    # `exists` follows a looping link, gives up and answers False, so asking
    # after the link itself is what catches one. A link to a real folder is a
    # folder and passes. Refused where the other rules live, because mkdir
    # raises on these rather than refusing, and `base` itself is a directory so
    # including it costs nothing.
    if any(
        not p.is_dir() and (p.exists() or p.is_symlink())
        for p in path.parents
        if p.is_relative_to(base)
    ):
        return None

    return path


def resolve_path(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal note location under `root`, or None.

    A note is a `.md` file, which is the one rule a folder does not share, so it
    is the one rule that sits out here. Reading, writing and creating all come
    through this.
    """
    path = _resolve_inside(root, relative)
    if path is None or path.suffix != SUFFIX:
        return None

    return path


def resolve_folder_path(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal folder location under `root`, or None.

    The same rules a note's path answers to, minus the suffix. A folder is the
    prefix of a note and carries no name of its own, so nothing here asks what
    it is called beyond what `_resolve_inside` already refuses.
    """
    return _resolve_inside(root, relative)


def resolve_folder(root: Path, relative: str) -> Path | None:
    """Return the real path of one folder under `root`, or None when there is none.

    What `resolve_note` is to a note. A path with a note at it is refused rather
    than moved: `PATCH /api/files/{path}` is what moves a note, and answering
    here would be a second way to do it with none of the note's rules.
    """
    path = resolve_folder_path(root, relative)
    if path is None or not path.is_dir():
        return None

    return path


def resolve_note(root: Path, relative: str) -> Path | None:
    """Return the real path of one note under `root`, or None when there is none.

    `resolve_path` decides whether the vault will take the path at all. Reading
    and writing want one thing more, a file actually being there, and creating
    is the caller that does not.
    """
    path = resolve_path(root, relative)
    if path is None or not path.is_file():
        return None

    return path


def relative_path(root: Path, note: Path) -> str:
    """Return the vault-relative POSIX path of a note `resolve_note` returned.

    The path in the URL may be a roundabout spelling of the same note, and two
    spellings must not read as two notes.
    """
    return note.relative_to(root.resolve()).as_posix()


def read_note(root: Path, relative: str) -> str | None:
    """Return the text of one note under `root`, or None when there is no such note.

    Every refusal reads as absent. Telling a typo apart from an attempt to climb
    out is worth nothing to the one user and something to everyone else.
    """
    path = resolve_note(root, relative)
    if path is None:
        return None

    return path.read_text(encoding="utf-8")


def create_note(path: Path, content: str) -> None:
    """Write a new note at a path `resolve_path` returned.

    Straight to the target rather than through `write_note`. The temp file
    there protects text that is already on disk, and a create has none.

    The folders on the way are made first, so a note names its folder into
    being, the vault root included. `resolve_path` has already refused the
    paths `mkdir` would raise on rather than answer: an ancestor that is a file
    or a link leading nowhere, and a name too long for the filesystem.

    The content is the caller's, and the only caller writes a note holding its
    frontmatter and nothing else. Nothing is written under the block: the file
    name is the note's title, so a first line here would be a word in the vault
    the user did not type.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def rename_note(source: Path, target: Path) -> None:
    """Move a note `resolve_note` returned to a path `resolve_path` returned.

    The folders on the way to the target are made first, the way `create_note`
    makes them, so a note names its folder into being wherever it lands.

    The caller has already refused a target that is taken. `Path.rename`
    overwrites one without a word, and the check cannot move in here: between it
    and the rename nothing holds the path, so this would promise an atomicity it
    does not have. kasten is one user behind oauth2-proxy, and that gap is the
    accepted cost of not doing the link-and-unlink dance.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)


def rename_folder(source: Path, target: Path) -> None:
    """Move a folder `resolve_folder` returned to a path `resolve_folder_path` returned.

    One rename, not a walk over the notes inside. A folder is the prefix of
    every note under it, so renaming the directory renames all of them at once
    and there is no half-moved subtree to find a way back from. The folders on
    the way to the target are made first, the way a note's move makes them.

    The caller has already refused a target that is taken and a target inside
    the source, both of which `rename` raises on or, worse, quietly swallows: it
    replaces an empty directory without a word. The gap between that check and
    this rename is the same one `rename_note` accepts, and for the same reason.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    source.rename(target)


def prune_empty_folders(root: Path, folder: Path) -> None:
    """Remove `folder` and the folders above it, up to but never including `root`.

    A move leaves its old folder behind, and folders exist here only as the
    prefix of a note, so an emptied one is invisible to the listing and still on
    disk. This is what stops the vault filling with directories nothing shows.

    `rmdir` refuses a directory with anything in it, so the refusal is the stop
    condition and no separate emptiness check is needed. A folder holding only a
    hidden file is not empty and stays, and so does a symlink, which `rmdir`
    refuses rather than follows: what is on the other side is not ours to tidy.
    The first folder that stays keeps every folder above it too.
    """
    base = root.resolve()
    current = folder

    while current != base and current.is_relative_to(base):
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def write_note(path: Path, content: str) -> None:
    """Write `content` over a note `resolve_note` returned.

    The text goes to a temp file next to the target and is then renamed over
    it, so a crash halfway through leaves the old note whole rather than half a
    new one. Same directory, so the rename is atomic. The temp name is hidden
    and does not end in `.md`, which keeps a leftover out of the listing twice
    over.

    `newline=""` because the vault is the source of truth: the bytes that
    arrived are the bytes on disk.
    """
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8", newline="")
    temporary.replace(path)
