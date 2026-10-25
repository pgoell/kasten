"""The finance ingest API: idempotent bookings, splits that add up, transfers, and no database.

Every test goes through the routes. All but the last need a migrated
database and skip without one; see the `finance_client` fixture.
"""

from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from kasten_backend import db

if TYPE_CHECKING:
    import pytest
    from httpx import AsyncClient

GIRO = "DE02120300000000202051"
SAVING = "DE02500105170137075030"
STRANGER = "DE89370400440532013000"


async def account(client: AsyncClient, name: str, iban: str | None = None) -> int:
    response = await client.post(
        "/api/finance/accounts", json={"name": name, "bank": "DKB", "iban": iban, "kind": "giro"}
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def booking(account_id: int, key: str, amount: str = "-4.20", **fields: Any) -> dict[str, Any]:
    return {
        "account_id": account_id,
        "booking_date": "2026-10-20",
        "amount": amount,
        "purpose": "Bäckerei",
        "source_key": key,
        **fields,
    }


async def post(client: AsyncClient, bookings: list[dict[str, Any]]) -> dict[str, int]:
    response = await client.post("/api/finance/transactions", json=bookings)
    assert response.status_code == 200, response.text
    return response.json()


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


async def test_the_same_key_twice_in_one_batch_inserts_once(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro")

    created = await post(finance_client, [booking(giro, "k"), booking(giro, "k", amount="-9.99")])

    assert created == {"created": 1, "skipped": 1, "linked": 0}
    stored = (await finance_client.get("/api/finance/transactions")).json()
    assert [row["amount"] for row in stored] == ["-4.20"]


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


async def test_a_move_between_own_accounts_is_paired_once_and_a_lookalike_is_not(
    finance_client: AsyncClient,
) -> None:
    giro = await account(finance_client, "Giro", iban=GIRO)
    saving = await account(finance_client, "Saving", iban=SAVING)
    out = booking(giro, "out", amount="-100.00", counterparty_iban=SAVING)
    # The same amount to someone else, the same day: no twin of anything.
    lookalike = booking(giro, "rent", amount="-100.00", counterparty_iban=STRANGER)
    # Booked on the other side two days later, as an ordinary transfer is.
    into = booking(saving, "in", amount="100.00", booking_date="2026-10-22", counterparty_iban=GIRO)

    # The halves in two posts, as two pulls would send them.
    assert (await post(finance_client, [out, lookalike]))["linked"] == 0
    assert (await post(finance_client, [into]))["linked"] == 1
    assert (await post(finance_client, [out, lookalike, into]))["linked"] == 0

    rows = (await finance_client.get("/api/finance/transactions")).json()
    groups = {row["source_key"]: row["transfer_group"] for row in rows}
    assert groups["out"] is not None
    assert groups["out"] == groups["in"]
    assert groups["rent"] is None


async def test_bookings_too_far_apart_are_not_a_transfer(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro", iban=GIRO)
    saving = await account(finance_client, "Saving", iban=SAVING)

    linked = await post(
        finance_client,
        [
            booking(giro, "out", amount="-50.00", counterparty_iban=SAVING),
            booking(saving, "in", amount="50.00", booking_date="2026-11-20"),
        ],
    )

    assert linked["linked"] == 0


async def test_balances_keep_the_latest_report_for_a_day(finance_client: AsyncClient) -> None:
    giro = await account(finance_client, "Giro")
    day = {"account_id": giro, "date": "2026-10-20"}

    first = await finance_client.post("/api/finance/balances", json=[{**day, "amount": "10.00"}])
    again = await finance_client.post("/api/finance/balances", json=[{**day, "amount": "12.50"}])

    assert first.json() == again.json() == {"stored": 1}


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
