"""Making and moving notes and folders, and the `index.md` each folder kasten makes gets.

A folder is only the prefix of a note, so a note's create or move makes or moves
its folders with it. Every folder made here gets a listing of what it holds, and
a move that empties a folder takes it away again. Both halves live here so the
rule that a folder has a listing, or goes when it empties, has one copy. The
vault itself only resolves, reads and writes.
"""

import re
from typing import TYPE_CHECKING

from kasten_backend.vault import SUFFIX, write_note

if TYPE_CHECKING:
    from pathlib import Path


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
    made = make_folders(path.parent)
    path.write_text(content, encoding="utf-8")
    write_listings(made)


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
    made = make_folders(target.parent)
    source.rename(target)
    write_listings(made)


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
    made = make_folders(target.parent)
    source.rename(target)
    write_listings(made)
    retitle_listing(target, source.name)


INDEX = "index.md"
"""What a folder's listing is called, which OKF reserves for exactly that."""


def make_folders(folder: Path) -> list[Path]:
    """Make `folder` and the folders on the way to it, and answer with the ones that were new.

    Outermost first. The answer is what a folder kasten makes is told apart by:
    it gets a listing, and a folder that was already there keeps whatever it
    had, an index or none.
    """
    made = [folder, *folder.parents]
    made = list(reversed([path for path in made if not path.exists()]))
    folder.mkdir(parents=True, exist_ok=True)
    return made


def encode_href(href: str) -> str:
    """`href` with the six characters that end or garble a markdown link escaped.

    Not `quote`, which would turn every accented letter into a `%C3` too. A
    reader of the raw file should see the name it was given. `#` and `?` are in
    because a reader cuts the path at the first of either, so `plan #2.pdf`
    written raw is a link to `plan `. `%` goes first, or it would escape the
    escapes.
    """
    pairs = (("%", "%25"), (" ", "%20"), ("(", "%28"), (")", "%29"), ("#", "%23"), ("?", "%3F"))
    for raw, escaped in pairs:
        href = href.replace(raw, escaped)
    return href


def listing(folder: Path) -> str:
    """An `index.md` for `folder`: its name as the heading and a bullet per thing in it.

    The shape the index guide asks for, minus the description after each link,
    which only a person can write. Folders first and then files, the way the
    tree sorts them, and hidden names and the two reserved files left out.
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

    Run after the write that made them, so the note that called a folder into
    being is in its listing. The outermost one is also added to the index of
    the folder above it, when that index is a listing already, holding a
    bullet with a markdown link: a folder kasten made is not one somebody chose
    to leave out, but an index written as prose is somebody's note.
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

    Answers with the folders it removed, innermost first, so a caller can take
    their entries out of the index above them.

    A move leaves its old folder behind, and folders exist here only as the
    prefix of a note, so an emptied one is invisible to the listing and still on
    disk. This is what stops the vault filling with directories nothing shows.

    `rmdir` refuses a directory with anything in it, so the refusal is the stop
    condition and no separate emptiness check is needed. A folder holding only a
    hidden file is not empty and stays, and so does a symlink, which `rmdir`
    refuses rather than follows: what is on the other side is not ours to tidy.
    The first folder that stays keeps every folder above it too.

    A folder holding its `index.md` and nothing else counts as empty, and the
    index goes with it. Every folder kasten makes gets one, so without this no
    folder would ever be pruned again. The text is not lost: the move or the
    delete that emptied the folder is one jj change, and the index is in the
    one before it.
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
