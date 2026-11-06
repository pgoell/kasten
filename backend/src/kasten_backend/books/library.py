"""The library: every `type: Book` note, with what its frontmatter says of the reading.

Nothing here is stored. Each row is read off the note and the file beside it, so a note moved
or edited by hand reads true on the next request.
"""

import re
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel

from kasten_backend.code_spans import WIKILINK, code_spans, inside
from kasten_backend.frontmatter import body_start, created, field
from kasten_backend.links import link_path, names_a_file, split_target
from kasten_backend.search import notes_holding
from kasten_backend.vault import list_markdown_files, resolve_book, resolve_note

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.config import Settings

Status = Literal["unread", "want", "reading", "finished", "dropped"]

CHOSEN: tuple[Status, ...] = ("want", "reading", "finished", "dropped")
"""The values `status:` may hold. Any other value reads as unset."""

FINISHED_AT = 0.99
"""The `progress:` that counts as done: the reader rounds, and a last page rarely says 1."""

_HIGHLIGHT = re.compile(r"\^hl-[0-9A-Za-z]+[ \t]*$", re.MULTILINE)
"""The block id the reader ends a taken highlight with, one per highlight."""


class LibraryBook(BaseModel):
    """One book note, as the library pane lists it."""

    path: str
    title: str
    author: str | None
    folder: str
    """The folder holding the note, spelled from the vault root; the pane calls it the shelf."""
    status: Status
    chosen: bool
    """Whether `status` came from the note's own `status:` line rather than its reading."""
    progress: float | None
    read_at: str | None
    created: str | None
    hidden: bool
    highlights: int
    current: bool
    """Whether `reading-now.md` names this note, as `<leader>gc` reads it."""
    format: Literal["epub", "pdf"] | None
    """The file beside the note, or None when the pair is broken."""


def status_of(chosen: str | None, progress: float | None, reading: str | None) -> Status:
    """The note's own `status:` where it names one, else what the reader's fields say."""
    named = next((each for each in CHOSEN if each == chosen), None)
    if named is not None:
        return named
    if progress is not None and progress >= FINISHED_AT:
        return "finished"
    return "reading" if reading else "unread"


def fraction(text: str | None) -> float | None:
    """`text` as a fraction from 0 to 1, or None when it is not one."""
    try:
        value = float(text or "")
    except ValueError:
        return None
    return value if 0 <= value <= 1 else None


def note_text(root: Path, path: str) -> str:
    """The note at `path`, or nothing when there is none or it cannot be read."""
    note = resolve_note(root, path)
    try:
        return "" if note is None else note.read_text(encoding="utf-8")
    except OSError, UnicodeDecodeError:
        return ""


def named_book(settings: Settings, paths: list[str]) -> str | None:
    """The note the first `[[link]]` in `reading-now.md` names, as `<leader>gc` reads it."""
    text = note_text(settings.vault_path, f"{settings.config_path}/reading-now.md")
    code = code_spans(text)
    match = next((m for m in WIKILINK.finditer(text) if not inside(m.start(), code)), None)
    if match is None:
        return None
    name = split_target(match.group(1)).name
    path = link_path(match.group(1), paths)
    return path if name and not names_a_file(name) and path in paths else None


def _row(root: Path, path: str, text: str, current: str | None) -> LibraryBook:
    progress = fraction(field(text, "progress"))
    beside = resolve_book(root, path)
    folder, _, name = path.rpartition("/")
    return LibraryBook(
        path=path,
        title=name.removesuffix(".md"),
        author=field(text, "author") or None,
        folder=folder,
        status=status_of(field(text, "status"), progress, field(text, "reading")),
        chosen=field(text, "status") in CHOSEN,
        progress=progress,
        read_at=field(text, "read_at") or None,
        created=created(text),
        hidden=field(text, "hidden") == "true",
        highlights=len(_HIGHLIGHT.findall(text, body_start(text))),
        current=path == current,
        format=None if beside is None else ("pdf" if beside.suffix.lower() == ".pdf" else "epub"),
    )


async def books(settings: Settings) -> list[LibraryBook]:
    """Every `type: Book` note outside the archive, in path order."""
    root = settings.vault_path
    current = named_book(settings, list_markdown_files(root))
    found: list[LibraryBook] = []
    # rg narrows to notes holding the word; the block is what decides.
    for path in sorted(await notes_holding(root, "Book", skip=settings.archive_path)):
        text = note_text(root, path)
        if field(text, "type") == "Book":
            found.append(_row(root, path, text, current))
    return found
