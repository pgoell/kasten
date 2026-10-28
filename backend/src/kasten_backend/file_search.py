"""Finding a word in the text of the pdf, epub and html files, for every search that reads them.

`GET /api/search` and the agent's `search_notes` both answer through here, so a
file hit is found from one cache, by one reader, and placed the same way in both.
Not under `routes/`, because the agent's modules may not import from there.
"""

from pathlib import Path
from typing import Literal, NamedTuple

from pydantic import BaseModel

from kasten_backend import file_text
from kasten_backend.search import MOST_HITS, literal_matcher, scan_vault

KINDS: dict[str, Literal["pdf", "epub", "html"]] = {
    ".pdf": "pdf",
    ".epub": "epub",
    ".html": "html",
}
"""The kind a file is shown as, read off its lower-case suffix."""

TEXT_LISTING = ("--no-ignore", "--glob", "*.txt")
"""The files rg reads for a search of the extracted text: every cache entry's txt, and no json."""


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


class FileHit(NamedTuple):
    """One matching line of a file: the file's vault path, the line of its text, and its place."""

    path: str
    line: int
    text: str
    place: FilePlace


async def search_files(
    root: Path, cache: Path, query: str, notes: int, skip: str | None
) -> list[FileHit]:
    """Every line of the files' text holding `query`, in the room `notes` hits leave under the cap.

    The cache is brought up to date first, so a cold cache costs the whole
    extraction before the answer. The caller checks the query is not blank.
    """
    await file_text.refresh(root, cache, skip)
    room = MOST_HITS - notes
    # No scan at all once the notes fill the cap: `scan_vault` stops when it
    # reaches its cap, and a cap of nothing is never reached.
    if room <= 0:
        return []
    texts = await scan_vault(cache, literal_matcher(query), room, skip, listing=TEXT_LISTING)

    found = []
    for hit in texts:
        path = hit.path.removesuffix(".txt")
        place = file_text.place_of(cache, path, hit.line)
        if place is None:
            continue
        found.append(
            FileHit(
                path=path,
                line=hit.line,
                text=hit.text,
                place=FilePlace(
                    kind=KINDS[Path(path).suffix.lower()],
                    label=place.label,
                    page=place.page,
                    anchor=place.anchor,
                ),
            )
        )
    return found
