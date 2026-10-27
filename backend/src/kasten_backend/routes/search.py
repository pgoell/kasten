"""The route that finds a word in the vault: in its notes and in its pdf, epub and html files."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.routes.queries import LineHit
from kasten_backend.search import search_vault
from kasten_backend.search_meta import notes_meta

router = APIRouter()


class FilePlace(BaseModel):
    """Where in a pdf, an epub or an html page a line sits, for a hit in one."""

    kind: Literal["pdf", "epub", "html"]
    """Which kind of file the hit is in, read off its suffix."""

    label: str
    """The place as the row shows it: `page 3`, `Chapter 2, 41%` or the heading."""

    page: int | None = None
    """The pdf page the line is on, counting from one. None for the other kinds."""

    anchor: str | None = None
    """The `id` of the html heading above the line, which the page pane opens at, or None."""


class SearchHit(LineHit):
    """One line that matched a search, with the date and tags of the note it is in."""

    place: FilePlace | None = None
    """Where in the file the line is, for a hit in a pdf, an epub or an html page.

    None for a line of a note.
    """

    date: str | None = None
    """The date the note counts on, as ISO 8601: a calendar day or an instant.

    A calendar day (`YYYY-MM-DD`) when the note's name starts with one, which needs
    no zone. Otherwise an instant, from the note's `created` as written or its
    file's modification time in UTC with its offset. The instant is not cut to a
    day here because the day depends on the reader's zone: `created` is written
    in UTC, so a note written at 00:30 in Berlin is the day before in UTC. The
    client reads the instant in its own zone.

    Read by `search_meta.notes_meta`. None when the note could not be read.
    """

    tags: list[str] | None = None
    """The note's tags, each with its hash, sorted. None when the note could not be read."""


@router.get("/api/search")
async def search_files(
    q: str, settings: Annotated[Settings, Depends(get_settings)], archive: bool = False
) -> list[SearchHit]:
    """Find every line in the vault containing `q`, ignoring case.

    A literal match, not a regex and not a fuzzy one. The client ranks what
    comes back, which is what makes the finder feel fuzzy without asking a
    subsequence match to mean something over prose, where it matches everything.

    `archive` walks the archive folder too. Off by default, because what is
    filed away is not usually what is being looked for, and the cap on what
    comes back means an archive left in would eventually push live notes out of
    the answer rather than merely lengthening it.
    """
    hits = await search_vault(settings.vault_path, q, None if archive else settings.archive_path)
    meta = await notes_meta(settings.vault_path, [hit.path for hit in hits])
    return [
        SearchHit(
            path=hit.path,
            line=hit.line,
            text=hit.text,
            date=meta[hit.path][0],
            tags=meta[hit.path][1],
        )
        for hit in hits
    ]
