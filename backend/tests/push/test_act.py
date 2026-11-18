"""`Done` and `Tomorrow` on a reminder, which find their todo in the store by its id (#1682)."""

import datetime as dt
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import pytest

from backend.tests.push.conftest import PushService, subscribe, todo
from kasten_backend.push import tick
from kasten_backend.push.due import put_off

if TYPE_CHECKING:
    import httpx
    from sqlalchemy.ext.asyncio import AsyncEngine

    from kasten_backend.config import Settings

BERLIN = ZoneInfo("Europe/Berlin")
PATH = "Notes/Errands.md"


def _noon() -> dt.datetime:
    # Noon keeps clear of the hour where a Berlin day and its UTC day differ.
    return dt.datetime.now(BERLIN).replace(hour=12, minute=0, second=0, microsecond=0)


ALARM = f"⏰ {_noon():%Y-%m-%d %H:%M}"


async def _rows(client: httpx.AsyncClient) -> dict[str, dict]:
    return {row["id"]: row for row in (await client.get("/api/todos/rows")).json()}


async def _line(client: httpx.AsyncClient, id_: str) -> str:
    """The todo's line as the store renders it, its id on it, as a reminder pushes it."""
    [hit] = [hit for hit in (await client.get("/api/todos")).json() if hit["todo"]["id"] == id_]
    return hit["text"]


async def _act(client: httpx.AsyncClient, action: str, text: str) -> int:
    answer = await client.post("/api/push/act", json={"path": PATH, "text": text, "action": action})
    return answer.status_code


async def test_1682_done_ticks_the_todo_and_its_open_parts(
    client: httpx.AsyncClient, served: Settings
) -> None:
    top = await todo(client, f"- [ ] call the dentist {ALARM}", PATH)
    answer = await client.post(
        "/api/todos/line", json={"text": "- [ ] find the card", "parent_id": top["id"]}
    )
    part = answer.json()[0]
    assert await _act(client, "done", await _line(client, top["id"])) == 204
    rows = await _rows(client)
    today = _noon().date().isoformat()
    assert (rows[top["id"]]["state"], rows[top["id"]]["done"]) == ("done", today)
    assert (rows[part["id"]]["state"], rows[part["id"]]["done"]) == ("done", today)


async def test_1682_tomorrow_moves_the_alarm_to_the_same_time_tomorrow(
    client: httpx.AsyncClient, served: Settings
) -> None:
    row = await todo(client, "- [ ] call the dentist ⏰ 2026-11-12 09:00", PATH)
    assert await _act(client, "tomorrow", await _line(client, row["id"])) == 204
    after = (await _rows(client))[row["id"]]
    tomorrow = _noon().date() + dt.timedelta(days=1)
    expected = dt.datetime.combine(tomorrow, dt.time(9, 0), BERLIN)
    assert dt.datetime.fromisoformat(after["remind_at"]) == expected
    assert after["state"] == "open"


@pytest.mark.parametrize("action", ["done", "tomorrow"])
@pytest.mark.parametrize(
    ("seeded", "line"),
    [
        (False, "- [ ] call the dentist ⏰ 2026-11-12 09:00"),
        (False, "- [ ] call the dentist ⏰ 2026-11-12 09:00 🆔 kt-000000"),
        (True, "- [x] call the dentist ⏰ 2026-11-12 09:00"),
        (True, "- [ ] buy milk"),
        (True, "- [ ] buy milk `⏰ 2026-11-12 09:00`"),
    ],
    ids=["no id", "no such todo", "done already", "no alarm", "alarm in code"],
)
async def test_1682_an_act_on_no_open_reminder_writes_nothing(
    client: httpx.AsyncClient, served: Settings, action: str, seeded: bool, line: str
) -> None:
    if seeded:
        line = await _line(client, (await todo(client, line, PATH))["id"])
    before = await _rows(client)
    assert await _act(client, action, line) == 409
    assert await _rows(client) == before


async def test_1682_done_on_a_repeat_keeps_the_round_and_moves_the_todo_on(
    client: httpx.AsyncClient, served: Settings
) -> None:
    today = _noon().date()
    row = await todo(client, f"- [ ] pay rent 🔁 every day 📅 {today.isoformat()} {ALARM}", PATH)
    assert await _act(client, "done", await _line(client, row["id"])) == 204
    rows = await _rows(client)
    moved = rows[row["id"]]
    assert (moved["state"], moved["due"]) == ("open", (today + dt.timedelta(days=1)).isoformat())
    [kept] = [one for one in rows.values() if one["round_of"] == row["id"]]
    assert (kept["state"], kept["done"]) == ("done", today.isoformat())


async def test_1682_done_unblocks_the_todo_it_held(
    client: httpx.AsyncClient, served: Settings
) -> None:
    first = await todo(client, f"- [ ] pay rent {ALARM}", PATH)
    then = await todo(client, f"- [ ] then this ⛔ {first['id']}", PATH)
    assert then["state"] == "blocked"
    assert await _act(client, "done", await _line(client, first["id"])) == 204
    assert (await _rows(client))[then["id"]]["state"] == "open"


def test_1682_put_off_moves_only_the_alarm_the_reader_takes() -> None:
    line = "- [ ] read `⏰ 2026-01-01 08:00` then ⏰ 2026-11-12 09:00 📅 2026-11-12\r"
    assert put_off(line, dt.date(2026, 11, 20)) == (
        "- [ ] read `⏰ 2026-01-01 08:00` then ⏰ 2026-11-21 09:00 📅 2026-11-12\r"
    )
    assert put_off("- [ ] no alarm", dt.date(2026, 11, 20)) is None


async def test_1682_a_reminder_carries_its_line_and_after_tomorrow_waits_a_day(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    now = _noon()
    top = await todo(client, "- [ ] errands", PATH)
    await client.post(
        "/api/todos/line", json={"text": f"- [ ] call the dentist {ALARM}", "parent_id": top["id"]}
    )
    async with service.client() as http:
        assert await tick(push_db, served, http, now) == 1
        line = service.sent[0][1]["text"]
        assert line.startswith("  - [ ] call the dentist ")
        assert f"{ALARM} 🆔 kt-" in line
        assert await _act(client, "tomorrow", line) == 204
        assert await tick(push_db, served, http, now + dt.timedelta(minutes=1)) == 0
        assert await tick(push_db, served, http, now + dt.timedelta(days=1)) == 1
