"""The route that finds a word in the vault: in its notes and in its pdf, epub and html files."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends

from kasten_backend import file_search
from kasten_backend.config import Settings, get_settings
from kasten_backend.file_search import (
    FilePlace,  # noqa: TC001  pydantic reads the annotation at runtime
)
from kasten_backend.routes.queries import LineHit
from kasten_backend.search import search_vault
from kasten_backend.search_meta import day_of, notes_meta

router = APIRouter()


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

    The notes come first and then the lines of the pdf, epub and html files, read
    from the text cache, which is brought up to date before the search. A blank
    query answers nothing and extracts nothing.

    `archive` walks the archive folder too. Off by default, because what is
    filed away is not usually what is being looked for, and the cap on what
    comes back means an archive left in would eventually push live notes out of
    the answer rather than merely lengthening it.
    """
    if not q.strip():
        return []
    skip = None if archive else settings.archive_path
    root = settings.vault_path

    notes = await search_vault(root, q, skip)
    texts = await file_search.search_files(root, settings.text_cache_path, q, len(notes), skip)

    # A file dated by its note, as the note's own lines are; with no note, by its name or its file.
    note_of = {hit.path: str(Path(hit.path).with_suffix(".md")) for hit in texts}
    existing = [note for note in note_of.values() if (root / note).is_file()]
    meta = await notes_meta(root, [hit.path for hit in notes] + existing)

    found = [
        SearchHit(
            path=hit.path,
            line=hit.line,
            text=hit.text,
            date=meta[hit.path][0],
            tags=meta[hit.path][1],
        )
        for hit in notes
    ]
    for hit in texts:
        note = note_of[hit.path]
        if note in meta:
            date, tags = meta[note]
        else:
            date, tags = day_of(root, hit.path, None), []
        found.append(
            SearchHit(
                path=hit.path, line=hit.line, text=hit.text, place=hit.place, date=date, tags=tags
            )
        )
    return found
