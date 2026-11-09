"""The goals push: at a time set in `/settings`, one push per `min` log goal not met (#1682)."""

import datetime as dt
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from backend.tests.push.conftest import PushService, note, subscribe
from kasten_backend.push import tick

if TYPE_CHECKING:
    import httpx
    from sqlalchemy.ext.asyncio import AsyncEngine

    from kasten_backend.config import Settings

AT = dt.datetime(2026, 11, 12, 20, 0, tzinfo=ZoneInfo("Europe/Berlin"))
CONFIG = (
    "- 💧 water: 250 ml, min 2000\n"
    "- ☕ coffee: 1, max 3\n"
    "- 🚶 steps: 1000 steps, min 8000\n"
    "- ⚖ weight: kg, last, min 60\n"
    "- 🍽 food: protein min 100, kcal max 2500\n"
)
DAY = "01 Periodic/00 Daily/2026-11-12.md"


async def _setup(
    client: httpx.AsyncClient, served: Settings, log: str, **hours: str | None
) -> PushService:
    service = PushService()
    await subscribe(client, service, "phone")
    note(served, CONFIG, "99 Misc/01 Config/log.md")
    note(served, f"# Today\n\n## Log\n\n{log}", DAY)
    body = {"morning": None, "quiet_start": None, "quiet_end": None, "goals": "20:00"} | hours
    assert (await client.put("/api/push/settings", json=body)).status_code == 200
    return service


async def _bodies(
    service: PushService, served: Settings, push_db: AsyncEngine, now: dt.datetime
) -> list[str]:
    service.sent.clear()
    async with service.client() as http:
        await tick(push_db, served, http, now)
    return sorted({message["body"] for _, message in service.sent})


async def test_1682_one_push_per_min_goal_not_met_read_as_the_log_pane_reads_them(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = await _setup(
        client, served, "- 💧 500 ml\n- ☕ 5\n- 🚶 9000 steps\n- 🍽 lunch: 🔥 3000 🥩 40g\n"
    )
    async with service.client() as http:
        assert await tick(push_db, served, http, AT - dt.timedelta(minutes=1)) == 0
        assert await tick(push_db, served, http, AT) == 3
    messages = sorted((m["body"], m["title"], m["path"]) for _, m in service.sent)
    assert not any("text" in m for _, m in service.sent)
    assert messages == [
        ("⚖ weight: 0 of 60 kg", "Goal", DAY),
        ("🍽 protein: 40 of 100 g", "Goal", DAY),
        ("💧 water: 500 of 2000 ml", "Goal", DAY),
    ]


async def test_1682_no_goals_push_when_every_min_goal_is_met_or_no_time_is_set(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    met = "- 💧 2 l\n- 🚶 8000 steps\n- ⚖ 61 kg\n- 🍽 lunch: 🥩 100g\n"
    service = await _setup(client, served, met)
    assert await _bodies(service, served, push_db, AT) == []
    service = await _setup(client, served, "", goals=None)
    assert await _bodies(service, served, push_db, AT) == []


async def test_1682_quiet_hours_hold_the_goals_push_and_it_goes_once_a_day(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = await _setup(
        client,
        served,
        "- 🚶 9000 steps\n- ⚖ 61 kg\n- 🍽 lunch: 🥩 100g\n",
        quiet_start="19:30",
        quiet_end="20:30",
    )
    assert await _bodies(service, served, push_db, AT) == []
    after = AT + dt.timedelta(minutes=30)
    assert await _bodies(service, served, push_db, after) == ["💧 water: 0 of 2000 ml"]
    assert await _bodies(service, served, push_db, after + dt.timedelta(minutes=1)) == []


async def test_1682_the_goals_time_is_stored_and_a_bad_one_refused(
    client: httpx.AsyncClient, served: Settings
) -> None:
    body = {"morning": None, "quiet_start": None, "quiet_end": None, "goals": "21:15"}
    assert (await client.put("/api/push/settings", json=body)).status_code == 200
    assert (await client.get("/api/push/settings")).json()["goals"] == "21:15"
    bad = await client.put("/api/push/settings", json=body | {"goals": "25:00"})
    assert bad.status_code == 422
    assert (await client.get("/api/push/settings")).json()["goals"] == "21:15"
