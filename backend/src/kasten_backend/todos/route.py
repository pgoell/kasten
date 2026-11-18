"""The todo store over HTTP: read the rows, add, change, set a state, walk, time and delete.

`GET /api/todos` still answers the vault's lines until the pane moves here (#2191).
"""

from datetime import date, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import vault
from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.todos.lines import read
from kasten_backend.todos.models import Todo, TodoChange
from kasten_backend.todos.store import MissingError, StaleError, Writes, plain, tags_of

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
    from_day: date | None = None
    deadline: date | None = None
    deadline_hard: bool | None = None
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
    blocked_by: list[str]
    repeat: str | None
    on_completion: str | None
    priority: Priority | None
    from_day: date | None
    deadline: date | None
    deadline_hard: bool
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
    except StaleError as error:
        raise HTTPException(409, f"{error} changed since it was read: read it again.") from error
    rows = await writes.done()
    await session.commit()
    return _out(rows)


@router.get("/rows")
async def list_rows(
    session: Session, settings: VaultSettings, archive: bool = False
) -> list[TodoOut]:
    """Every todo in the store, the archive's only with `archive`, in note and sibling order."""
    query = select(Todo).order_by(Todo.note, Todo.parent_id, Todo.position, Todo.created)
    if not archive:
        folder = settings.archive_path.rstrip("/") + "/"
        query = query.where(
            or_(Todo.note.is_(None), ~Todo.note.startswith(folder, autoescape=True))
        )
    return _out(list((await session.scalars(query)).all()))


@router.post("", status_code=201)
async def add_todo(body: NewTodo, session: Session, settings: VaultSettings) -> TodoOut:
    """Add an open todo, created today, with a soft deadline in 14 days unless it names one."""
    values = body.model_dump(exclude_unset=True)
    if "project" not in values:
        values["project"] = await _project(session, settings, body)
    rows = await _write(session, settings, lambda writes: writes.add(values))
    return rows[0]


async def _project(session: AsyncSession, settings: Settings, body: NewTodo) -> str | None:
    """A `#p/x` tag's project folder, else the parent's project, else none."""
    folders = read.project_folders(vault.list_markdown_files(settings.vault_path))
    tagged = read.project_by_tag(tags_of(body.words), folders)
    parent = None if body.parent_id is None else await session.get(Todo, body.parent_id)
    return tagged or (None if parent is None else parent.project)


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


@router.get("/{todo_id}/history")
async def history(todo_id: str, session: Session) -> list[ChangeOut]:
    """Every write to a todo, oldest first."""
    query = select(TodoChange).where(TodoChange.todo_id == todo_id).order_by(TodoChange.id)
    return [
        ChangeOut(at=one.at, by=one.by, before=one.before, after=one.after)
        for one in (await session.scalars(query)).all()
    ]
