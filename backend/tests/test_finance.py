"""The finance ingest API: idempotent bookings, accounts, balances, splits, paging, no database.

Every test goes through the routes. All but the 503 test need a migrated
database and skip without one; see the `finance_session` fixture. Linking is
in `test_finance_transfers.py`.

Two writers at once are not tested here: the advisory lock in
`finance.link_transfers` and the row lock in `finance.replace_splits` are
what keep them apart, and a test of that would race the scheduler.
"""

from pathlib import Path
from typing import TYPE_CHECKING

import psycopg
import pytest
from sqlalchemy import event, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from backend.tests.finance_rows import GIRO, account, booking, post
from kasten_backend import db, finance
from kasten_backend.finance_models import BalanceSnapshot

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession


async def test_two_identical_bookings_with_their_own_keys_both_survive_a_second_post(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    pair = [
        booking(giro, "2026-10-20|-4.20|Bäckerei|0"),
        booking(giro, "2026-10-20|-4.20|Bäckerei|1"),
    ]

    assert await post(finance_client, pair) == {"created": 2, "skipped": 0, "linked": 0}
    assert await post(finance_client, pair) == {"created": 0, "skipped": 2, "linked": 0}

    stored = (
        await finance_client.get("/api/finance/transactions", params={"account": giro})
    ).json()
    assert [row["source_key"] for row in stored] == [pair[0]["source_key"], pair[1]["source_key"]]
    assert stored[0]["amount"] == "-4.20"
    assert stored[0]["currency"] == "EUR"


async def test_the_same_booking_twice_in_one_batch_inserts_once(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")

    created = await post(finance_client, [booking(giro, "k"), booking(giro, "k")])

    assert created == {"created": 1, "skipped": 1, "linked": 0}


async def test_two_different_bookings_under_one_key_are_refused(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")

    response = await finance_client.post(
        "/api/finance/transactions",
        json=[booking(giro, "k"), booking(giro, "k", amount="-9.99")],
    )

    assert response.status_code == 422
    assert "'k'" in response.json()["detail"]
    assert (await finance_client.get("/api/finance/transactions")).json() == []


async def test_a_booking_keeps_the_raw_record_it_came_with(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro")

    await post(finance_client, [booking(giro, "k", raw={"bookingText": "KARTENZAHLUNG"})])

    (stored,) = (await finance_client.get("/api/finance/transactions")).json()
    assert stored["raw"] == {"bookingText": "KARTENZAHLUNG"}


async def test_a_batch_over_the_cap_is_refused(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro")
    batch = [booking(giro, str(number)) for number in range(1001)]

    response = await finance_client.post("/api/finance/transactions", json=batch)

    assert response.status_code == 422


async def test_an_iban_another_account_holds_is_a_409(finance_client: AsyncClient) -> None:
    await account(finance_client, "Giro", iban=GIRO)

    response = await finance_client.post(
        "/api/finance/accounts", json={"name": "Saving", "iban": GIRO, "kind": "saving"}
    )

    assert response.status_code == 409


async def test_a_booking_on_an_unknown_account_is_refused_with_its_batch(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")

    response = await finance_client.post(
        "/api/finance/transactions", json=[booking(giro, "a"), booking(giro + 1000, "b")]
    )

    assert response.status_code == 422
    assert (await finance_client.get("/api/finance/transactions")).json() == []


async def test_an_account_posted_again_by_name_is_updated_not_doubled(
    finance_client: AsyncClient,
) -> None:
    first = await account(finance_client, "Giro")
    second = await account(finance_client, "Giro", iban=GIRO)

    assert first == second
    accounts = (await finance_client.get("/api/finance/accounts")).json()
    assert [(row["name"], row["iban"]) for row in accounts] == [("Giro", GIRO)]


async def test_an_account_posted_again_without_its_iban_keeps_it(
    finance_client: AsyncClient,
) -> None:
    await finance_client.post(
        "/api/finance/accounts",
        json={"name": "Shared", "iban": GIRO, "kind": "giro", "shared": True},
    )

    await finance_client.post("/api/finance/accounts", json={"name": "Shared", "kind": "giro"})

    (stored,) = (await finance_client.get("/api/finance/accounts")).json()
    assert (stored["iban"], stored["shared"]) == (GIRO, True)


async def test_splits_that_do_not_add_up_are_refused_and_nothing_is_written(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    await post(finance_client, [booking(giro, "order", amount="-30.00")])
    (stored,) = (await finance_client.get("/api/finance/transactions")).json()
    url = f"/api/finance/transactions/{stored['id']}/splits"

    refused = await finance_client.put(url, json=[{"amount": "-20.00"}, {"amount": "-9.99"}])
    assert refused.status_code == 422
    assert "-29.99" in refused.json()["detail"]

    split = await finance_client.put(
        url, json=[{"amount": "-20.00", "text": "Book"}, {"amount": "-10.00", "text": "Cable"}]
    )
    assert split.status_code == 200, split.text
    assert [(part["amount"], part["text"]) for part in split.json()["splits"]] == [
        ("-20.00", "Book"),
        ("-10.00", "Cable"),
    ]

    cleared = await finance_client.put(url, json=[])
    assert cleared.json()["splits"] == []


async def test_splits_of_a_missing_booking_are_a_404(finance_client: AsyncClient) -> None:
    response = await finance_client.put("/api/finance/transactions/0/splits", json=[])

    assert response.status_code == 404


async def test_a_later_balance_for_a_day_replaces_the_earlier(
    finance_client: AsyncClient, finance_session: AsyncSession
) -> None:
    giro = await account(finance_client, "Giro")
    day = {"account_id": giro, "date": "2026-10-20"}

    first = await finance_client.post("/api/finance/balances", json=[{**day, "amount": "10.00"}])
    # Two reports for one day in one batch: the later one wins.
    again = await finance_client.post(
        "/api/finance/balances", json=[{**day, "amount": "11.00"}, {**day, "amount": "12.50"}]
    )

    assert first.json() == again.json() == {"stored": 1}
    stored = await finance_session.scalars(select(BalanceSnapshot.amount))
    assert [str(amount) for amount in stored] == ["12.50"]


async def test_bookings_are_read_a_page_at_a_time_in_booking_order(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro")
    # Posted out of order, as an import that fills in the past would.
    days = ["2026-10-03", "2026-10-01", "2026-10-02", "2026-10-01"]
    await post(finance_client, [booking(giro, f"k{n}", booking_date=d) for n, d in enumerate(days)])

    read: list[str] = []
    after = None
    while True:
        params = {"limit": 2} | ({"after": after} if after is not None else {})
        page = (await finance_client.get("/api/finance/transactions", params=params)).json()
        read += [row["source_key"] for row in page]
        if len(page) < 2:
            break
        after = page[-1]["id"]

    assert read == ["k1", "k3", "k2", "k0"]


async def test_without_a_database_finance_answers_503_and_the_rest_runs(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Port 1 refuses at once. `client` ran the startup with no database either.
    nowhere = create_async_engine("postgresql+psycopg://kasten:kasten@127.0.0.1:1/none")
    monkeypatch.setattr(db, "session_factory", async_sessionmaker(nowhere))

    response = await client.get("/api/finance/accounts")

    assert response.status_code == 503
    assert "KASTEN_DATABASE_URL" in response.json()["detail"]
    assert (await client.get("/api/health")).status_code == 200
    await nowhere.dispose()


async def test_a_database_failure_after_the_connect_is_not_a_503(
    finance_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def timed_out(_session: AsyncSession) -> None:
        raise OperationalError("SELECT 1", {}, Exception("canceling statement due to timeout"))

    monkeypatch.setattr(finance, "list_accounts", timed_out)

    # Not caught as a missing database, so it reaches the client as the error it is.
    with pytest.raises(OperationalError):
        await finance_client.get("/api/finance/accounts")


# A pooled connection the server closed, as a postgres restart does (#1327). The shared
# postgres serves prod, so a second connection ends the pooled one on the scratch database,
# and a `do_connect` listener stands in for a database still down.


@pytest.fixture
async def pooled(
    scratch_database: str, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[AsyncEngine]:
    """An engine built as the app builds its own, holding one connection the server closed."""
    engine = db.make_engine(scratch_database)
    monkeypatch.setattr(db, "session_factory", async_sessionmaker(engine, expire_on_commit=False))
    async with engine.connect() as connection:
        pid = await connection.scalar(text("SELECT pg_backend_pid()"))
    killer = create_async_engine(scratch_database, poolclass=NullPool)
    async with killer.connect() as connection:
        # The timeout waits until the backend is gone, so the pool holds a dead socket.
        ended = await connection.scalar(
            text("SELECT pg_terminate_backend(:pid, 5000)"), {"pid": pid}
        )
        assert ended
    await killer.dispose()
    yield engine
    await engine.dispose()


def refuse(*_args: object) -> None:
    raise psycopg.OperationalError("connection refused")


async def test_after_the_server_closes_a_pooled_connection_finance_answers_200(
    client: AsyncClient, pooled: AsyncEngine
) -> None:
    assert (await client.get("/api/finance/accounts")).status_code == 200


async def test_while_the_database_refuses_connects_finance_answers_503_not_500(
    client: AsyncClient, pooled: AsyncEngine
) -> None:
    event.listen(pooled.sync_engine, "do_connect", refuse)

    response = await client.get("/api/finance/accounts")

    event.remove(pooled.sync_engine, "do_connect", refuse)
    assert response.status_code == 503


async def test_once_the_database_takes_connects_again_finance_answers_200(
    client: AsyncClient, pooled: AsyncEngine
) -> None:
    event.listen(pooled.sync_engine, "do_connect", refuse)
    assert (await client.get("/api/finance/accounts")).status_code == 503
    event.remove(pooled.sync_engine, "do_connect", refuse)

    assert (await client.get("/api/finance/accounts")).status_code == 200


def test_only_db_py_builds_an_engine() -> None:
    src = Path(__file__).parents[1] / "src"
    builders = {
        path.relative_to(src).as_posix()
        for path in src.rglob("*.py")
        if "create_engine(" in (source := path.read_text(encoding="utf-8"))
        or "create_async_engine(" in source
    }
    assert builders == {"kasten_backend/db.py"}
