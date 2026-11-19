"""The day plan, the week's outcomes and the brief (#2191): picks, caps and the fixed order."""

from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient

pytestmark = pytest.mark.usefixtures("vault", "store")
DAY = date(2026, 11, 19)


async def add(client: AsyncClient, words: str, **fields: Any) -> dict[str, Any]:
    response = await client.post("/api/todos", json={"words": words, **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def plan(client: AsyncClient, day: date, blocks: list[dict[str, Any]]) -> Any:
    return await client.put(f"/api/plans/{day.isoformat()}", json={"blocks": blocks})


def block(kind: str, starts: str, ends: str, *todos: str) -> dict[str, Any]:
    return {"kind": kind, "starts": starts, "ends": ends, "title": kind, "todos": list(todos)}


async def test_a_pick_sets_the_planned_date_and_nothing_else(client: AsyncClient) -> None:
    row = await add(client, "write the memo", due="2026-11-30", due_hard=True)
    saved = await plan(client, DAY, [block("focus", "09:00", "11:00", row["id"])])
    after = (await client.get("/api/todos/rows")).json()[0]

    assert saved.status_code == 200, saved.text
    assert saved.json()["blocks"][0]["todos"] == [row["id"]]
    assert (after["planned"], after["due"], after["hold_until"]) == (
        DAY.isoformat(),
        "2026-11-30",
        None,
    )


async def test_the_caps_hold(client: AsyncClient) -> None:
    one, two = await add(client, "a"), await add(client, "b")
    three_focus = [block("focus", f"{h:02}:00", f"{h:02}:30") for h in (8, 9, 10)]
    crowded = await plan(client, DAY, [block("focus", "09:00", "10:00", one["id"], two["id"])])
    outcomes = await client.put(
        f"/api/outcomes/{DAY.isoformat()}", json=[{"words": str(n)} for n in range(6)]
    )

    assert (await plan(client, DAY, three_focus)).status_code == 422
    assert crowded.status_code == 422
    assert outcomes.status_code == 422


async def test_the_brief_puts_what_the_dates_force_first_then_priority(
    client: AsyncClient,
) -> None:
    today = datetime.now(ZoneInfo("Europe/Berlin")).date()
    later = (today + timedelta(days=20)).isoformat()
    low = await add(client, "low one", priority="low", due=later)
    high = await add(client, "high one", priority="high", due=later)
    none = await add(client, "no priority", due=later)
    planned = await add(client, "planned today", priority="lowest", planned=today.isoformat())
    due = await add(client, "due soon", due=(today + timedelta(days=2)).isoformat(), due_hard=True)
    carried = await add(client, "outcome's todo", priority="high", due=later)
    await add(client, "held", hold_until=(today + timedelta(days=5)).isoformat())
    await client.put(
        f"/api/outcomes/{today.isoformat()}", json=[{"words": "ship", "todo_id": carried["id"]}]
    )
    yesterday = today - timedelta(days=1)
    await plan(client, yesterday, [block("batch", "14:00", "15:00", low["id"])])

    brief = (await client.get(f"/api/brief/{today.isoformat()}")).json()

    assert [row["words"] for row in brief["todos"]] == [
        "planned today",
        "due soon",
        "outcome's todo",
        "high one",
        "no priority",
        "low one",
    ]
    assert [row.get("why") for row in brief["todos"][:2]] == ["planned", "due"]
    assert {row["id"]: row["picked"] for row in brief["todos"]}[low["id"]] == 1
    assert brief["last_plan"]["day"] == yesterday.isoformat()
    assert (brief["last_plan"]["picked"], brief["last_plan"]["done"]) == (1, 0)
    assert brief["outcomes"] == [{"words": "ship", "todo_id": carried["id"]}]
    assert [row["id"] for row in brief["due_soon"]] == [due["id"]]
    assert {high["id"], none["id"], planned["id"]} <= {row["id"] for row in brief["todos"]}


async def test_a_picked_todo_left_undone_keeps_its_dates_and_is_counted_once(
    client: AsyncClient,
) -> None:
    row = await add(client, "draft", due="2026-12-10", due_hard=True)
    await plan(client, DAY, [block("focus", "09:00", "10:00", row["id"])])
    brief = (await client.get(f"/api/brief/{(DAY + timedelta(days=1)).isoformat()}")).json()
    found = next(one for one in brief["todos"] if one["id"] == row["id"])

    assert (found["due"], found["planned"], found["picked"]) == ("2026-12-10", DAY.isoformat(), 1)
    assert found.get("why") is None
