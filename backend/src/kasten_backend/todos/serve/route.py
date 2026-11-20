"""The todo store over HTTP: search, add, change, set a state, walk, time and delete (#2191).

`GET /api/todos` answers each todo as the line the app parses, rendered from its row.
"""

from datetime import date, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import vault
from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.todos import hits, importer
from kasten_backend.todos.lines import read
from kasten_backend.todos.store.models import Todo, TodoChange, TodoSession
from kasten_backend.todos.store.search import Filters, Sort, search
from kasten_backend.todos.store.writes import (
    MissingError,
    RefusedError,
    StaleError,
    Writes,
    placed,
    plain,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

router = APIRouter(prefix="/api/todos")

Session = Annotated[AsyncSession, Depends(get_session)]
VaultSettings = Annotated[Settings, Depends(get_settings)]
State = Literal["open", "doing", "review", "done", "blocked", "waiting", "rejected"]
Priority = Literal["highest", "high", "medium", "low", "lowest"]


class Fields(BaseModel):
    """The fields a caller may set; each one left out stays as it is."""

    model_config = ConfigDict(extra="forbid")

    priority: Priority | None = None
    planned: date | None = None
    hold_until: date | None = None
    epic: bool = False
    epic_id: str | None = None
    due: date | None = None
    due_hard: bool | None = None
    repeat: str | None = None
    estimate: int | None = Field(default=None, ge=0)
    assignee: str | None = None
    waiting_on: str | None = None
    look_again: date | None = None
    blocked_by: list[str] | None = None
    remind_at: AwareDatetime | None = None
    parent_id: str | None = None
    project: str | None = None
    note: str | None = None
    shared_list: str | None = None


class NewTodo(Fields):
    """A todo to add: its words, and any field it starts with."""

    words: str = Field(min_length=1)


class Change(Fields):
    """A change to a todo read at `version`; a stale version answers 409."""

    words: str | None = Field(default=None, min_length=1)
    version: int


class StateChange(BaseModel):
    """A state to put a todo in; a wait may name its look-again day and who it waits on."""

    state: State
    look_again: date | None = None
    waiting_on: str | None = None


class TodoOut(BaseModel):
    """One todo as the store holds it."""

    id: str
    words: str
    state: State
    tags: list[str]
    note: str | None
    shared_list: str | None
    project: str | None
    parent_id: str | None
    position: int
    round_of: str | None
    epic: bool
    epic_id: str | None
    blocked_by: list[str]
    repeat: str | None
    on_completion: str | None
    priority: Priority | None
    planned: date | None
    hold_until: date | None
    due: date | None
    due_hard: bool
    assignee: str | None
    waiting_on: str | None
    waiting_since: date | None
    look_again: date | None
    remind_at: datetime | None
    estimate: int | None
    worked: int | None
    created: date
    done: date | None
    cancelled: date | None
    updated: datetime
    version: int


class ChangeOut(BaseModel):
    """One write to a todo: who, when, and the row before and after (None for none)."""

    at: datetime
    by: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None


def _today(settings: Settings) -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


def _out(rows: list[Todo]) -> list[TodoOut]:
    return [TodoOut.model_validate(plain(row)) for row in rows]


async def _write(
    session: AsyncSession, settings: Settings, run: Callable[[Writes], Awaitable[object]]
) -> list[TodoOut]:
    """Run one write as the browser's, commit it, and answer every row it touched."""
    writes = Writes(session, "browser", _today(settings))
    try:
        await run(writes)
    except MissingError as error:
        raise HTTPException(404, f"No todo has the id {error}.") from error
    except RefusedError as error:
        raise HTTPException(422, str(error)) from error
    except StaleError as error:
        raise HTTPException(409, f"{error} changed since it was read: read it again.") from error
    rows = await writes.done()
    await session.commit()
    return _out(rows)


class Search(BaseModel):
    """What a search keeps: each filter left out keeps everything."""

    model_config = ConfigDict(extra="forbid")

    state: list[State] = []
    words: str | None = None
    tag: str | None = None
    kind: str | None = None
    project: str | None = None
    epic: str | None = None
    parent: str | None = None
    priority: list[Priority | Literal["none"]] = []
    due_by: date | None = None
    planned_on: date | None = None
    planned_by: date | None = None
    hold_until_by: date | None = None
    waiting: bool | None = None
    look_again_by: date | None = None
    shown_on: date | None = None
    note: str | None = None
    shared_list: str | None = None
    archive: bool = False
    sort: Sort = "place"
    limit: int | None = Field(default=None, ge=1)


def filters_of(body: Search, settings: Settings) -> Filters:
    """The store's filters for a search; the archive is left out unless asked for."""
    values = body.model_dump(exclude={"archive"})
    values["state"] = tuple(body.state)
    values["priority"] = tuple(body.priority)
    return Filters(**values, archive=None if body.archive else settings.archive_path)


class TodoHit(BaseModel):
    """One todo as the line the app reads, or one running timer as its `## Time` line.

    `todo` is the row behind a todo line: the fields a line cannot carry, such as its
    parent, epic, version and whether its due date is hard.
    """

    path: str
    line: int
    text: str
    project: str | None
    shared: bool
    todo: TodoOut | None = None


@router.get("/rows")
async def list_rows(
    session: Session, settings: VaultSettings, body: Annotated[Search, Query()]
) -> list[TodoOut]:
    """The todos a search keeps, in note and sibling order unless it names a sort."""
    return _out(await search(session, filters_of(body, settings)))


@router.get("")
async def list_todos(
    session: Session, settings: VaultSettings, body: Annotated[Search, Query()]
) -> list[TodoHit]:
    """The todos a search keeps as lines, parts under their parent; unfiltered, the timers too."""
    rows = await search(session, filters_of(body, settings))
    found = [
        TodoHit(
            path=hit["path"],
            line=hit["line"],
            text=hit["text"],
            project=hit["row"].project,
            shared=hit["row"].shared_list is not None,
            todo=TodoOut.model_validate(plain(hit["row"])),
        )
        for hit in hits.as_hits(rows, settings)
    ]
    if body.model_dump(exclude={"archive"}) == Search().model_dump(exclude={"archive"}):
        running = select(TodoSession, Todo).join(Todo).where(TodoSession.ended.is_(None))
        pairs = [(one, row) for one, row in (await session.execute(running)).all()]
        found += [
            TodoHit(**hit, project=None, shared=False) for hit in hits.session_hits(pairs, settings)
        ]
    return found


class Line(BaseModel):
    """A todo line as typed, `- [ ] words 📅 2026-12-01`; a bare line of words is open."""

    # Bounded: the field patterns backtrack on a long run of tabs (CodeQL).
    text: str = Field(min_length=1, max_length=2000)


class NewLine(Line):
    """A typed line to add, in a note or under a parent; with neither, today's daily note."""

    note: str | None = None
    parent_id: str | None = None


@router.post("/line", status_code=201)
async def add_line(body: NewLine, session: Session, settings: VaultSettings) -> list[TodoOut]:
    """Add the todo a typed line says, in the state its box names."""
    values = hits.values_of(body.text, None, _today(settings), settings.timezone)
    state = values.pop("state")
    values |= {"note": body.note, "parent_id": body.parent_id}
    values = await placed(session, settings, values)

    async def run(writes: Writes) -> None:
        row = await writes.add(values)
        if state != "open":
            await writes.session.flush()
            await writes.set_state(row.id, state)

    return await _write(session, settings, run)


class EditedLine(Line):
    """A todo's edited line, typed over the todo read at `version`; a stale one answers 409."""

    version: int


async def _project_of_edit(
    writes: Writes, settings: Settings, row: Todo, values: dict[str, Any]
) -> list[tuple[Todo, str | None]]:
    """Give the todo the project the board's order reads off its edited line, if it changes (#2249).

    Answers each part whose project that order gave it and now gives another, with the new one.
    """
    paths = vault.list_markdown_files(settings.vault_path)
    tagged, parent, up = None, None, row.parent_id
    while up is not None:
        above = await writes.get(up)
        parent, up = parent or above, above.parent_id
        tagged = tagged or read.tag_project(above.words, paths)
    inherited = (tagged, parent.project if parent else None)
    was = read.named_project(row.words, row.note, paths, inherited)
    now = read.named_project(values["words"], row.note, paths, inherited)
    if was == now:
        return []
    values["project"] = now
    own = (read.tag_project(row.words, paths), read.tag_project(values["words"], paths))
    tags = {row.id: (own[0] or tagged, own[1] or tagged)}
    projects = {row.id: (row.project, now)}
    moved: list[tuple[Todo, str | None]] = []
    for part in await writes.parts(row):
        tag, project, mine = tags[part.parent_id or ""], projects[part.parent_id or ""], None
        old, new = (
            read.named_project(part.words, part.note, paths, (tag[at], project[at]))
            for at in (0, 1)
        )
        if part.project == old != new:
            moved.append((part, new))
            mine = new
        own_tag = read.tag_project(part.words, paths)
        tags[part.id] = (own_tag or tag[0], own_tag or tag[1])
        projects[part.id] = (part.project, mine or part.project)
    return moved


@router.put("/{todo_id}/line")
async def change_line(
    todo_id: str, body: EditedLine, session: Session, settings: VaultSettings
) -> list[TodoOut]:
    """Change a todo to what its edited line says: words, fields, and the state its box names."""

    async def run(writes: Writes) -> None:
        row = await writes.get(todo_id)
        values = hits.values_of(body.text, row, writes.today, settings.timezone)
        state, was = values.pop("state"), row.state
        parts = await _project_of_edit(writes, settings, row, values)
        await writes.edit(todo_id, body.version, values)
        for part, project in parts:
            await writes.edit(part.id, part.version, {"project": project})
        # Against the state read, not the edited one: a box left as it was changes nothing.
        if state != was:
            await writes.set_state(todo_id, state)

    return await _write(session, settings, run)


@router.post("", status_code=201)
async def add_todo(body: NewTodo, session: Session, settings: VaultSettings) -> TodoOut:
    """Add an open todo, created today, with a soft due date in 14 days unless it names one."""
    values = await placed(session, settings, body.model_dump(exclude_unset=True))
    rows = await _write(session, settings, lambda writes: writes.add(values))
    return rows[0]


@router.patch("/{todo_id}")
async def change_todo(
    todo_id: str, body: Change, session: Session, settings: VaultSettings
) -> list[TodoOut]:
    """Change a todo's fields; answers every row the change touched."""
    values = body.model_dump(exclude_unset=True, exclude={"version"})
    return await _write(
        session, settings, lambda writes: writes.edit(todo_id, body.version, values)
    )


@router.post("/{todo_id}/state")
async def set_state(
    todo_id: str, body: StateChange, session: Session, settings: VaultSettings
) -> list[TodoOut]:
    """Put a todo in a state, with its stamps, its parts, its next round and its dependents."""
    return await _write(
        session,
        settings,
        lambda writes: writes.set_state(
            todo_id, body.state, look_again=body.look_again, waiting_on=body.waiting_on
        ),
    )


@router.post("/{todo_id}/cycle")
async def cycle_todo(todo_id: str, session: Session, settings: VaultSettings) -> list[TodoOut]:
    """Walk a todo one step: open, doing, done, open; a hold picks up at doing."""
    return await _write(session, settings, lambda writes: writes.cycle(todo_id))


@router.post("/{todo_id}/timer")
async def toggle_timer(todo_id: str, session: Session, settings: VaultSettings) -> list[TodoOut]:
    """Start a session on a todo, or stop every one it has running and total them."""
    now = datetime.now(ZoneInfo(settings.timezone))
    return await _write(session, settings, lambda writes: writes.timer(todo_id, now))


@router.delete("/{todo_id}", status_code=204)
async def delete_todo(todo_id: str, session: Session, settings: VaultSettings) -> Response:
    """Delete a todo and its parts; its history stays."""
    await _write(session, settings, lambda writes: writes.delete(todo_id))
    return Response(status_code=204)


class ImportOut(BaseModel):
    """What the import did, or would do: the counts it checks."""

    report: str
    written: bool


@router.post("/import")
async def import_lines(session: Session, settings: VaultSettings, write: bool = False) -> ImportOut:
    """Move the vault's todo lines into the store, or with no `write` report what that would do.

    Run through the backend, so it holds the same vault lock every save does.
    """
    report = await importer.run(settings, session, dry=not write)
    return ImportOut(report=report, written=write)


@router.get("/{todo_id}/history")
async def history(todo_id: str, session: Session) -> list[ChangeOut]:
    """Every write to a todo, oldest first."""
    query = select(TodoChange).where(TodoChange.todo_id == todo_id).order_by(TodoChange.id)
    return [
        ChangeOut(at=one.at, by=one.by, before=one.before, after=one.after)
        for one in (await session.scalars(query)).all()
    ]
