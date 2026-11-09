"""Push timers: the routes that start, list and stop them, and the sender that rings them."""

import datetime as dt
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import func, select

from backend.tests.push.conftest import PushService, subscribe
from kasten_backend.push import PushTimer, tick

if TYPE_CHECKING:
    import httpx
    from sqlalchemy.ext.asyncio import AsyncEngine

    from kasten_backend.config import Settings

BERLIN = ZoneInfo("Europe/Berlin")
NOW = dt.datetime(2026, 11, 12, 9, 0, tzinfo=BERLIN)


def _at(minutes: float) -> str:
    return (NOW + dt.timedelta(minutes=minutes)).isoformat()


async def _start(client: httpx.AsyncClient, **body: object) -> dict:
    answer = await client.post("/api/push/timers", json=body)
    assert answer.status_code == 201, answer.text
    return answer.json()


async def _count(engine: AsyncEngine) -> int:
    async with engine.connect() as connection:
        return await connection.scalar(select(func.count()).select_from(PushTimer)) or 0


async def test_timers_are_listed_next_first_and_one_is_stopped(
    client: httpx.AsyncClient, served: Settings
) -> None:
    dryer = await _start(client, label="Dryer", due=_at(60))
    washer = await _start(client, label="Washer", due=_at(85))
    water = await _start(client, label="Water", due=_at(0), every=5400, until=_at(600))
    listed = (await client.get("/api/push/timers")).json()
    assert [t["label"] for t in listed] == ["Water", "Dryer", "Washer"]
    assert listed[0]["every"] == 5400
    assert dt.datetime.fromisoformat(listed[1]["due"]) == NOW + dt.timedelta(minutes=60)
    assert (await client.delete(f"/api/push/timers/{dryer['id']}")).status_code == 204
    assert (await client.delete(f"/api/push/timers/{dryer['id']}")).status_code == 404
    left = [t["id"] for t in (await client.get("/api/push/timers")).json()]
    assert left == [water["id"], washer["id"]]


@pytest.mark.parametrize(
    "body",
    [
        {"label": "", "due": _at(5)},
        {"label": "Washer", "due": "2026-11-12T09:05:00"},
        {"label": "Water", "due": _at(0), "every": 30},
        {"label": "Water", "due": _at(60), "every": 3600, "until": _at(0)},
    ],
)
async def test_an_empty_label_a_naive_time_a_short_repeat_or_an_early_end_is_refused(
    client: httpx.AsyncClient, served: Settings, body: dict
) -> None:
    assert (await client.post("/api/push/timers", json=body)).status_code == 422


async def test_a_timer_rings_every_device_once_and_is_gone(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone", "laptop")
    timer = await _start(client, label="Washer", due=_at(85))
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=84), todos=False) == 0
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=85), todos=False) == 1
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=86), todos=False) == 0
    assert len(service.sent) == 2
    message = service.sent[0][1]
    assert message == {
        "title": "kasten",
        "body": "Washer",
        "tag": f"timer-{timer['id']}",
        "renotify": True,
    }
    assert await _count(push_db) == 0


async def test_a_timer_due_now_rings_on_the_next_tick(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _start(client, label="Water", due=_at(0), every=3600)
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW + dt.timedelta(seconds=10), todos=False) == 1


async def test_a_repeat_moves_on_by_its_step_and_ends_after_until(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _start(client, label="Water", due=_at(0), every=5400, until=_at(180))
    async with service.client() as http:
        rung = [
            await tick(push_db, served, http, NOW + dt.timedelta(minutes=m), todos=False)
            for m in (0, 1, 90, 91, 180, 181, 270)
        ]
    assert rung == [1, 0, 1, 0, 1, 0, 0]
    assert await _count(push_db) == 0


async def test_a_repeat_down_for_hours_skips_what_it_missed(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _start(client, label="Water", due=_at(0), every=3600)
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=150), todos=False) == 0
    listed = (await client.get("/api/push/timers")).json()
    assert dt.datetime.fromisoformat(listed[0]["due"]) == NOW + dt.timedelta(minutes=180)


@pytest.mark.parametrize(("late", "sent"), [(59, 1), (60, 0)])
async def test_a_missed_timer_rings_late_under_an_hour_and_is_dropped_after(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine, late: int, sent: int
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _start(client, label="Washer", due=_at(0))
    async with service.client() as http:
        assert await tick(push_db, served, http, NOW + dt.timedelta(minutes=late)) == sent
    assert await _count(push_db) == 0


async def test_with_no_device_a_timer_still_ends(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    await _start(client, label="Washer", due=_at(0))
    async with PushService().client() as http:
        assert await tick(push_db, served, http, NOW, todos=False) == 0
    assert await _count(push_db) == 0
