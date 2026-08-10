"""FastAPI application entrypoint."""

import asyncio
from importlib.metadata import version
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.events import KEEPALIVE, format_retry, format_sse, watch_vault
from kasten_backend.frontmatter import stamp
from kasten_backend.links import relink_folder_move, relink_note_move
from kasten_backend.search import search_vault
from kasten_backend.todos import find_todos
from kasten_backend.vault import (
    create_note,
    list_markdown_files,
    prune_empty_folders,
    read_note,
    relative_path,
    rename_folder,
    rename_note,
    resolve_folder,
    resolve_folder_path,
    resolve_note,
    resolve_path,
    write_note,
)
from kasten_backend.vcs import begin_change, snapshot

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from kasten_backend.events import VaultEvent

app = FastAPI(title="kasten", version=version("kasten-backend"))
"""The number is read off the installed package rather than written here.

Two copies of it drifted apart once already: the release was cut, the tag moved
and this string did not, so `/docs` reported a version behind the code serving
it. `pyproject.toml` is the one place it lives now, and the deploy workflow
refuses a release whose tag disagrees with it.
"""

KEEPALIVE_SECONDS = 30.0
"""How long a quiet stream waits before writing a line that says nothing.

Long enough to cost nothing, short enough to beat an idle timeout on either
proxy in front of it. The line itself is `KEEPALIVE`, over in `events.py` with
the rest of the wire format.
"""

RECONNECT_SECONDS = 30.0
"""How long the client waits before opening the stream again after it closes.

The browser's own default is about three seconds, and a stream that closes the
moment it opens turns that into a loop: the client relists the vault on every
connection, so a missing vault directory or a watcher that cannot start would
cost twenty relists a minute for as long as the condition holds. This makes it
two. It matches `KEEPALIVE_SECONDS` by coincidence rather than by need.
"""


class Health(BaseModel):
    """Liveness response."""

    status: str


class Note(BaseModel):
    """One note, as it sits on disk."""

    path: str
    """Where the note lives, relative to the vault root."""

    content: str
    """The file's text, unchanged."""


class NoteEdit(BaseModel):
    """The text for a note. The path it belongs to comes from the URL.

    A save carries one and a create may. Both write the same thing, the note's
    text below its block, so both read the same body.
    """

    content: str


class NoteMove(BaseModel):
    """Where a note should live from now on. Where it lives today comes from the URL."""

    path: str


class Folder(BaseModel):
    """One folder, as the vault spells it.

    No content beside the path. A folder is the prefix of the notes under it and
    holds nothing of its own, so there is nothing else to answer with.
    """

    path: str


class FolderMove(BaseModel):
    """Where a folder should live from now on, and every note under it with it."""

    path: str


class SearchHit(BaseModel):
    """One line in the vault that matched, and enough to open the note on it."""

    path: str
    """The note the line is in, relative to the vault root."""

    line: int
    """Which line it is, counting from one, the way an editor counts."""

    text: str
    """The line itself, for the client to show and to rank."""


@app.get("/api/health")
async def health() -> Health:
    """Report that the process is up. Deliberately does not touch the database."""
    return Health(status="ok")


@app.get("/api/files")
async def list_files(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """List every note in the vault as a relative POSIX path, sorted.

    The client folds these into a folder tree; the server stays flat.
    """
    return list_markdown_files(settings.vault_path)


@app.get("/api/terminals")
async def list_terminals(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """Name every herdr session a terminal pane could attach to, sorted.

    A listing of a directory the shell container owns, and nothing more. herdr
    is not run and the sessions are not touched, so this cannot say which are
    running; a name is enough for the prompt, and `herdr --session` attaches to
    a stopped session and starts a missing one alike.

    An absent directory is not an error. The mount is optional and the shell
    container need not be up for the notebook to work, so the prompt falls back
    to a name typed by hand.
    """
    root = settings.herdr_sessions_path
    if not root.is_dir():
        return []
    return sorted(entry.name for entry in root.iterdir() if entry.is_dir())


@app.get("/api/search")
async def search_files(
    q: str, settings: Annotated[Settings, Depends(get_settings)]
) -> list[SearchHit]:
    """Find every line in the vault containing `q`, ignoring case.

    A literal match, not a regex and not a fuzzy one. The client ranks what
    comes back, which is what makes the finder feel fuzzy without asking a
    subsequence match to mean something over prose, where it matches everything.
    """
    hits = await search_vault(settings.vault_path, q)
    return [SearchHit(path=hit.path, line=hit.line, text=hit.text) for hit in hits]


@app.get("/api/todos")
async def list_todos(settings: Annotated[Settings, Depends(get_settings)]) -> list[SearchHit]:
    """Find every checkbox line and every time session line in the vault.

    Candidate lines, not todos. Whether one of these is open, overdue or a
    subtask of the line above it is read on the client, off the same parser the
    editor draws a todo with, so the vault has one reader of the format rather
    than two in two languages.

    Answers in search's shape, which is what lets the overlay rank these through
    the ranking it already has and open a note on the line it found.
    """
    hits = await find_todos(settings.vault_path)
    return [SearchHit(path=hit.path, line=hit.line, text=hit.text) for hit in hits]


@app.get("/api/events")
async def stream_events(settings: Annotated[Settings, Depends(get_settings)]) -> StreamingResponse:
    """Report every change to the vault, kasten's own writes included.

    Server-sent events, one `data:` line per changed note. The traffic runs one
    way, so this needs none of a WebSocket's machinery, and the browser
    reconnects on its own.

    Nothing here knows which write was kasten's, and nothing tries to: the
    digest is what settles that at the other end, where the client holds the
    text it sent and can see its own save come back.

    The stream carries no note text, only the path, what happened and a digest
    of what is now on disk. A client that wants the new content reads the note
    the way it always does.

    The watcher lives as long as the connection. Starlette closes this generator
    when the client goes away, which ends the watch with it, so nothing is left
    running for a reader that has gone.
    """

    async def report() -> AsyncIterator[str]:
        # Before the watcher is even asked for, because both of the ways this
        # stream closes early close it before anything else could be written,
        # and those are the two that make the number matter.
        yield format_retry(RECONNECT_SECONDS)

        # The watcher fills a queue from a task of its own rather than being
        # read directly, so the wait below can time out without touching it.
        # Cancelling a generator's `__anext__` is what a timeout does, and
        # `awatch` answers that by ending, which would trade a live watcher for
        # every keepalive written.
        batches: asyncio.Queue[list[VaultEvent] | None] = asyncio.Queue()

        async def collect() -> None:
            try:
                async for events in watch_vault(settings.vault_path):
                    batches.put_nowait(events)
            finally:
                # Every way out of the watcher has to end up here, a raise as
                # much as a return. A stream that keeps writing keepalives over
                # a watcher that died looks healthier than one that closed, and
                # `EventSource` reconnects from closed and never from this. The
                # silence would be exactly the loss this endpoint exists to
                # prevent, and an exhausted inotify limit is enough to cause it.
                batches.put_nowait(None)

        watching = asyncio.create_task(collect())
        try:
            while True:
                try:
                    events = await asyncio.wait_for(batches.get(), KEEPALIVE_SECONDS)
                except TimeoutError:
                    yield KEEPALIVE
                    continue

                if events is None:
                    # Awaited rather than dropped, so a watcher that fell over
                    # says why in the log on its way out. It raises here, which
                    # closes the stream just as returning would.
                    await watching
                    return

                for event in events:
                    yield format_sse(event)
        finally:
            watching.cancel()

    return StreamingResponse(report(), media_type="text/event-stream")


@app.get("/api/files/{path:path}")
async def read_file(path: str, settings: Annotated[Settings, Depends(get_settings)]) -> Note:
    """Read one note out of the vault.

    Anything that is not a readable markdown file inside the vault is a 404,
    including paths that try to climb out of it.
    """
    content = read_note(settings.vault_path, path)
    if content is None:
        raise HTTPException(status_code=404, detail="No such note")

    return Note(path=path, content=content)


@app.post("/api/files/{path:path}", status_code=201)
async def create_file(
    path: str,
    settings: Annotated[Settings, Depends(get_settings)],
    edit: NoteEdit | None = None,
) -> Note:
    """Start a new note in the vault, empty unless a body comes with it.

    This one says why it refused, unlike the read and the write: a 409 for a
    path already taken and a 400 for one the vault will not have. The user is
    about to retype the path and has to know which it was, and the one user
    behind oauth2-proxy learns nothing from a 409 that `GET /api/files` did not
    already hand them.

    The path that comes back is the canonical spelling, not the URL's, because
    the client navigates to it and `ideas/./kasten.md` must not end up in the
    address bar.

    The note starts with its frontmatter, so it has an id from the first moment
    it exists rather than from its first save. A body is written under that
    block and is stamped on the way through, the way a save's text is, so a
    body carrying a block of its own keeps the fields in it.

    The body is optional because most creates have nothing to write: a note the
    reader is about to type is one they type themselves. It exists for the
    client that already knows the text, the periodic notes above all, which
    would otherwise have to save straight over the note they just made. That
    second write is a second event on `/api/events`, and one arriving while the
    reader types into the note it names reads as another writer.

    The new note gets its own jj change, bracketed the way a save is. Both
    refusals return before any of that, so a bounced create leaves no change
    behind.
    """
    note = resolve_path(settings.vault_path, path)
    if note is None:
        raise HTTPException(status_code=400, detail="The vault will not take that path")
    if note.exists():
        raise HTTPException(status_code=409, detail="A note is already there")

    relative = relative_path(settings.vault_path, note)
    content = stamp(edit.content if edit else "")

    await begin_change(settings.vault_path, relative)
    create_note(note, content)
    await snapshot(settings.vault_path)

    return Note(path=relative, content=content)


@app.put("/api/files/{path:path}")
async def save_file(
    path: str, edit: NoteEdit, settings: Annotated[Settings, Depends(get_settings)]
) -> Note:
    """Write one note back to the vault.

    Only over a note that is already there. Everything the read refuses is
    refused here too, and for the same reason, so a note you cannot open is a
    note you cannot overwrite.

    The text is stamped on the way through, which dates the note and gives one
    written before kasten its id. The note on disk is read for that, so the id
    it already has outlives a client that sends the note back without one. What
    comes back is therefore what landed on disk rather than what arrived, and it
    is the only thing the client may believe: its own copy is a save behind from
    the moment it sends it.

    The jj change is started before the write and the snapshot taken after, so
    the edit is bracketed by the history rather than trailing it. A vault that
    is not a jj repo skips both.
    """
    note = resolve_note(settings.vault_path, path)
    if note is None:
        raise HTTPException(status_code=404, detail="No such note")

    content = stamp(edit.content, note.read_text(encoding="utf-8"))

    await begin_change(settings.vault_path, relative_path(settings.vault_path, note))
    write_note(note, content)
    await snapshot(settings.vault_path)

    return Note(path=path, content=content)


@app.patch("/api/files/{path:path}")
async def move_file(
    path: str, move: NoteMove, settings: Annotated[Settings, Depends(get_settings)]
) -> Note:
    """Give one note a new path, moving it between folders as well as renaming it.

    `PATCH` rather than a `/rename` route because the path is the note's
    identity: `POST` starts a note, `PUT` replaces its text, and this changes
    where it lives. A verb in the URL would be the same thing spelled as a
    remote procedure call.

    A missing source is a 404, matching the read and the write, so a note you
    cannot open stays a note you cannot move. The target names its refusal the
    way a create does, a 400 for a path the vault will not have and a 409 for
    one already taken, because the user is about to retype it and has to know
    which it was.

    The text comes back read off disk rather than carried over from the client.
    Both the URL and the query key change on a move, and seeding the new one
    from here is what stops a note edited outside kasten arriving stale on the
    other side.
    """
    note = resolve_note(settings.vault_path, path)
    if note is None:
        raise HTTPException(status_code=404, detail="No such note")

    target = resolve_path(settings.vault_path, move.path)
    if target is None:
        raise HTTPException(status_code=400, detail="The vault will not take that path")
    if target.exists():
        raise HTTPException(status_code=409, detail="A note is already there")

    relative = relative_path(settings.vault_path, target)

    await begin_change(settings.vault_path, relative)
    # Before the move, because a bare `[[borges]]` only names this note while
    # the note is still where the links were written to find it. Inside the jj
    # bracket, because the rewritten links are part of the move rather than an
    # edit that happened to follow it.
    await relink_note_move(settings.vault_path, relative_path(settings.vault_path, note), relative)
    rename_note(note, target)
    prune_empty_folders(settings.vault_path, note.parent)
    await snapshot(settings.vault_path)

    return Note(path=relative, content=target.read_text(encoding="utf-8"))


@app.patch("/api/folders/{path:path}")
async def move_folder(
    path: str, move: FolderMove, settings: Annotated[Settings, Depends(get_settings)]
) -> Folder:
    """Give one folder a new path, and every note under it a new path with it.

    Its own route rather than the one above, because a folder is not a note and
    `/api/files/inbox` cannot mean the folder on a `PATCH` and nothing at all on
    a `GET`. What the two share is the shape: the URL says where it lives now,
    the body where it should live from here on.

    The refusals are the note's, read for a folder. A source that is not a
    folder is a 404, a note at that path included, so the one way to move a note
    stays the route above. The target names its refusal, a 400 for a path the
    vault will not have and a 409 for one already taken, because the user is
    about to retype it.

    A target inside the source is a 400 too. A folder cannot hold itself, and
    `rename` raises on that rather than refusing, so it is caught here with the
    rest.

    No content comes back. The notes under the folder are at new paths now, but
    they are unchanged, and the client works out where they went from the folder
    path alone.
    """
    folder = resolve_folder(settings.vault_path, path)
    if folder is None:
        raise HTTPException(status_code=404, detail="No such folder")

    target = resolve_folder_path(settings.vault_path, move.path)
    if target is None or target.is_relative_to(folder):
        raise HTTPException(status_code=400, detail="The vault will not take that path")
    if target.exists():
        raise HTTPException(status_code=409, detail="Something is already there")

    relative = relative_path(settings.vault_path, target)

    # The trailing slash is what tells one of these apart from a note's change
    # in `jj log`, where the two would otherwise read the same.
    await begin_change(settings.vault_path, f"{relative}/")
    # Before the move, the way a note's rewrite is, and for one reason more: the
    # notes holding these links are often the ones inside the folder, and after
    # the rename none of them is at the path the rewrite would write to.
    await relink_folder_move(
        settings.vault_path, relative_path(settings.vault_path, folder), relative
    )
    rename_folder(folder, target)
    prune_empty_folders(settings.vault_path, folder.parent)
    await snapshot(settings.vault_path)

    return Folder(path=relative)
