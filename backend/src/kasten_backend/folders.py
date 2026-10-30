"""Making and moving notes and folders, and the `index.md` each folder kasten makes gets.

Every folder made here gets a listing, and a move that empties a folder takes it away again.
Both halves live here so that rule has one copy. The vault itself only resolves, reads and writes.
"""

import re
from typing import TYPE_CHECKING

from kasten_backend.vault import SUFFIX, write_note

if TYPE_CHECKING:
    from pathlib import Path


def create_note(path: Path, content: str) -> None:
    """Write a new note at a path `resolve_path` returned.

    Straight to the target, not through `write_note`, whose temp file protects text already on
    disk. The folders on the way are made first. Nothing is written under the frontmatter: the
    file name is the title, so any extra line would be a word the user did not type.
    """
    made = make_folders(path.parent)
    path.write_text(content, encoding="utf-8")
    write_listings(made)


def rename_note(source: Path, target: Path) -> None:
    """Move a note `resolve_note` returned to a path `resolve_path` returned.

    The folders on the way are made first, as `create_note` does. The caller refuses a taken
    target, since `Path.rename` would overwrite it silently. The gap before the rename is
    accepted: one user behind oauth2-proxy, not a link-and-unlink dance.
    """
    made = make_folders(target.parent)
    source.rename(target)
    write_listings(made)


def rename_folder(source: Path, target: Path) -> None:
    """Move a folder `resolve_folder` returned to a path `resolve_folder_path` returned.

    One rename, not a walk over the notes: every note under the folder moves at once. The caller
    refuses a taken target and a target inside the source, which `rename` would raise on or
    quietly replace. The gap is the one `rename_note` accepts.
    """
    made = make_folders(target.parent)
    source.rename(target)
    write_listings(made)
    retitle_listing(target, source.name)


INDEX = "index.md"
"""What a folder's listing is called, which OKF reserves for exactly that."""


def make_folders(folder: Path) -> list[Path]:
    """Make `folder` and the folders on the way to it, and answer with the ones that were new.

    Outermost first. Only the new ones get a listing; a folder already there keeps its index,
    or none.
    """
    made = [folder, *folder.parents]
    made = list(reversed([path for path in made if not path.exists()]))
    folder.mkdir(parents=True, exist_ok=True)
    return made


def encode_href(href: str) -> str:
    """`href` with the six characters that end or garble a markdown link escaped.

    Not `quote`, which would escape every accented letter too. `#` and `?` matter because a
    reader cuts the path at either, so `plan #2.pdf` written raw links to `plan `. `%` goes first,
    or it would escape the escapes.
    """
    pairs = (("%", "%25"), (" ", "%20"), ("(", "%28"), (")", "%29"), ("#", "%23"), ("?", "%3F"))
    for raw, escaped in pairs:
        href = href.replace(raw, escaped)
    return href


def listing(folder: Path) -> str:
    """An `index.md` for `folder`: its name as the heading and a bullet per thing in it.

    The shape the index guide asks for, minus the description after each link, which only a
    person can write. Hidden names and the two reserved files are left out.
    """
    children = sorted(
        (child for child in folder.iterdir() if not child.name.startswith(".")),
        key=lambda child: (not child.is_dir(), child.name.lower()),
    )
    lines = [f"# {folder.name}", ""]
    for child in children:
        if child.is_dir():
            lines.append(f"* [{child.name}]({encode_href(child.name)}/)")
        elif child.name not in (INDEX, "log.md"):
            name = child.stem if child.suffix == SUFFIX else child.name
            lines.append(f"* [{name}]({encode_href(child.name)})")
    return "\n".join(lines) + "\n"


LISTING_ENTRY = re.compile(r"^\s*[-*+]\s.*\]\(", re.MULTILINE)
"""A bullet holding a markdown link, which is what tells a listing from prose."""


def write_listings(folders: list[Path]) -> None:
    """Give each of `folders` an `index.md` listing what it holds, unless it has one.

    Run after the write that made them, so the note that called the folder into being is listed.
    The outermost one also joins the index above it, when that index is already a listing. A
    prose index is somebody's note and is left alone.
    """
    for folder in folders:
        index = folder / INDEX
        if not index.exists():
            index.write_text(listing(folder), encoding="utf-8")

    above = folders[0].parent / INDEX if folders else None
    text = above.read_text(encoding="utf-8") if above is not None and above.is_file() else ""
    if above is not None and LISTING_ENTRY.search(text):
        name = folders[0].name
        separator = "" if not text or text.endswith("\n") else "\n"
        write_note(above, f"{text}{separator}* [{name}]({encode_href(name)}/)\n")


def retitle_listing(folder: Path, old: str) -> None:
    """Give `folder`'s index the folder's new name, if its heading was the old one.

    A heading somebody wrote in their own words is theirs and stays.
    """
    index = folder / INDEX
    if not index.is_file():
        return
    text = index.read_text(encoding="utf-8")
    heading = f"# {old}\n"
    if text.startswith(heading):
        write_note(index, f"# {folder.name}\n{text[len(heading) :]}")


def prune_empty_folders(root: Path, folder: Path) -> list[Path]:
    """Remove `folder` and the folders above it, up to but never including `root`.

    Answers with the folders removed, innermost first. `rmdir` refuses a folder with anything in
    it, which is the stop condition, so a folder holding a hidden file or a symlink stays. A
    folder holding only its `index.md` counts as empty, or none would ever be pruned.
    """
    base = root.resolve()
    current = folder
    removed = []

    while current != base and current.is_relative_to(base):
        index = current / INDEX
        try:
            if [child.name for child in current.iterdir()] == [INDEX] and not index.is_symlink():
                index.unlink()
            current.rmdir()
        except OSError:
            return removed
        removed.append(current)
        current = current.parent
    return removed
