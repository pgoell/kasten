"""The todo store as MCP tools: search, add, change, set a state and complete (#2191).

Each write runs the store's rules, the ones the todo pane's writes run, recorded as the agent's.
Their docstrings are what models read.
"""

import logging
from datetime import date, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal
from zoneinfo import ZoneInfo

from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field
from sqlalchemy.exc import SQLAlchemyError

from kasten_backend import db
from kasten_backend.config import get_settings
from kasten_backend.todos.store.search import Filters, search
from kasten_backend.todos.store.writes import (
    EDITABLE,
    MissingError,
    RefusedError,
    StaleError,
    Writes,
    placed,
    plain,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

State = Literal["open", "doing", "review", "done", "blocked", "waiting", "rejected"]
Priority = Literal["highest", "high", "medium", "low", "lowest"]
SHOWN = (
    *("id", "words", "description", "state", "tags", "priority", "due", "due_hard", "planned"),
    *("hold_until", "look_again", "waiting_on", "waiting_since", "project", "note", "parent_id"),
    *("epic", "epic_id", "blocked_by", "repeat", "estimate", "worked", "created", "done"),
    "version",
)


def _shown(row: Any) -> dict[str, Any]:
    values = plain(row)
    return {key: values[key] for key in SHOWN}


async def _run(work: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    try:
        async with db.session() as session:
            return await work(session)
    except MissingError as error:
        raise ToolError(f"No todo has the id {error}.") from error
    except (RefusedError, StaleError) as error:
        raise ToolError(f"Refused: {error}. Search the todo again for its version.") from error
    except SQLAlchemyError as failed:
        logger.exception("A todo tool failed on the database")
        raise ToolError("The todos could not be reached just now") from failed


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().timezone)).date()


async def _write(work: Callable[[Writes], Awaitable[Any]]) -> list[dict[str, Any]]:
    async def run(session: AsyncSession) -> list[dict[str, Any]]:
        writes = Writes(session, "agent", _today())
        await work(writes)
        rows = await writes.done()
        await session.commit()
        return [_shown(row) for row in rows]

    return await _run(run)


async def search_todos(  # noqa: PLR0913, PLR0917  one argument per field a model may set
    words: Annotated[str | None, Field(description="Text in the todo, any case.")] = None,
    state: list[State] | None = None,
    tag: Annotated[str | None, Field(description="`#money` or `p/trip`; nested match.")] = None,
    kind: Literal["client", "internal", "private"] | None = None,
    project: Annotated[str | None, Field(description='A folder: "02 Projects/Trip".')] = None,
    epic: Annotated[str | None, Field(description="An epic's id: its todos and parts.")] = None,
    parent: Annotated[str | None, Field(description="A todo's id: its parts, any depth.")] = None,
    priority: list[Priority | Literal["none"]] | None = None,
    due_by: Annotated[date | None, Field(description="Due on or before.")] = None,
    planned_on: Annotated[date | None, Field(description="Planned for that day.")] = None,
    look_again_by: Annotated[date | None, Field(description="Waits due a look by.")] = None,
    waiting: bool | None = None,
    shown_on: Annotated[
        date | None, Field(description="Only what that day's lists show: no hold, no early wait.")
    ] = None,
    done_from: Annotated[date | None, Field(description="Done on or after.")] = None,
    done_to: Annotated[date | None, Field(description="Done on or before.")] = None,
    archive: bool = False,
    sort: Annotated[
        Literal["place", "priority", "due", "planned", "created"],
        Field(description="priority puts none between medium and low."),
    ] = "priority",
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Find todos; every filter is optional and they combine. Pass `version` to change_todo."""
    settings = get_settings()
    filters = Filters(
        state=tuple(state or ()),
        words=words,
        tag=tag,
        kind=kind,
        project=project,
        epic=epic,
        parent=parent,
        priority=tuple(priority or ()),
        due_by=due_by,
        planned_on=planned_on,
        look_again_by=look_again_by,
        waiting=waiting,
        shown_on=shown_on,
        done_from=done_from,
        done_to=done_to,
        archive=None if archive else settings.archive_path,
        sort=sort,
        limit=max(1, min(limit, 500)),
    )
    return await _run(lambda session: _found(session, filters))


async def _found(session: AsyncSession, filters: Filters) -> list[dict[str, Any]]:
    return [_shown(row) for row in await search(session, filters)]


async def add_todo(  # noqa: PLR0913, PLR0917  one argument per field a model may set
    words: str,
    description: Annotated[str | None, Field(description="Text under the words.")] = None,
    due: Annotated[date | None, Field(description="Must be done by; soft unless due_hard.")] = None,
    due_hard: bool = False,
    planned: Annotated[date | None, Field(description="The day you mean to do it.")] = None,
    hold_until: Annotated[date | None, Field(description="No list shows it before.")] = None,
    priority: Priority | None = None,
    parent_id: Annotated[str | None, Field(description="Makes it a part of that todo.")] = None,
    epic_id: Annotated[str | None, Field(description="Counts it toward that epic.")] = None,
    epic: Annotated[bool, Field(description="Marks it as an epic.")] = False,
    project: str | None = None,
    note: str | None = None,
    repeat: Annotated[str | None, Field(description='A rule: "every week".')] = None,
    estimate: Annotated[int | None, Field(description="Minutes.")] = None,
) -> list[dict[str, Any]]:
    """Add an open todo; `words` may carry tags: `call the bank #money #client`.

    With no due date a top todo gets a soft one 14 days out. With no note it goes in
    its parent's note, else today's daily note.
    """
    values = {
        "words": words,
        "description": description,
        "due": due,
        "due_hard": due_hard and due is not None,
        "planned": planned,
        "hold_until": hold_until,
        "priority": priority,
        "parent_id": parent_id,
        "epic_id": epic_id,
        "epic": epic,
        "note": note,
        "repeat": repeat,
        "estimate": estimate,
    } | ({"project": project} if project else {})
    settings = get_settings()

    async def run(writes: Writes) -> None:
        await writes.add(await placed(writes.session, settings, values))

    return await _write(run)


async def change_todo(  # noqa: PLR0913, PLR0917  one argument per field a model may set
    id: str,
    version: int,
    words: str | None = None,
    description: str | None = None,
    due: date | None = None,
    due_hard: bool | None = None,
    planned: date | None = None,
    hold_until: date | None = None,
    priority: Priority | None = None,
    parent_id: str | None = None,
    epic_id: str | None = None,
    epic: bool | None = None,
    project: str | None = None,
    blocked_by: list[str] | None = None,
    repeat: str | None = None,
    estimate: int | None = None,
    clear: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Change a todo read at `version` (from search_todos); a stale one is refused.

    Each field passed is set, each left out stays. To empty a field, name it in
    `clear`, such as ["planned", "priority"]; clearing due gives a soft one 14 days
    out. Answers every todo the change touched.
    """
    passed = {
        "words": words,
        "description": description,
        "due": due,
        "due_hard": due_hard,
        "planned": planned,
        "hold_until": hold_until,
        "priority": priority,
        "parent_id": parent_id,
        "epic_id": epic_id,
        "epic": epic,
        "project": project,
        "blocked_by": blocked_by,
        "repeat": repeat,
        "estimate": estimate,
    }
    values: dict[str, Any] = {key: value for key, value in passed.items() if value is not None}
    values |= {name: None for name in clear or () if name in EDITABLE and name != "words"}
    return await _write(lambda writes: writes.edit(id, version, values))


async def set_todo_state(
    id: str,
    state: State,
    look_again: date | None = None,
    waiting_on: str | None = None,
) -> list[dict[str, Any]]:
    """Put a todo in a state: open, doing, review, done, blocked, waiting or rejected.

    waiting takes who it waits on and a look-again day (7 days out if none); setting
    waiting again with a new look_again chases. rejected drops it. done ticks its open
    parts and moves a repeating todo on to its next round.
    """
    return await _write(
        lambda writes: writes.set_state(id, state, look_again=look_again, waiting_on=waiting_on)
    )


async def complete_todo(id: str) -> list[dict[str, Any]]:
    """Tick a todo done: its open parts too, and a repeating one moves on to its next round."""
    return await _write(lambda writes: writes.set_state(id, "done"))


TOOLS = (search_todos, add_todo, change_todo, set_todo_state, complete_todo)
"""The todo tools, in the order the reference lists them."""

READING = frozenset({"search_todos"})
