"""The GitHub contributions the review draws, asked through `GET /api/github`, never the network.

GitHub is answered by a fake of `httpx.AsyncHTTPTransport.handle_async_request`,
the transport the backend's own client sends through, so what is tested is the
asking, the cache and the refusals rather than GitHub. Nothing new is imported
from the backend for the fake, so every test is red on main at the route.

Each test goes through the endpoint, so each one fails on a branch without the
route for a reason of its own: a 404, or an assertion reached.
"""

import asyncio
import json
import logging
import os
import time
from collections.abc import Callable, Iterator
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING

import httpx
import pytest
from httpx import AsyncClient

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app

if TYPE_CHECKING:
    from pathlib import Path

LOGIN = "octocat"
TOKEN = "ghp_test_token_never_shown"  # noqa: S105  a made-up token, to see that it never leaks
CACHE_NAME = "github-contributions.json"
GRAPHQL = "https://api.github.com/graphql"

Answer = Callable[[httpx.Request], httpx.Response]


def utc_today() -> date:
    """Today in UTC, the day the backend counts its days by."""
    return datetime.now(UTC).date()


def calendar(counts: dict[str, int]) -> dict:
    """GitHub's GraphQL answer for a user whose calendar holds these days."""
    days = [{"date": day, "contributionCount": count} for day, count in counts.items()]
    return {
        "data": {
            "user": {
                "contributionsCollection": {
                    "contributionCalendar": {"weeks": [{"contributionDays": days}]}
                }
            }
        }
    }


def no_user(request: httpx.Request) -> httpx.Response:
    """An answer GitHub gives for a login it does not know, with a 200 status."""
    return httpx.Response(
        200,
        json={"errors": [{"message": "Could not resolve to a User"}], "data": {"user": None}},
    )


def refuse(request: httpx.Request) -> httpx.Response:
    """An answer GitHub gives when it is down or refuses the token."""
    return httpx.Response(500)


def slow(request: httpx.Request) -> httpx.Response:
    """A read that never answers in time."""
    raise httpx.ReadTimeout("GitHub is slow", request=request)


@pytest.fixture
def github(monkeypatch: pytest.MonkeyPatch) -> Callable[[Answer], list[httpx.Request]]:
    """Hand back a way to say what GitHub replies, and the requests it got."""

    def use(handler: Answer) -> list[httpx.Request]:
        seen: list[httpx.Request] = []

        async def answer(
            transport: httpx.AsyncHTTPTransport, request: httpx.Request
        ) -> httpx.Response:
            seen.append(request)
            # A real read waits while GitHub answers, so another read can load the
            # cache meanwhile. Without this wait the fake answers in one step, and
            # two reads never overlap.
            await asyncio.sleep(0.05)
            return handler(request)

        monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", answer)
        return seen

    return use


@pytest.fixture
def served(tmp_path: Path) -> Iterator[Callable[..., None]]:
    """Serve the app with these GitHub settings, the cache beside the tokens under `tmp_path`."""
    vault = tmp_path / "vault"
    vault.mkdir()

    def serve(*, user: str = LOGIN, token: str | None = TOKEN, vault_root: Path = vault) -> None:
        # Explicit values win over the environment, so a token in a dev shell
        # cannot switch on a test that means it off.
        app.dependency_overrides[get_settings] = lambda: Settings(
            vault_path=vault_root,
            github_user=user,
            github_token=token,
            github_cache_path=tmp_path / CACHE_NAME,
        )

    yield serve

    app.dependency_overrides.clear()


def calendar_for_march(request: httpx.Request) -> httpx.Response:
    """GitHub's answer for the March days the tests ask for, with one day outside them."""
    return httpx.Response(
        200, json=calendar({"2026-02-28": 9, "2026-03-01": 3, "2026-03-02": 0, "2026-03-03": 5})
    )


async def test_807_a6_is_off_without_a_token(
    client: AsyncClient, served: Callable[..., None], github: Callable[[Answer], list]
) -> None:
    served(token=None)
    seen = github(calendar_for_march)

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})

    assert {"status": r.status_code, "answer": r.json(), "asked": len(seen)} == {
        "status": 200,
        "answer": {"on": False, "days": {}},
        "asked": 0,
    }


async def test_807_a6_is_off_without_a_user(
    client: AsyncClient, served: Callable[..., None], github: Callable[[Answer], list]
) -> None:
    served(user="")
    seen = github(calendar_for_march)

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})

    assert {"status": r.status_code, "answer": r.json(), "asked": len(seen)} == {
        "status": 200,
        "answer": {"on": False, "days": {}},
        "asked": 0,
    }


async def test_807_a6_asks_graphql_for_the_login_and_range_and_answers_the_days(
    client: AsyncClient, served: Callable[..., None], github: Callable[[Answer], list]
) -> None:
    served()
    seen = github(calendar_for_march)

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})

    body = json.loads(seen[0].content)
    assert {
        "status": r.status_code,
        "answer": r.json(),
        "url": str(seen[0].url),
        "auth": seen[0].headers["authorization"],
        "login": body["variables"]["login"],
        "from": body["variables"]["from"],
        "to": body["variables"]["to"],
    } == {
        "status": 200,
        "answer": {"on": True, "days": {"2026-03-01": 3, "2026-03-02": 0}},
        "url": GRAPHQL,
        "auth": f"bearer {TOKEN}",
        "login": LOGIN,
        "from": "2026-03-01T00:00:00Z",
        "to": "2026-03-02T23:59:59Z",
    }


async def test_807_i8_a_second_read_inside_the_hour_asks_nothing(
    client: AsyncClient, served: Callable[..., None], github: Callable[[Answer], list]
) -> None:
    served()
    today = utc_today()
    days = [(today - timedelta(days=back)).isoformat() for back in (2, 1, 0)]
    params = {"from": days[0], "to": days[-1]}
    # Every day of the range is answered, so the cache holds all of it after one read.
    seen = github(lambda request: httpx.Response(200, json=calendar(dict.fromkeys(days, 1))))

    first = await client.get("/api/github", params=params)
    second = await client.get("/api/github", params=params)

    assert {
        "statuses": [first.status_code, second.status_code],
        "same": first.json() == second.json(),
        "asked": len(seen),
    } == {"statuses": [200, 200], "same": True, "asked": 1}


async def test_807_i8_a_read_over_the_hour_old_asks_again(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    tmp_path: Path,
) -> None:
    served()
    today = utc_today()
    days = [(today - timedelta(days=back)).isoformat() for back in (2, 1, 0)]
    params = {"from": days[0], "to": days[-1]}
    seen = github(lambda request: httpx.Response(200, json=calendar(dict.fromkeys(days, 1))))
    first = await client.get("/api/github", params=params)
    assert first.status_code == 200
    # Put the last read two hours back in the file, as an hour's wait would.
    cache = tmp_path / CACHE_NAME
    stored = json.loads(cache.read_text(encoding="utf-8"))
    stored["read"] = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    cache.write_text(json.dumps(stored), encoding="utf-8")

    r = await client.get("/api/github", params=params)

    assert {"status": r.status_code, "asked": len(seen)} == {"status": 200, "asked": 2}


async def test_807_i8_past_days_are_served_from_the_file_by_a_fresh_process(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    tmp_path: Path,
) -> None:
    served()
    params = {"from": "2026-03-01", "to": "2026-03-02"}
    github(calendar_for_march)
    await client.get("/api/github", params=params)
    # A fresh process holds nothing in memory, so it starts from the settings and the file alone.
    served()
    seen = github(no_user)

    r = await client.get("/api/github", params=params)

    assert {
        "status": r.status_code,
        "answer": r.json(),
        "asked": len(seen),
        "file": (tmp_path / CACHE_NAME).is_file(),
    } == {
        "status": 200,
        "answer": {"on": True, "days": {"2026-03-01": 3, "2026-03-02": 0}},
        "asked": 0,
        "file": True,
    }


async def test_807_i8_a_failed_refresh_keeps_the_cached_days(
    client: AsyncClient, served: Callable[..., None], github: Callable[[Answer], list]
) -> None:
    served()
    github(calendar_for_march)
    await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})
    today = utc_today().isoformat()
    github(refuse)

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": today})

    assert {"status": r.status_code, "answer": r.json()} == {
        "status": 200,
        "answer": {"on": True, "days": {"2026-03-01": 3, "2026-03-02": 0}},
    }


@pytest.mark.parametrize(
    "answer",
    [
        pytest.param(refuse, id="http-error"),
        pytest.param(no_user, id="graphql-errors"),
        pytest.param(slow, id="timeout"),
    ],
)
async def test_807_i8_a_failure_with_nothing_cached_is_502_without_the_token(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    answer: Answer,
) -> None:
    served()
    github(answer)

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})

    assert {"status": r.status_code, "detail": r.json()["detail"], "token": TOKEN in r.text} == {
        "status": 502,
        "detail": "GitHub could not be read",
        "token": False,
    }


async def test_807_a6_the_token_never_reaches_the_logs_or_a_response(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    caplog: pytest.LogCaptureFixture,
) -> None:
    served()
    caplog.set_level(logging.DEBUG)
    github(calendar_for_march)
    ok = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})
    github(refuse)
    today = utc_today().isoformat()
    partial = await client.get("/api/github", params={"from": "2026-03-01", "to": today})
    github(refuse)
    failed = await client.get("/api/github", params={"from": "2026-04-01", "to": "2026-04-02"})

    assert {
        "statuses": [ok.status_code, partial.status_code, failed.status_code],
        "in_responses": [TOKEN in ok.text, TOKEN in partial.text, TOKEN in failed.text],
        "in_logs": TOKEN in caplog.text,
    } == {
        "statuses": [200, 200, 502],
        "in_responses": [False, False, False],
        "in_logs": False,
    }


async def test_807_i8_a_cache_for_another_user_is_ignored(
    client: AsyncClient, served: Callable[..., None], github: Callable[[Answer], list]
) -> None:
    served(user="someone-else")
    github(calendar_for_march)
    await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})
    served(user=LOGIN)
    seen = github(lambda request: httpx.Response(200, json=calendar({"2026-03-01": 7})))

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-01"})

    assert {"status": r.status_code, "answer": r.json(), "asked": len(seen)} == {
        "status": 200,
        "answer": {"on": True, "days": {"2026-03-01": 7}},
        "asked": 1,
    }


async def test_807_a6_a_range_longer_than_366_days_is_400(
    client: AsyncClient, served: Callable[..., None]
) -> None:
    served()

    r = await client.get("/api/github", params={"from": "2025-01-01", "to": "2026-01-02"})

    assert r.status_code == 400


async def test_807_a6_a_bad_date_is_422(client: AsyncClient, served: Callable[..., None]) -> None:
    served()

    r = await client.get("/api/github", params={"from": "2026-02-01", "to": "2026-02-30"})

    assert r.status_code == 422


async def test_807_a6_from_after_to_is_400(
    client: AsyncClient, served: Callable[..., None]
) -> None:
    served()

    r = await client.get("/api/github", params={"from": "2026-03-03", "to": "2026-03-02"})

    assert r.status_code == 400


async def test_807_a6_nothing_is_written_in_the_vault(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    tmp_path: Path,
) -> None:
    vault = tmp_path / "vault"
    (vault / "Notes").mkdir()
    (vault / "Notes" / "Kept.md").write_text("# Kept\n", encoding="utf-8")
    served(vault_root=vault)
    github(calendar_for_march)
    before = {path: path.read_bytes() for path in vault.rglob("*") if path.is_file()}

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})

    after = {path: path.read_bytes() for path in vault.rglob("*") if path.is_file()}
    assert {"status": r.status_code, "unchanged": after == before} == {
        "status": 200,
        "unchanged": True,
    }


async def test_807_i8_a_week_ahead_asks_once_for_the_days_read(
    client: AsyncClient, served: Callable[..., None], github: Callable[[Answer], list]
) -> None:
    served()
    today = utc_today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    # GitHub's calendar stops at today, so the days after it are never in the file.
    read_days = [(monday + timedelta(days=n)).isoformat() for n in range((today - monday).days + 1)]
    seen = github(lambda request: httpx.Response(200, json=calendar(dict.fromkeys(read_days, 1))))
    params = {"from": monday.isoformat(), "to": sunday.isoformat()}

    first = await client.get("/api/github", params=params)
    second = await client.get("/api/github", params=params)

    assert {"statuses": [first.status_code, second.status_code], "asked": len(seen)} == {
        "statuses": [200, 200],
        "asked": 1,
    }


async def test_807_i8_a_day_read_on_its_own_day_is_read_again_later(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    served()
    today = utc_today()
    week = [(today - timedelta(days=back)).isoformat() for back in range(7)]
    seen = github(lambda request: httpx.Response(200, json=calendar(dict.fromkeys(week, 1))))
    first = await client.get("/api/github", params={"from": week[0], "to": week[0]})
    assert first.status_code == 200

    # Three days on, today's count is a past day's, so it is read again and settled.
    later = datetime.now(UTC) + timedelta(days=3)
    monkeypatch.setattr("kasten_backend.github._now", lambda: later)
    second = await client.get("/api/github", params={"from": week[-1], "to": week[0]})
    asked_then = len(seen)
    # Six hours on, with the last read long past its hour, only settled days can answer.
    monkeypatch.setattr("kasten_backend.github._now", lambda: later + timedelta(hours=6))
    third = await client.get("/api/github", params={"from": week[-1], "to": week[0]})

    assert {
        "statuses": [second.status_code, third.status_code],
        "asked": [asked_then, len(seen)],
    } == {"statuses": [200, 200], "asked": [2, 2]}


async def test_807_i8_an_unreadable_cache_is_no_cache(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    tmp_path: Path,
) -> None:
    served()
    # A folder where the cache file should be: it cannot be read, nor replaced.
    (tmp_path / CACHE_NAME).mkdir()
    seen = github(calendar_for_march)

    r = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"})

    assert {"status": r.status_code, "answer": r.json(), "asked": len(seen)} == {
        "status": 200,
        "answer": {"on": True, "days": {"2026-03-01": 3, "2026-03-02": 0}},
        "asked": 1,
    }


async def test_807_i8_two_reads_at_once_keep_both_ranges(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    tmp_path: Path,
) -> None:
    served()
    github(
        lambda request: httpx.Response(
            200, json=calendar({"2026-03-01": 1, "2026-03-02": 2, "2026-03-10": 3, "2026-03-11": 4})
        )
    )

    early, late = await asyncio.gather(
        client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-02"}),
        client.get("/api/github", params={"from": "2026-03-10", "to": "2026-03-11"}),
    )

    assert [early.status_code, late.status_code] == [200, 200]
    stored = json.loads((tmp_path / CACHE_NAME).read_text(encoding="utf-8"))
    assert sorted(stored["days"]) == ["2026-03-01", "2026-03-02", "2026-03-10", "2026-03-11"]


@pytest.fixture
def berlin() -> Iterator[None]:
    """Run with the process in Europe/Berlin, whose day starts two hours before UTC's does."""
    before = os.environ.get("TZ")
    os.environ["TZ"] = "Europe/Berlin"
    time.tzset()
    yield
    # Put the zone back by hand: undoing the monkeypatch here would also unpatch the fake.
    if before is None:
        del os.environ["TZ"]
    else:
        os.environ["TZ"] = before
    time.tzset()


async def test_807_i8_a_day_is_not_settled_before_it_ends_in_utc(
    client: AsyncClient,
    served: Callable[..., None],
    github: Callable[[Answer], list],
    monkeypatch: pytest.MonkeyPatch,
    berlin: None,
) -> None:
    served()
    seen = github(
        lambda request: httpx.Response(200, json=calendar({"2026-10-24": 5, "2026-03-01": 1}))
    )
    # A read of an unrelated past day first, so the rest is not the first read of the file.
    warm = await client.get("/api/github", params={"from": "2026-03-01", "to": "2026-03-01"})
    assert warm.status_code == 200

    # 22:30 UTC on the 24th is already the 25th in Berlin, but the 24th has not ended in UTC.
    monkeypatch.setattr(
        "kasten_backend.github._now", lambda: datetime(2026, 10, 24, 22, 30, tzinfo=UTC)
    )
    first = await client.get("/api/github", params={"from": "2026-10-24", "to": "2026-10-24"})
    # An hour and a quarter on, still the 24th in UTC: the day is not settled, so it is read again.
    monkeypatch.setattr(
        "kasten_backend.github._now", lambda: datetime(2026, 10, 24, 23, 45, tzinfo=UTC)
    )
    second = await client.get("/api/github", params={"from": "2026-10-24", "to": "2026-10-24"})

    assert {"statuses": [first.status_code, second.status_code], "asked": len(seen)} == {
        "statuses": [200, 200],
        "asked": 3,
    }
