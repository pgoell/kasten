"""The day plan, the week's outcomes and the planning brief, over HTTP and as MCP tools (#2191)."""

from datetime import date, datetime, time
from typing import TYPE_CHECKING, Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import db
from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.todos.plan import brief as briefing
from kasten_backend.todos.plan.days import (
    Block,
    PlanRefusedError,
    read_outcomes,
    read_plan,
    save_outcomes,
    save_plan,
)
from kasten_backend.todos.store.writes import MissingError, Writes

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

router = APIRouter(prefix="/api")

Session = Annotated[AsyncSession, Depends(get_session)]
VaultSettings = Annotated[Settings, Depends(get_settings)]


class PlanBlockIn(BaseModel):
    """A block of the day: when, focus or batch, what it is for, and the todos picked for it."""

    starts: time
    ends: time
    kind: Literal["focus", "batch"]
    title: str = Field(min_length=1)
    todos: list[str] = []


class DayPlanIn(BaseModel):
    """A day's plan; saving replaces the one saved before."""

    blocks: list[PlanBlockIn]


class WeekOutcomeIn(BaseModel):
    """One of the week's outcomes, and the todo that carries it, if one does."""

    words: str = Field(min_length=1)
    todo_id: str | None = None


def _today(settings: Settings) -> date:
    return datetime.now(ZoneInfo(settings.timezone)).date()


async def _save(
    session: AsyncSession, settings: Settings, day: date, blocks: list[PlanBlockIn], by: str
) -> dict[str, Any]:
    writes = Writes(session, by, _today(settings))
    await save_plan(writes, settings, day, [Block(**block.model_dump()) for block in blocks])
    await writes.done()
    await session.commit()
    plan = await read_plan(session, day)
    return {} if plan is None else plan


@router.get("/plans/{day}")
async def get_plan(day: date, session: Session) -> dict[str, Any]:
    """A day's plan, its blocks in order with the ids they pick; 404 with none saved."""
    plan = await read_plan(session, day)
    if plan is None:
        raise HTTPException(404, "No plan was saved for that day.")
    return plan


@router.put("/plans/{day}")
async def put_plan(
    day: date, body: DayPlanIn, session: Session, settings: VaultSettings
) -> dict[str, Any]:
    """Save a day's plan; each picked todo's planned date becomes that day, no other date moves."""
    try:
        return await _save(session, settings, day, body.blocks, "browser")
    except MissingError as error:
        raise HTTPException(404, f"No todo has the id {error}.") from error
    except PlanRefusedError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/outcomes/{day}")
async def get_outcomes(day: date, session: Session) -> list[dict[str, Any]]:
    """The outcomes of the week `day` falls in."""
    return await read_outcomes(session, day)


@router.put("/outcomes/{day}")
async def put_outcomes(
    day: date, body: list[WeekOutcomeIn], session: Session, settings: VaultSettings
) -> list[dict[str, Any]]:
    """Replace the outcomes of the week `day` falls in, five at most."""
    try:
        await save_outcomes(session, settings, day, [(one.words, one.todo_id) for one in body])
    except PlanRefusedError as error:
        raise HTTPException(422, str(error)) from error
    await session.commit()
    return await read_outcomes(session, day)


@router.get("/brief/{day}")
async def get_brief(day: date, session: Session, settings: VaultSettings) -> dict[str, Any]:
    """The planning brief for a day, its todos in the brief's fixed order."""
    return await briefing.brief(session, settings, day)


async def _tool(work: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    try:
        async with db.session() as session:
            return await work(session)
    except MissingError as error:
        raise ToolError(f"No todo has the id {error}.") from error
    except PlanRefusedError as error:
        raise ToolError(str(error)) from error


async def read_brief(day: date) -> dict[str, Any]:
    """The planning brief for `day`: last plan, waits due a look, due soon, outcomes, todos.

    Todos come in a fixed order: what the dates force first (`why`), then by priority.
    `picked` counts the earlier plans that picked a todo.
    """
    settings = get_settings()
    found = await _tool(lambda session: briefing.brief(session, settings, day))
    return _json(found)


async def save_day_plan(day: date, blocks: list[PlanBlockIn]) -> dict[str, Any]:
    """Save `day`'s plan: blocks with starts, ends (HH:MM), kind, title and picked todo ids.

    Two focus blocks a day at most, one todo each. A pick sets that todo's planned date
    to `day` and no other date. Saving again replaces the day's plan.
    """
    settings = get_settings()
    return _json(await _tool(lambda session: _save(session, settings, day, blocks, "agent")))


async def save_week_outcomes(day: date, outcomes: list[WeekOutcomeIn]) -> list[dict[str, Any]]:
    """Replace the outcomes of the week `day` falls in, five at most, each with its todo id."""
    settings = get_settings()

    async def run(session: AsyncSession) -> list[dict[str, Any]]:
        await save_outcomes(session, settings, day, [(one.words, one.todo_id) for one in outcomes])
        await session.commit()
        return await read_outcomes(session, day)

    return await _tool(run)


def _json(value: Any) -> Any:
    """Dates and times as ISO strings, as the routes send them."""
    if isinstance(value, dict):
        return {key: _json(one) for key, one in value.items()}
    if isinstance(value, list):
        return [_json(one) for one in value]
    if isinstance(value, date | time | datetime):
        return value.isoformat()
    return value


TOOLS = (read_brief, save_day_plan, save_week_outcomes)
READING = frozenset({"read_brief"})
