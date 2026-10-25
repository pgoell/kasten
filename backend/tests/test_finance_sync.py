"""The sync routes: "pull now", runs, the claim two pollers race for, and the status."""

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from kasten_backend import finance_sync
from kasten_backend.config import get_settings

from .finance_rows import GIRO, SAVING, account, booking, post

if TYPE_CHECKING:
    from httpx import AsyncClient


@pytest.fixture
async def sync_client(finance_client: AsyncClient, finance_session: AsyncSession) -> AsyncClient:
    """The finance client, skipping on a database migrated before the sync tables."""
    if await finance_session.scalar(text("SELECT to_regclass('finance.sync_run')")) is None:
        pytest.skip("No sync tables in the database: run `mise run db:migrate`")
    return finance_client


async def start(client: AsyncClient, trigger: str = "request") -> dict:
    response = await client.post("/api/finance/sync/runs", json={"trigger": trigger})
    assert response.status_code == 200, response.text
    return response.json()


async def finish(client: AsyncClient, run_id: int, outcome: str, accounts: list[dict]) -> None:
    response = await client.patch(
        f"/api/finance/sync/runs/{run_id}", json={"outcome": outcome, "accounts": accounts}
    )
    assert response.status_code == 200, response.text


def fetched(account_id: int, through: str, outcome: str = "ok") -> dict:
    return {
        "account_id": account_id,
        "fetched_from": "2026-10-01",
        "fetched_through": through,
        "outcome": outcome,
        "created": 3,
    }


async def test_pressing_pull_now_twice_asks_once(sync_client: AsyncClient) -> None:
    first = (await sync_client.post("/api/finance/sync/requests")).json()
    second = (await sync_client.post("/api/finance/sync/requests")).json()

    assert first["id"] == second["id"]
    assert first["run_id"] is None
    status = (await sync_client.get("/api/finance/sync")).json()
    assert status["requested_at"] == first["requested_at"]


async def test_a_run_claims_the_request_and_a_second_poller_gets_nothing(
    sync_client: AsyncClient,
) -> None:
    await sync_client.post("/api/finance/sync/requests")

    started = await start(sync_client)
    again = await sync_client.post("/api/finance/sync/runs", json={"trigger": "request"})

    assert started["claimed"] == 1
    assert again.status_code == 409
    assert (await sync_client.get("/api/finance/sync")).json()["requested_at"] is None


async def test_a_run_for_a_request_with_none_open_is_refused(sync_client: AsyncClient) -> None:
    response = await sync_client.post("/api/finance/sync/runs", json={"trigger": "request"})

    assert response.status_code == 409
    assert "No sync request" in response.json()["detail"]


async def test_a_finished_run_lets_the_next_one_start(sync_client: AsyncClient) -> None:
    run = (await start(sync_client, "scheduled"))["run"]
    await finish(sync_client, run["id"], "failed", [])

    nxt = await start(sync_client, "scheduled")

    assert nxt["run"]["id"] > run["id"]
    assert nxt["claimed"] == 0


async def test_two_pollers_at_once_cannot_both_start(
    sync_client: AsyncClient, finance_session: AsyncSession
) -> None:
    # The first poller's transaction stays open, its lock held, until the
    # fixture rolls it back, and the second poller has a connection of its own.
    await sync_client.post("/api/finance/sync/requests")
    await finance_sync.start_run(finance_session, "request")
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        async with AsyncSession(engine) as other:
            with pytest.raises(finance_sync.RunBusyError):
                await finance_sync.start_run(other, "request")
            await other.rollback()
    finally:
        await engine.dispose()


async def test_the_status_names_the_last_good_window_of_each_account(
    sync_client: AsyncClient,
) -> None:
    giro, saving = (
        await account(sync_client, "Giro", GIRO),
        await account(sync_client, "Tagesgeld", SAVING),
    )
    await post(sync_client, [booking(giro, "a:0", booking_date="2026-10-18")])
    first = (await start(sync_client, "scheduled"))["run"]
    await finish(
        sync_client, first["id"], "ok", [fetched(giro, "2026-10-20"), fetched(saving, "2026-10-20")]
    )
    second = (await start(sync_client, "scheduled"))["run"]
    await finish(
        sync_client,
        second["id"],
        "failed",
        [fetched(giro, "2026-10-25"), fetched(saving, "2026-10-25", "failed")],
    )

    status = (await sync_client.get("/api/finance/sync")).json()

    by_name = {row["name"]: row for row in status["accounts"]}
    assert by_name["Giro"]["last_good_through"] == "2026-10-25"
    assert by_name["Giro"]["newest_booking"] == "2026-10-18"
    assert by_name["Giro"]["days_since_success"] == 0
    assert by_name["Tagesgeld"]["last_good_through"] == "2026-10-20"
    assert by_name["Tagesgeld"]["newest_booking"] is None
    assert status["last_run"]["outcome"] == "failed"
    assert status["last_success_at"] is not None
    assert status["days_since_success"] == 0


async def test_a_run_finishes_once(sync_client: AsyncClient) -> None:
    run = (await start(sync_client, "scheduled"))["run"]
    await finish(sync_client, run["id"], "ok", [])

    again = await sync_client.patch(f"/api/finance/sync/runs/{run['id']}", json={"outcome": "ok"})

    assert again.status_code == 409


async def test_finishing_names_unknown_runs_and_accounts(sync_client: AsyncClient) -> None:
    run = (await start(sync_client, "scheduled"))["run"]

    no_run = await sync_client.patch("/api/finance/sync/runs/999999", json={"outcome": "ok"})
    no_account = await sync_client.patch(
        f"/api/finance/sync/runs/{run['id']}",
        json={"outcome": "ok", "accounts": [fetched(999999, "2026-10-25")]},
    )

    assert no_run.status_code == 404
    assert no_account.status_code == 422
    assert "999999" in no_account.json()["detail"]


async def test_a_status_with_no_runs_says_so(sync_client: AsyncClient) -> None:
    status = (await sync_client.get("/api/finance/sync")).json()

    assert status["last_run"] is None
    assert status["days_since_success"] is None


async def test_a_run_dead_for_31_minutes_does_not_block_the_next(
    sync_client: AsyncClient, finance_session: AsyncSession
) -> None:
    await finance_session.execute(
        text(
            "INSERT INTO finance.sync_run (trigger, started_at) "
            "VALUES ('scheduled', now() - interval '31 minutes')"
        )
    )

    nxt = await sync_client.post("/api/finance/sync/runs", json={"trigger": "scheduled"})

    assert nxt.status_code == 200, nxt.text


async def test_a_run_29_minutes_old_still_blocks(
    sync_client: AsyncClient, finance_session: AsyncSession
) -> None:
    await finance_session.execute(
        text(
            "INSERT INTO finance.sync_run (trigger, started_at) "
            "VALUES ('scheduled', now() - interval '29 minutes')"
        )
    )

    nxt = await sync_client.post("/api/finance/sync/runs", json={"trigger": "scheduled"})

    assert nxt.status_code == 409


async def test_the_open_request_is_a_404_until_one_waits(sync_client: AsyncClient) -> None:
    assert (await sync_client.get("/api/finance/sync/requests/open")).status_code == 404

    made = (await sync_client.post("/api/finance/sync/requests")).json()
    found = await sync_client.get("/api/finance/sync/requests/open")

    assert found.status_code == 200
    assert found.json()["id"] == made["id"]


@pytest.mark.parametrize(
    ("first", "through"),
    [("2026-10-20", "2026-10-19"), ("2026-10-01", "2999-01-01")],
)
async def test_a_window_backwards_or_in_the_future_is_refused(
    sync_client: AsyncClient, first: str, through: str
) -> None:
    giro = await account(sync_client, "Giro", GIRO)
    run = (await start(sync_client, "scheduled"))["run"]
    line = {**fetched(giro, through), "fetched_from": first}

    response = await sync_client.patch(
        f"/api/finance/sync/runs/{run['id']}", json={"outcome": "ok", "accounts": [line]}
    )

    assert response.status_code == 422


async def test_the_status_says_a_run_is_running_until_it_finishes(
    finance_client: AsyncClient,
) -> None:
    started = await finance_client.post("/api/finance/sync/runs", json={"trigger": "scheduled"})
    running = (await finance_client.get("/api/finance/sync")).json()["running"]
    await finance_client.patch(
        f"/api/finance/sync/runs/{started.json()['run']['id']}",
        json={"outcome": "ok", "accounts": []},
    )
    done = (await finance_client.get("/api/finance/sync")).json()["running"]

    assert (running, done) == (True, False)
