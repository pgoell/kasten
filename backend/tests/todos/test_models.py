"""The todo store's tables (#2191): what a row defaults to and what the schema refuses."""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from kasten_backend.todos.models import Todo, TodoChange, TodoSession

DAY = date(2026, 11, 18)


async def test_a_bare_todo_takes_the_schema_defaults(activity: AsyncEngine) -> None:
    async with AsyncSession(activity) as session:
        session.add(
            Todo(id="kt-000001", words="call the dentist #health", state="open", created=DAY)
        )
        await session.commit()
        row = await session.get(Todo, "kt-000001")

    assert row is not None
    assert (row.tags, row.blocked_by, row.position, row.deadline_hard, row.version) == (
        [],
        [],
        0,
        False,
        1,
    )
    await _clear(activity)


@pytest.mark.parametrize(
    "fields",
    [
        {"state": "x"},
        {"state": "open", "priority": "urgent"},
        {"state": "open", "deadline_hard": True},
    ],
    ids=["unknown state", "unknown priority", "hard deadline with no day"],
)
async def test_the_schema_refuses_a_row_no_todo_can_be(
    activity: AsyncEngine, fields: dict[str, object]
) -> None:
    async with AsyncSession(activity) as session:
        session.add(Todo(id="kt-000002", words="w", created=DAY, **fields))
        with pytest.raises(IntegrityError):
            await session.commit()


async def test_deleting_a_todo_takes_its_parts_and_sessions_and_keeps_its_history(
    activity: AsyncEngine,
) -> None:
    async with AsyncSession(activity) as session:
        session.add(Todo(id="kt-000003", words="pack", state="open", created=DAY))
        await session.flush()
        session.add(
            Todo(id="kt-000004", words="passport", state="open", created=DAY, parent_id="kt-000003")
        )
        session.add(TodoSession(todo_id="kt-000003", started=datetime(2026, 11, 18, 9, tzinfo=UTC)))
        session.add(TodoChange(todo_id="kt-000003", by="test", after={"words": "pack"}))
        await session.commit()

        await session.delete(await session.get(Todo, "kt-000003"))
        await session.commit()
        counts = [
            await session.scalar(select(func.count()).select_from(table))
            for table in (Todo, TodoSession, TodoChange)
        ]

    assert counts == [0, 0, 1]
    await _clear(activity)


async def _clear(engine: AsyncEngine) -> None:
    async with AsyncSession(engine) as session:
        for table in (TodoSession, TodoChange, Todo):
            for row in (await session.scalars(select(table))).all():
                await session.delete(row)
        await session.commit()
