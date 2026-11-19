"""Save and read a day's plan and a week's outcomes, held to the caps in the settings."""

from dataclasses import dataclass, field
from datetime import date, time, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import delete, select

from kasten_backend.todos.store.days import DayPlan, Outcome, PlanBlock, PlanPick

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from kasten_backend.config import Settings
    from kasten_backend.todos.store.models import Todo
    from kasten_backend.todos.store.writes import Writes


class PlanRefusedError(ValueError):
    """A plan or a week's outcomes past a cap in the settings."""


@dataclass
class Block:
    """One block of a plan as a caller sends it."""

    starts: time
    ends: time
    kind: str
    title: str
    todos: list[str] = field(default_factory=list)


def monday(day: date) -> date:
    """The Monday of `day`'s week, which keys its outcomes."""
    return day - timedelta(days=day.weekday())


def _check(settings: Settings, blocks: list[Block]) -> None:
    focus = [block for block in blocks if block.kind == "focus"]
    if len(focus) > settings.plan_focus_blocks:
        raise PlanRefusedError(f"A day holds {settings.plan_focus_blocks} focus blocks at most.")
    if any(len(block.todos) > settings.plan_focus_todos for block in focus):
        raise PlanRefusedError(f"A focus block picks {settings.plan_focus_todos} todo at most.")
    if any(block.ends <= block.starts for block in blocks):
        raise PlanRefusedError("A block ends after it starts.")


async def save_plan(writes: Writes, settings: Settings, day: date, blocks: list[Block]) -> None:
    """Replace `day`'s plan; each picked todo's planned date becomes `day`, no other date moves."""
    _check(settings, blocks)
    rows = [await writes.get(id_) for block in blocks for id_ in block.todos]
    session = writes.session
    await session.execute(delete(DayPlan).where(DayPlan.day == day))
    session.add(DayPlan(day=day, by=writes.by))
    await session.flush()
    for block in sorted(blocks, key=lambda one: one.starts):
        held = PlanBlock(
            day=day, starts=block.starts, ends=block.ends, kind=block.kind, title=block.title
        )
        session.add(held)
        await session.flush()
        session.add_all(
            PlanPick(block_id=held.id, todo_id=id_, position=at)
            for at, id_ in enumerate(block.todos)
        )
    for row in rows:
        if row.planned != day:
            await writes.edit(row.id, row.version, {"planned": day})


async def read_plan(session: AsyncSession, day: date) -> dict[str, Any] | None:
    """`day`'s plan: its blocks in order, each with its picked todos' ids; None with none saved."""
    plan = await session.get(DayPlan, day)
    if plan is None:
        return None
    blocks = (
        await session.scalars(
            select(PlanBlock).where(PlanBlock.day == day).order_by(PlanBlock.starts)
        )
    ).all()
    picks = (
        await session.scalars(
            select(PlanPick)
            .where(PlanPick.block_id.in_([block.id for block in blocks]))
            .order_by(PlanPick.position)
        )
    ).all()
    return {
        "day": day,
        "saved": plan.saved,
        "by": plan.by,
        "blocks": [
            {
                "starts": block.starts,
                "ends": block.ends,
                "kind": block.kind,
                "title": block.title,
                "todos": [pick.todo_id for pick in picks if pick.block_id == block.id],
            }
            for block in blocks
        ],
    }


async def save_outcomes(
    session: AsyncSession, settings: Settings, day: date, outcomes: list[tuple[str, str | None]]
) -> None:
    """Replace the outcomes of `day`'s week, each with the todo that carries it, if any."""
    if len(outcomes) > settings.week_outcomes:
        raise PlanRefusedError(f"A week names {settings.week_outcomes} outcomes at most.")
    week = monday(day)
    await session.execute(delete(Outcome).where(Outcome.week == week))
    session.add_all(
        Outcome(week=week, words=words, todo_id=todo_id, position=at)
        for at, (words, todo_id) in enumerate(outcomes)
    )
    await session.flush()


async def read_outcomes(session: AsyncSession, day: date) -> list[dict[str, Any]]:
    """The outcomes of `day`'s week, in order."""
    found = await session.scalars(
        select(Outcome).where(Outcome.week == monday(day)).order_by(Outcome.position)
    )
    return [{"words": one.words, "todo_id": one.todo_id} for one in found.all()]


def todo_ids(plan: dict[str, Any] | None) -> list[str]:
    """Every todo a plan picks, in block order."""
    return [] if plan is None else [id_ for block in plan["blocks"] for id_ in block["todos"]]


def done_on(row: Todo | None) -> bool:
    """Whether a picked todo got done: ticked, or sent for review."""
    return row is not None and row.state in ("done", "review")
