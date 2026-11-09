"""Quiet hours that hold a push until they end, and the morning push of today's todos."""

import datetime as dt
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

import pytest

from backend.tests.push.conftest import PushService, note, subscribe
from kasten_backend.push import tick
from kasten_backend.push.due import Quiet, sendable

if TYPE_CHECKING:
    import httpx
    from sqlalchemy.ext.asyncio import AsyncEngine

    from kasten_backend.config import Settings

BERLIN = ZoneInfo("Europe/Berlin")
NIGHT = Quiet(dt.time(22, 0), dt.time(7, 0))


def _at(day: int, hour: int, minute: int = 0) -> dt.datetime:
    return dt.datetime(2026, 11, day, hour, minute, tzinfo=BERLIN)


@pytest.mark.parametrize(
    ("quiet", "due", "now", "expected"),
    [
        (NIGHT, _at(12, 23, 30), _at(12, 23, 30), False),
        (NIGHT, _at(12, 23, 30), _at(13, 7, 0), True),
        (NIGHT, _at(13, 6, 0), _at(13, 6, 30), False),
        (NIGHT, _at(13, 6, 0), _at(13, 7, 5), True),
        (NIGHT, _at(12, 21, 30), _at(13, 7, 0), True),
        (NIGHT, _at(12, 21, 30), _at(12, 21, 45), True),
        (NIGHT, _at(12, 20, 30), _at(13, 7, 0), False),
        (NIGHT, _at(13, 5, 0), _at(13, 7, 59), True),
        (NIGHT, _at(13, 5, 0), _at(13, 8, 0), False),
        (NIGHT, _at(13, 12, 0), _at(13, 12, 10), True),
        (Quiet(dt.time(13, 0), dt.time(14, 0)), _at(13, 13, 30), _at(13, 13, 45), False),
        (Quiet(dt.time(13, 0), dt.time(14, 0)), _at(13, 13, 30), _at(13, 14, 0), True),
        (None, _at(12, 21, 30), _at(13, 7, 0), False),
        (None, _at(13, 9, 0), _at(13, 9, 59), True),
    ],
)
def test_quiet_hours_hold_a_push_and_its_late_hour_counts_from_their_end(
    quiet: Quiet | None, due: dt.datetime, now: dt.datetime, expected: bool
) -> None:
    assert sendable(due, now.astimezone(dt.UTC), quiet, BERLIN) is expected


async def _set(client: httpx.AsyncClient, **hours: str | None) -> None:
    body = {"morning": None, "quiet_start": None, "quiet_end": None, **hours}
    answer = await client.put("/api/push/settings", json=body)
    assert answer.status_code == 200, answer.text


async def test_the_settings_are_stored_and_read_back(
    client: httpx.AsyncClient, served: Settings
) -> None:
    empty = {"morning": None, "quiet_start": None, "quiet_end": None}
    assert (await client.get("/api/push/settings")).json() == empty
    await _set(client, morning="07:30", quiet_start="22:00", quiet_end="07:00")
    stored = (await client.get("/api/push/settings")).json()
    assert stored == {"morning": "07:30", "quiet_start": "22:00", "quiet_end": "07:00"}
    await _set(client)
    assert (await client.get("/api/push/settings")).json() == empty


@pytest.mark.parametrize(
    "body",
    [
        {"morning": None, "quiet_start": "22:00", "quiet_end": None},
        {"morning": None, "quiet_start": None, "quiet_end": "07:00"},
        {"morning": None, "quiet_start": "22:00", "quiet_end": "22:00"},
        {"morning": "25:00", "quiet_start": None, "quiet_end": None},
    ],
)
async def test_half_or_empty_quiet_hours_and_a_bad_time_are_refused(
    client: httpx.AsyncClient, served: Settings, body: dict
) -> None:
    assert (await client.put("/api/push/settings", json=body)).status_code == 422


@pytest.mark.parametrize("due", ["2026-11-12 23:30", "2026-11-12 21:30"])
async def test_a_reminder_in_or_running_into_quiet_hours_sends_at_their_end(
    client: httpx.AsyncClient,
    served: Settings,
    push_db: AsyncEngine,
    due: str,
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _set(client, quiet_start="22:00", quiet_end="07:00")
    note(served, f"- [ ] call back ⏰ {due}\n")
    async with service.client() as http:
        assert await tick(push_db, served, http, _at(12, 23, 30)) == 0
        assert await tick(push_db, served, http, _at(13, 6, 59)) == 0
        assert await tick(push_db, served, http, _at(13, 7, 0)) == 1
        assert await tick(push_db, served, http, _at(13, 7, 1)) == 0
    assert [message["body"] for _, message in service.sent] == ["call back"]


TODAY = """\
- [ ] pay rent 📅 2026-11-12
- [ ] book train ⏳ 2026-11-12
- [ ] call mum 📅 2026-11-12 ⏰ 2026-11-12 09:00 ^abc1
- [ ] first date wins 📅 2026-11-01 📅 2026-11-12
- [x] done already 📅 2026-11-12
- [ ] next week 📅 2026-11-19
- [ ] someday
"""


async def test_the_morning_push_sends_today_once_a_day(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _set(client, morning="07:30")
    note(served, TODAY, "Plans.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, _at(12, 7, 29)) == 0
        assert await tick(push_db, served, http, _at(12, 7, 30)) == 1
        assert await tick(push_db, served, http, _at(12, 7, 31)) == 0
        assert await tick(push_db, served, http, _at(12, 12, 0)) == 0
    [(_, message)] = service.sent
    assert message["title"] == "Today"
    assert message["body"] == "pay rent\nbook train\ncall mum"
    assert message["path"] == "01 Periodic/00 Daily/2026-11-12.md"


@pytest.mark.parametrize(("morning", "body"), [(None, TODAY), ("07:30", "- [ ] someday\n")])
async def test_no_morning_push_when_it_is_off_or_nothing_is_due(
    client: httpx.AsyncClient,
    served: Settings,
    push_db: AsyncEngine,
    morning: str | None,
    body: str,
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _set(client, morning=morning)
    note(served, body, "Plans.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, _at(12, 7, 30)) == 0
    assert service.sent == []


async def test_a_morning_push_inside_quiet_hours_waits_for_their_end(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone")
    await _set(client, morning="06:00", quiet_start="22:00", quiet_end="07:00")
    note(served, TODAY, "Plans.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, _at(12, 6, 0)) == 0
        assert await tick(push_db, served, http, _at(12, 7, 0)) == 1
    assert len(service.sent) == 1


async def test_a_device_the_morning_push_finds_gone_gets_no_reminder_that_tick(
    client: httpx.AsyncClient, served: Settings, push_db: AsyncEngine
) -> None:
    service = PushService()
    await subscribe(client, service, "phone", "old")
    service.status["https://push.example/old"] = 410
    await _set(client, morning="07:30")
    note(served, TODAY + "- [ ] stretch ⏰ 2026-11-12 07:30\n", "Plans.md")
    async with service.client() as http:
        assert await tick(push_db, served, http, _at(12, 7, 30)) == 2
    old = [message["title"] for endpoint, message in service.sent if endpoint.endswith("/old")]
    assert old == ["Today"]
