"""The planning brief for a day: what the last plan got done, what the dates force, then the rest.

The order is a rule in code, never a model's judgment (#2191).
"""

from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select

from kasten_backend.todos.plan.days import done_on, read_outcomes, read_plan, todo_ids
from kasten_backend.todos.store.days import DayPlan, PlanBlock, PlanPick
from kasten_backend.todos.store.models import Todo
from kasten_backend.todos.store.search import PRIORITY_ORDER, Filters, search
from kasten_backend.todos.store.writes import plain

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from kasten_backend.config import Settings

OPEN = ("open", "doing", "review", "blocked", "waiting")
SOON = 3
"""Days ahead a due date forces a todo to the top."""
AHEAD = 14
"""Days ahead the brief lists hard due dates; every todo has a soft one 14 days out."""


def _why(row: Todo, day: date) -> str | None:
    """What the dates force, in the order they rank; None when nothing does."""
    if row.planned == day:
        return "planned"
    if row.due is not None and row.due <= day + timedelta(days=SOON):
        return "due"
    if row.state == "waiting" and row.look_again is not None and row.look_again <= day:
        return "look again"
    return None


def _client(row: Todo, by_id: dict[str, Todo]) -> bool:
    """Client work: a `#client` tag on the todo or any todo above it."""
    seen: set[str] = set()
    found: Todo | None = row
    while found is not None and found.id not in seen:
        if "#client" in found.tags:
            return True
        seen.add(found.id)
        found = by_id.get(found.parent_id or "")
    return False


def rank(rows: list[Todo], day: date, outcome_ids: set[str]) -> list[tuple[Todo, str | None]]:
    """Dates first: planned that day, due within 3 days, a wait due a look; then by priority.

    Within one priority: a weekly outcome's todo, then the nearer due date, then client work,
    then the older todo.
    """
    by_id = {row.id: row for row in rows}
    forced_order = {"planned": 0, "due": 1, "look again": 2}

    def key(row: Todo) -> tuple[Any, ...]:
        why = _why(row, day)
        due = row.due or date.max
        if why is not None:
            return (0, forced_order[why], due, row.created, row.id)
        return (
            1,
            PRIORITY_ORDER.index(row.priority),
            row.id not in outcome_ids,
            due,
            not _client(row, by_id),
            row.created,
            row.id,
        )

    return [(row, _why(row, day)) for row in sorted(rows, key=key)]


async def _picked(session: AsyncSession, day: date) -> dict[str, int]:
    """How many earlier plans picked each todo."""
    counted = (
        select(PlanPick.todo_id, func.count())
        .join(PlanBlock, PlanBlock.id == PlanPick.block_id)
        .where(PlanBlock.day < day)
        .group_by(PlanPick.todo_id)
    )
    return {str(id_): int(count) for id_, count in (await session.execute(counted)).all()}


def _row(row: Todo, picked: dict[str, int], why: str | None = None) -> dict[str, Any]:
    values = plain(row)
    keep = ("id", "words", "state", "tags", "priority", "due", "due_hard", "planned")
    keep += ("look_again", "waiting_on", "project", "parent_id", "epic_id", "created", "version")
    shown = {key: values[key] for key in keep} | {"picked": picked.get(row.id, 0)}
    return shown | ({"why": why} if why is not None else {})


async def _last_plan(session: AsyncSession, day: date) -> dict[str, Any] | None:
    last = await session.scalar(select(func.max(DayPlan.day)).where(DayPlan.day < day))
    plan = None if last is None else await read_plan(session, last)
    if plan is None:
        return None
    ids = todo_ids(plan)
    rows = {
        row.id: row for row in (await session.scalars(select(Todo).where(Todo.id.in_(ids)))).all()
    }
    for block in plan["blocks"]:
        block["todos"] = [
            {
                "id": id_,
                "words": getattr(rows.get(id_), "words", None),
                "done": done_on(rows.get(id_)),
            }
            for id_ in block["todos"]
        ]
    plan["picked"] = len(ids)
    plan["done"] = sum(done_on(rows.get(id_)) for id_ in ids)
    return plan


async def brief(
    session: AsyncSession, settings: Settings, day: date, limit: int = 60
) -> dict[str, Any]:
    """Everything a planning talk for `day` starts from, in the brief's fixed order."""
    rows = await search(session, Filters(state=OPEN, shown_on=day, archive=settings.archive_path))
    rows = [row for row in rows if row.shared_list is None]
    picked = await _picked(session, day)
    outcomes = await read_outcomes(session, day)
    outcome_ids = {one["todo_id"] for one in outcomes if one["todo_id"]}
    ranked = rank(rows, day, outcome_ids)
    ahead = day + timedelta(days=AHEAD)
    return {
        "day": day,
        "last_plan": await _last_plan(session, day),
        "look_again": [
            _row(row, picked)
            for row in rows
            if row.state == "waiting" and row.look_again is not None and row.look_again <= day
        ],
        "due_soon": [
            _row(row, picked)
            for row in sorted(rows, key=lambda one: (one.due or date.max, one.id))
            if row.due is not None and row.due_hard and row.due <= ahead
        ],
        "outcomes": outcomes,
        "todos": [_row(row, picked, why) for row, why in ranked[:limit]],
        "open_count": len(rows),
    }
