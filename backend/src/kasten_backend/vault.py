"""Reading the markdown vault off disk.

Everything goes straight to the filesystem: Postgres answers none of these questions.
"""

import os
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

SUFFIX = ".md"
"""What a note's name ends in, which is the one rule a folder does not share."""

LONE_LF = re.compile(r"(?<!\r)\n")
"""An LF with no CR before it, which `write_note` turns into a CRLF."""

BOOK_SUFFIXES = (".epub", ".pdf")
"""What a book's name ends in, the preferred format first.

Spelled out, since nothing here promises anything about mobi or cbz. The order settles a
note with both beside it: the epub, which reflows, wins.
"""

ASSET_MAGIC: dict[str, re.Pattern[bytes]] = {
    ".epub": re.compile(rb"PK\x03\x04"),
    ".pdf": re.compile(rb"%PDF-"),
    ".png": re.compile(rb"\x89PNG\r\n\x1a\n"),
    ".jpg": re.compile(rb"\xff\xd8\xff"),
    ".jpeg": re.compile(rb"\xff\xd8\xff"),
    ".gif": re.compile(rb"GIF8"),
    ".webp": re.compile(rb"RIFF"),
    ".mp3": re.compile(rb"ID3|\xff[\xfb\xfa\xf3\xf2\xe3\xe2]"),
    ".m4a": re.compile(rb".{4}ftyp", re.DOTALL),
    ".ogg": re.compile(rb"OggS"),
    ".wav": re.compile(rb"RIFF"),
}
"""What the vault takes beside its notes, and what the head of each one matches.

The keys are the whole rule about which paths `resolve_asset_path` answers to, matched
ignoring case: `PHOTO.PNG` is an asset. A note is the exception, `SUFFIX` matching exactly.
The patterns are a usability check, never a security one.
"""

HEAD_BYTES = 8
"""How much of a file's head `fits` reads, which is the furthest any pattern reaches.

Typed, not derived: a row reaching further has to widen this by hand.
"""

AUDIO_SUFFIXES = (".m4a", ".mp3", ".ogg", ".wav")
"""What a sound's name ends in: an asset the editor draws as a player."""

IMAGE_SUFFIXES = tuple(sorted(set(ASSET_MAGIC) - set(BOOK_SUFFIXES) - set(AUDIO_SUFFIXES)))
"""The suffixes `list_images` walks for: every asset but the books and sounds.

A book left in this set would be a row in the file tree and a `![](` completion. A sound
is left out so that `![](` completes pictures only.
"""

HTML_SUFFIX = ".html"
"""What a page of HTML beside the notes ends in, which the vault shows and an agent may write.

Not an `ASSET_MAGIC` row, which an upload never overwrites. A page is written by a research
run or by an agent through `POST /agent/files`, and the browser only reads it. `.htm` is
left out, as `.markdown` is.
"""

_NAME_LIMIT_BYTES = 255
"""The longest one path segment may be, in UTF-8 bytes.

Every filesystem kasten runs on enforces this, and a name over it makes the
write raise rather than answer.
"""


def list_markdown_files(root: Path) -> list[str]:
    """Return every markdown file under `root`, as sorted relative POSIX paths."""
    return _list_files(root, (SUFFIX,))


def list_images(root: Path) -> list[str]:
    """Return every image under `root`, as sorted relative POSIX paths.

    What the editor completes `![](` against. Walked like the notes, so an image dropped in
    over the terminal completes too.
    """
    return _list_files(root, IMAGE_SUFFIXES, ignore_case=True)


def list_html(root: Path) -> list[str]:
    """Return every HTML page under `root`, as sorted relative POSIX paths."""
    return _list_files(root, (HTML_SUFFIX,), ignore_case=True)


def fits(suffix: str, head: bytes) -> bool:
    """Whether `head` is how a file ending in `suffix`, a key of `ASSET_MAGIC`, starts."""
    return ASSET_MAGIC[suffix].match(head[:HEAD_BYTES]) is not None


def list_assets(root: Path) -> list[str]:
    """Return every image, sound and book under `root`, as sorted relative POSIX paths."""
    return _list_files(root, tuple(ASSET_MAGIC), ignore_case=True)


def _list_files(root: Path, suffixes: tuple[str, ...], *, ignore_case: bool = False) -> list[str]:
    """Return every file under `root` whose name ends in one of `suffixes`.

    Hidden entries and their walks are skipped: the jj repo beside the notes holds thousands
    of files. Links are not followed, so a link cannot loop or list what lies outside the
    vault. A folder named `notes.md` is walked, never listed.
    """
    if not root.is_dir():
        return []

    found: list[str] = []

    def walk(directory: str, prefix: str) -> None:
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.name.startswith("."):
                    continue
                # Not followed: a link to an ancestor would loop forever, and a link out of
                # the vault would list what is on the other side.
                if entry.is_dir(follow_symlinks=False):
                    walk(entry.path, f"{prefix}{entry.name}/")
                elif (entry.name.lower() if ignore_case else entry.name).endswith(suffixes):
                    found.append(f"{prefix}{entry.name}")

    walk(str(root), "")
    return sorted(found)


def legal_name(part: str) -> bool:
    """Whether one path segment is a name the vault holds: not hidden, and short enough.

    Its own function so a caller holding a name and no vault, the Anki reader,
    asks the rule `_resolve_inside` applies rather than a copy of it.
    """
    return not part.startswith(".") and len(part.encode("utf-8")) <= _NAME_LIMIT_BYTES


def _resolve_inside(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal location under `root`, or None.

    `relative` comes from the URL, so it is hostile. Both sides are resolved before they are
    compared, which refuses `..`, an absolute path and a symlink out of the vault. Every write
    goes through here, and the listing's refusals apply too, so the tree agrees with it.
    """
    # Checked before anything touches the filesystem, because an embedded null
    # makes every call raise rather than return.
    if "\0" in relative:
        return None

    base = root.resolve()
    path = (base / relative).resolve()

    if not path.is_relative_to(base):
        return None

    # Name rules only, before any filesystem question: a length check in a catch around the write
    # would read a full disk as a bad path. No parts means the vault root, which is never written.
    parts = path.relative_to(base).parts
    if not parts or not all(legal_name(part) for part in parts):
        return None

    # Still a link after `resolve` means a loop it could not follow. Refused here, since a
    # write raises on one; a read already sees it as absent.
    if path.is_symlink():
        return None

    # A note cannot sit inside a file or a dead link. `exists` says False for a loop, so the
    # link itself is asked about. `base` is a directory, so including it costs nothing.
    if any(
        not p.is_dir() and (p.exists() or p.is_symlink())
        for p in path.parents
        if p.is_relative_to(base)
    ):
        return None

    return path


def resolve_path(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal note location under `root`, or None.

    A note is a `.md` file, the one rule a folder does not share, so it sits here.
    """
    path = _resolve_inside(root, relative)
    if path is None or path.suffix != SUFFIX:
        return None

    return path


def resolve_asset_path(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal asset location under `root`, or None.

    `resolve_path` for a book or an image: the suffix is the one rule that differs.
    """
    path = _resolve_inside(root, relative)
    if path is None or path.suffix.lower() not in ASSET_MAGIC:
        return None

    return path


def resolve_asset(root: Path, relative: str) -> Path | None:
    """Return the real path of one asset under `root`, or None when there is none.

    The `is_file` check makes the 404 real: `FileResponse` raises on a path that is absent or
    not a regular file, which the client sees as a 500.
    """
    path = resolve_asset_path(root, relative)
    if path is None or not path.is_file():
        return None

    return path


def resolve_html_path(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal HTML page location under `root`, or None.

    `resolve_asset_path` for a page an agent writes. The suffix is lowered as `resolve_html`
    lowers it.
    """
    path = _resolve_inside(root, relative)
    if path is None or path.suffix.lower() != HTML_SUFFIX:
        return None

    return path


def resolve_html(root: Path, relative: str) -> Path | None:
    """Return the real path of one HTML page under `root`, or None when there is none.

    `resolve_asset` for the one suffix that is not an asset, with the same `is_file` check.
    """
    path = resolve_html_path(root, relative)
    if path is None or not path.is_file():
        return None

    return path


def resolve_book(root: Path, relative: str) -> Path | None:
    """Return the real path of the book beside a note, or None when there is none.

    `relative` must end in `.md`: `removesuffix` leaves any other path alone, so `DDIA`
    would otherwise answer with `DDIA.epub`. The swap is on the string, since `with_suffix`
    raises on a name with none.
    """
    if not relative.endswith(SUFFIX):
        return None

    stem = relative.removesuffix(SUFFIX)

    for suffix in BOOK_SUFFIXES:
        book = resolve_asset(root, f"{stem}{suffix}")
        if book is not None:
            return book

    return None


def resolve_folder_path(root: Path, relative: str) -> Path | None:
    """Return the real path of a legal folder location under `root`, or None.

    The rules a note's path answers to, minus the suffix.
    """
    return _resolve_inside(root, relative)


def resolve_folder(root: Path, relative: str) -> Path | None:
    """Return the real path of one folder under `root`, or None when there is none.

    What `resolve_note` is to a note. A note at the path is refused, since moving one is
    `PATCH /api/files/{path}`'s job.
    """
    path = resolve_folder_path(root, relative)
    if path is None or not path.is_dir():
        return None

    return path


def resolve_note(root: Path, relative: str) -> Path | None:
    """Return the real path of one note under `root`, or None when there is none.

    `resolve_path` decides whether the path is legal. Reading and writing need the file to
    exist too; creating does not.
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

    Every refusal reads as absent, so a probe cannot tell a typo from an attempt to climb out.
    """
    path = resolve_note(root, relative)
    if path is None:
        return None

    return path.read_text(encoding="utf-8")


def move_asset_beside(source: Path, target: Path) -> None:
    """Carry the books beside a note to wherever the note just went.

    The pairing is a convention, not a record, so a note moved without its book loses it.
    A book already at the target is left alone, since nothing here overwrites a book.
    """
    for book, landing in books_beside(source, target):
        book.rename(landing)


def books_beside(source: Path, target: Path) -> list[tuple[Path, Path]]:
    """Each book beside the note at `source` that a move to `target` carries, and where it lands.

    The link rewrite asks before the move and `move_asset_beside` after it, and the two must
    agree on which books travel.
    """
    pairs = ((source.with_suffix(suffix), target.with_suffix(suffix)) for suffix in BOOK_SUFFIXES)
    return [(book, landing) for book, landing in pairs if book.is_file() and not landing.exists()]


def landing(path: Path, content: str) -> str:
    """`content` as `write_note` would put it on disk at `path`.

    A note already holding a CRLF keeps CRLF. `read_note` hands out LF text, so without this
    a save would rewrite every line of a Windows note. Its own function so a size bound can
    measure it.
    """
    try:
        crlf = b"\r\n" in path.read_bytes()
    except FileNotFoundError:
        crlf = False

    return LONE_LF.sub("\r\n", content) if crlf else content


def write_note(path: Path, content: str) -> None:
    """Write `content` over a note `resolve_note` returned, through a hidden temp file.

    The rename is atomic, so a crash leaves the old note whole. `newline=""` keeps the bytes
    that arrived, bar the CRLF `landing` adds.
    """
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(landing(path, content), encoding="utf-8", newline="")
    temporary.replace(path)
