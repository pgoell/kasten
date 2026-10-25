"""Routes that query the vault's notes: search, mentions, history, todos, cards, tags, graph."""

import asyncio
from datetime import date, timedelta
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from kasten_backend.cards import find_cards
from kasten_backend.config import Settings, get_settings
from kasten_backend.graph import MOST_DEPTH, Graph, GraphError
from kasten_backend.graph_query import query_graph
from kasten_backend.history import HistoryError, list_changes, plain, read_version
from kasten_backend.log import DATE_PATTERN
from kasten_backend.mentions import find_mentions
from kasten_backend.search import search_vault
from kasten_backend.search_meta import day_of, notes_meta
from kasten_backend.tags import find_tags
from kasten_backend.todos import find_todos, projects_of
from kasten_backend.vault import (
    list_markdown_files,
    read_note,
    relative_path,
    resolve_note,
    resolve_path,
)

if TYPE_CHECKING:
    from pathlib import Path

router = APIRouter()

EXTRA_DAY = timedelta(days=1)
"""How far past each end of `from` and `to` a written day may fall and still be answered.

An instant is a different local day for the reader, so the client drops what
falls outside its own days. The extra day each side is what it works from.
"""


class LineHit(BaseModel):
    """One line in the vault, and enough to open the note on it."""

    path: str
    """The note the line is in, relative to the vault root."""

    line: int
    """Which line it is, counting from one, the way an editor counts."""

    text: str
    """The line itself, for the client to show and to rank."""


class SearchHit(LineHit):
    """One line that matched a search, with the date and tags of the note it is in."""

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


class TodoHit(LineHit):
    """One todo line, or one running session line, and the project it belongs to."""

    project: str | None
    """The project folder, `02 Projects/FDE`, by the rule `todos.projects_of` reads.

    Its own model rather than a field on `LineHit`, which the cards answer with
    too and which have no project to give.
    """


class Mention(BaseModel):
    """One place another note names this one in plain text, without linking to it."""

    path: str
    """The note the mention is in, relative to the vault root."""

    line: int
    """Which line it is, counting from one, the way an editor counts."""

    text: str
    """The whole line, as `GET /api/files` serves the note, so a `\\r\\n` ends it as `\\n` does."""

    start: int
    """Where the mention begins in `text`, in UTF-16 code units.

    UTF-16 because that is what the client slices a string in, so an emoji
    earlier on the line does not push the highlight off the word.
    """

    end: int
    """Where the mention ends in `text`, in UTF-16 code units."""

    name: str
    """Which name matched, the title or an alias, spelled the way the note spells it."""


class HistoryChange(BaseModel):
    """One jj change that touched a note."""

    commit: str
    """The commit id, 40 hex digits, which is what reads the note's text back."""

    change: str
    """The short change id, the name `jj log` shows."""

    time: str
    """When it was last written, ISO 8601 with the offset."""

    description: str
    """The first line of the change's description."""

    path: str
    """Where the note was in that change, which differs from now across a move."""


class History(BaseModel):
    """A note's changes, newest first, and whether the vault keeps any at all."""

    versioned: bool
    changes: list[HistoryChange]


class Version(BaseModel):
    """A note's full text at one change."""

    content: str


class ReviewLimits(BaseModel):
    """The daily limits a deck falls back on, None meaning no limit."""

    new_per_day: int | None
    reviews_per_day: int | None


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


@router.get("/api/mentions")
async def list_mentions(
    path: str, settings: Annotated[Settings, Depends(get_settings)], archive: bool = False
) -> list[Mention]:
    """Find every line in another note that names this one in plain text.

    Obsidian's unlinked mentions: the note's title and its aliases, whole and
    ignoring case, outside links, code and frontmatter. What the backlinks pane
    lists under the links, so one key can turn a mention into a link.

    `archive` walks the archive folder too, off by default as on a search.
    """
    note = resolve_note(settings.vault_path, path)
    if note is None:
        raise HTTPException(status_code=404, detail="No such note")

    found = await find_mentions(
        settings.vault_path,
        relative_path(settings.vault_path, note),
        note.read_text(encoding="utf-8"),
        None if archive else settings.archive_path,
    )
    return [Mention(**mention._asdict()) for mention in found]


def history_path(root: Path, path: str) -> str:
    """The vault's own spelling of a note path, or a 404 for one it would not take.

    The note need not exist now: the history pane reads it at the path it had
    before a move.
    """
    note = resolve_path(root, path)
    if note is None or not plain(path):
        raise HTTPException(status_code=404, detail="No such note")

    return relative_path(root, note)


@router.get("/api/history")
async def read_history(path: str, settings: Annotated[Settings, Depends(get_settings)]) -> History:
    """List the jj changes that touched a note, newest first, following it through moves.

    A vault that is not a repo, or a box without jj, answers `versioned: false`
    rather than an error, the history being a thing the vault may not keep.
    """
    try:
        changes = await list_changes(settings.vault_path, history_path(settings.vault_path, path))
    except HistoryError as error:
        raise HTTPException(status_code=503, detail="The note's history is out of reach") from error

    if changes is None:
        return History(versioned=False, changes=[])

    return History(
        versioned=True, changes=[HistoryChange(**change._asdict()) for change in changes]
    )


@router.get("/api/history/version")
async def read_history_version(
    path: str,
    commit: Annotated[str, Query(pattern=r"^[0-9a-f]{40}$")],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Version:
    """Read a note's text at one of the changes `/api/history` listed.

    `path` is the one that change lists, which is not the note's path now when
    a move came after it. The pattern on `commit` is what keeps anything but a
    commit id out of the revset.
    """
    try:
        content = await read_version(
            settings.vault_path, history_path(settings.vault_path, path), commit
        )
    except HistoryError as error:
        raise HTTPException(status_code=503, detail="The note's history is out of reach") from error

    if content is None:
        raise HTTPException(status_code=404, detail="No such version")

    return Version(content=content)


@router.get("/api/todos")
async def list_todos(
    settings: Annotated[Settings, Depends(get_settings)], archive: bool = False
) -> list[TodoHit]:
    """Find every checkbox line and every time session line in the vault.

    Candidate lines, not todos. Whether one of these is open or overdue is read
    on the client, off the same parser the editor draws a todo with, so the
    vault has one reader of the format rather than two in two languages.

    The project is the exception, read here off each line's indent, tags and
    links by `projects_of`, so an agent reading this sees the lane the board
    draws without a copy of the rule. The links resolve against the notes
    `GET /api/files` lists, the archive among them.

    Answers in search's shape plus the project, which is what lets the overlay
    rank these through the ranking it already has and open a note on the line it
    found.

    `archive` walks the archive folder too, and is off for the reason it is off
    on a search: a finished project's open checkboxes are true of the note and
    false of the week.
    """
    hits = await find_todos(settings.vault_path, None if archive else settings.archive_path)
    projects = projects_of(hits, list_markdown_files(settings.vault_path))
    return [
        TodoHit(path=hit.path, line=hit.line, text=hit.text, project=project)
        for hit, project in zip(hits, projects, strict=True)
    ]


@router.get("/api/cards")
async def list_cards(
    settings: Annotated[Settings, Depends(get_settings)], archive: bool = False
) -> list[LineHit]:
    """Find every line in the vault that could be part of a flashcard.

    Candidate lines, not cards. Which of them is a question, which note is a
    deck and which card is due are all read on the client, off the same parser
    the review pane draws a card with, so the vault has one reader of the format
    rather than two in two languages.

    Answers in search's shape, so the client can open the note a card is in on
    the line it sits on.

    `archive` walks the archive folder too, and is off for the reason it is off
    on a search: moving a deck into the archive is how you stop being asked
    about it, and nothing else about the note changes.
    """
    hits = await find_cards(settings.vault_path, None if archive else settings.archive_path)
    return [LineHit(path=hit.path, line=hit.line, text=hit.text) for hit in hits]


def _written_on(root: Path, paths: list[str], first: date, last: date) -> list[str]:
    """The day each of `paths` counts on, where that day falls in the range and a day each side."""
    # Clamped at the calendar's ends, where a day either side would overflow.
    low = (first - EXTRA_DAY if first > date.min else first).isoformat()
    high = (last + EXTRA_DAY if last < date.max else last).isoformat()
    found: list[str] = []
    for path in paths:
        try:
            text = read_note(root, path)
        except UnicodeDecodeError, OSError:
            # A note the client cannot open is still dated by its name and its file.
            text = None
        day = day_of(root, path, text)
        # The first ten characters are the day as written, which an instant starts with too.
        if day is not None and low <= day[:10] <= high:
            found.append(day)
    return sorted(found)


@router.get("/api/written")
async def list_written(
    start: Annotated[str, Query(alias="from", pattern=DATE_PATTERN)],
    end: Annotated[str, Query(alias="to", pattern=DATE_PATTERN)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[str]:
    """The day each note outside the archive counts on, for the notes written from `from` to `to`.

    Each answer is the date a note counts on, as search dates its hits: the name's
    day, else `created`, else the file's modification time. A day is an answer
    as written, and an instant keeps its offset, so the client works out the
    reader's own day. A day either side of the range is answered too, for the
    same reason. Sorted, and read only: nothing is written or stored.
    """
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`from` and `to` must be real dates") from error
    if first > last:
        raise HTTPException(status_code=400, detail="`from` is after `to`")

    archive = f"{settings.archive_path}/"
    paths = [
        path for path in list_markdown_files(settings.vault_path) if not path.startswith(archive)
    ]
    return await asyncio.to_thread(_written_on, settings.vault_path, paths, first, last)


@router.get("/api/review/limits")
async def read_review_limits(
    settings: Annotated[Settings, Depends(get_settings)],
) -> ReviewLimits:
    """Name the daily limits a deck gets where the config note sets none.

    Only the default. The per-deck limits live in a note the client reads like
    any other, so the vault holds them and its history shows who changed them.
    """
    return ReviewLimits(
        new_per_day=settings.review_new_per_day,
        reviews_per_day=settings.review_reviews_per_day,
    )


@router.get("/api/tags")
async def list_tags(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """Every tag written anywhere in the vault, once each, sorted.

    The vocabulary and nothing else: which notes hold a tag is a search, and this
    is what the editor completes an open `#` from.
    """
    return await find_tags(settings.vault_path)


@router.get("/api/graph")
async def show_graph(
    settings: Annotated[Settings, Depends(get_settings)],
    q: str = "",
    around: str | None = None,
    depth: Annotated[int, Query(ge=0, le=MOST_DEPTH)] = 1,
    archive: bool = False,
) -> Graph:
    """The notes as a graph, narrowed by a filter or asked a pattern.

    The query is text and the backend reads it, so the pane, this route and the
    agent's tool share one parser. `around` names a note and draws only what is
    within `depth` links of it, which is the local graph. A query that cannot
    be read is a 400 whose detail says why, in words the pane shows as they are.

    `archive` walks the archive folder too, off for the reason it is off on a
    search: a finished project's links are true of the note and not of the
    vault as it is now.
    """
    try:
        return await query_graph(
            settings.vault_path, q, around, depth, None if archive else settings.archive_path
        )
    except GraphError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
