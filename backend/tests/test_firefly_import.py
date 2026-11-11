"""The Firefly import against a hand-built Firefly and the test backend: keys, transfers, sorts.

The bridge is there because the import is sync, as the host jobs are, and the test client is
async, on the test's event loop: the import runs in a worker thread, and the bridge hands each
request back to that loop, which is free while the test awaits the thread.
"""

import asyncio
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
import pytest

from kasten_jobs.firefly import (
    Account,
    Firefly,
    Journal,
    Leg,
    Trigger,
    run,
    skipped_journals,
    without,
)
from kasten_jobs.kasten_api import KastenApi

GIRO = Account(
    1, "DKB Personal Girokonto", "Asset account", "DE05120300001201603451", "defaultAsset"
)
SHARED = Account(
    6, "DKB Shared Girokonto", "Asset account", "DE72120300001082359660", "sharedAsset"
)
SAVING = Account(3, "DKB Personal Saving", "Asset account", "DE48120300001306206119", "savingAsset")
CASH = Account(4, "Cash wallet", "Asset account", None, "cashWalletAsset")
REWE = Account(20, "REWE Markt GmbH", "Expense account", None, None)
UNKNOWN = Account(21, "Unknown payee", "Expense account", None, None)
EMPLOYER = Account(22, "Deloitte GmbH", "Revenue account", None, None)
ACCOUNTS = {a.id: a for a in (GIRO, SHARED, SAVING, CASH, REWE, UNKNOWN, EMPLOYER)}

DAY = date(2026, 10, 20)


def journal(  # noqa: PLR0913  a record of many fields, each test naming a few
    journal_id: int,
    amount: str,
    *,
    to: Account = REWE,
    on: Account = GIRO,
    kind: str = "Withdrawal",
    day: date = DAY,
    external_id: str | None = None,
    notes: str | None = None,
    category: str | None = None,
    description: str = "REWE SAGT DANKE",
) -> Journal:
    """A journal: `amount` is `on`'s side, signed; `to` takes the opposite.

    Its `external_id` is shaped like the importer's unless one is given; an
    empty one gives a journal with none.
    """
    legs = (Leg(on.id, Decimal(amount)), Leg(to.id, -Decimal(amount)))
    if external_id is None:
        external_id = f"dkb:{on.iban}:{day}:{amount}::abc123def456"
    return Journal(
        journal_id,
        kind,
        day,
        description,
        external_id or None,
        notes,
        category,
        budget=None,
        bill=None,
        tags=(),
        legs=legs,
    )


def firefly(*journals: Journal, triggers: tuple[Trigger, ...] = ()) -> Firefly:
    """A Firefly with the accounts above, the journals given and three categories, one unused."""
    return Firefly(ACCOUNTS, list(journals), ["Dining", "Groceries", "Unused"], list(triggers))


class Bridge(httpx.BaseTransport):
    """A sync transport that sends each request through an async client on another loop."""

    def __init__(self, client: httpx.AsyncClient, loop: asyncio.AbstractEventLoop) -> None:
        self.client = client
        self.loop = loop

    async def _send(self, request: httpx.Request) -> httpx.Response:
        return await self.client.request(
            request.method, request.url, content=request.read(), headers=request.headers
        )

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        answer = asyncio.run_coroutine_threadsafe(self._send(request), self.loop).result()
        return httpx.Response(answer.status_code, content=answer.content)


MOVE = "transfer:DE05120300001201603451:DE48120300001306206119"
"""A move's key up to the date: the giro's and the saving account's IBANs, sorted."""

GROCERIES = Trigger("Auto: Groceries", "destination_account_contains", "REWE", "Groceries")


@pytest.fixture
async def kasten(finance_client: httpx.AsyncClient) -> KastenApi:
    """The job's client on the test backend. Call it from `asyncio.to_thread` only."""
    bridge = Bridge(finance_client, asyncio.get_running_loop())
    return KastenApi(httpx.Client(base_url="http://test", transport=bridge))


async def imported(kasten: KastenApi, ff: Firefly) -> dict[str, int]:
    return (await asyncio.to_thread(run, ff, kasten)).counts


async def stored(api: httpx.AsyncClient) -> list[dict[str, Any]]:
    return (await api.get("/api/finance/transactions")).json()


async def test_a_second_run_changes_nothing(kasten: KastenApi, finance_client: httpx.AsyncClient):
    ff = firefly(
        journal(1, "-4.20", category="Dining"),
        journal(
            2, "-500.00", to=SAVING, kind="Transfer", external_id="transfer:x:y:2026-10-20:500"
        ),
        triggers=(GROCERIES,),
    )
    first = await imported(kasten, ff)
    before = await stored(finance_client)

    second = await imported(kasten, ff)

    assert (first["bookings created"], first["categories set by hand"]) == (3, 1)
    assert second["bookings created"] == 0
    assert second["bookings already there"] == 3
    for name in (
        "categories created",
        "rules created",
        "rules run changed",
        "categories set by hand",
    ):
        assert second[name] == 0, name
    assert await stored(finance_client) == before


async def test_twins_take_their_place_by_date_and_then_journal_id(
    kasten: KastenApi, finance_client: httpx.AsyncClient
):
    key = f"dkb:{GIRO.iban}:2026-10-20:-4.20::abc123def456"
    ff = firefly(journal(9, "-4.20", external_id=key), journal(5, "-4.20", external_id=key))

    counts = await imported(kasten, ff)

    rows = await stored(finance_client)
    by_journal = {r["raw"]["firefly"]["id"]: r["source_key"] for r in rows}
    assert by_journal == {5: f"{key}:0", 9: f"{key}:1"}
    assert counts["twins (n > 0)"] == 1


async def test_a_journal_without_external_id_is_keyed_by_its_id(
    kasten: KastenApi, finance_client: httpx.AsyncClient
):
    await imported(kasten, firefly(journal(7, "-1.00", external_id="")))

    [row] = await stored(finance_client)
    assert row["source_key"] == "firefly:7:0"


async def test_a_transfer_is_two_bookings_that_kasten_pairs(
    kasten: KastenApi, finance_client: httpx.AsyncClient
):
    key = f"transfer:{SAVING.iban}:{GIRO.iban}:2026-10-20:500.000000000000"
    ff = firefly(journal(3, "-500.000000000000", to=SAVING, kind="Transfer", external_id=key))

    await imported(kasten, ff)

    giro, saving = sorted(await stored(finance_client), key=lambda r: r["amount"])
    assert (giro["amount"], saving["amount"]) == ("-500.00", "500.00")
    # Rebuilt as the bank sync builds it, the amount to the cent, not verbatim.
    assert giro["source_key"] == saving["source_key"] == f"{MOVE}:2026-10-20:500.00:0"
    assert giro["counterparty_iban"] == SAVING.iban
    assert saving["counterparty_iban"] == GIRO.iban
    assert giro["counterparty_name"] == SAVING.name
    assert giro["transfer_group"] is not None
    assert giro["transfer_group"] == saving["transfer_group"]


async def test_the_counterparty_iban_comes_from_the_notes(
    kasten: KastenApi, finance_client: httpx.AsyncClient
):
    notes = "IBAN: DE89370400440532013000\nBezahlt mit Karte"
    await imported(kasten, firefly(journal(1, "-4.20", notes=notes)))

    [row] = await stored(finance_client)
    assert row["counterparty_iban"] == "DE89370400440532013000"
    assert row["counterparty_name"] == "REWE Markt GmbH"
    assert row["raw"]["firefly"]["notes"] == notes


async def test_firefly_unknown_payee_is_no_counterparty(
    kasten: KastenApi, finance_client: httpx.AsyncClient
):
    await imported(
        kasten, firefly(journal(1, "-4.20", to=UNKNOWN), journal(2, "10.00", to=EMPLOYER))
    )

    names = {
        r["raw"]["firefly"]["id"]: r["counterparty_name"] for r in await stored(finance_client)
    }
    assert names == {1: None, 2: "Deloitte GmbH"}


async def test_a_category_the_rules_do_not_give_is_set_by_hand(
    kasten: KastenApi, finance_client: httpx.AsyncClient
):
    ff = firefly(
        journal(1, "-4.20", category="Groceries"),
        journal(2, "-30.00", category="Dining"),
        journal(3, "-9.99"),
        journal(4, "-12.00", to=UNKNOWN, category="Dining"),
        triggers=(GROCERIES,),
    )

    counts = await imported(kasten, ff)

    categories = {
        c["name"]: c["id"] for c in (await finance_client.get("/api/finance/categories")).json()
    }
    sorted_as = {
        r["raw"]["firefly"]["id"]: (r["category_id"], r["category_set_by"])
        for r in await stored(finance_client)
    }
    assert set(categories) == {"Dining", "Groceries"}
    assert sorted_as == {
        1: (categories["Groceries"], "rule"),
        2: (categories["Dining"], "hand"),
        3: (categories["Groceries"], "rule"),
        4: (categories["Dining"], "hand"),
    }
    assert counts["categories set by hand"] == 2
    assert counts["categories sorted by a rule only"] == 1


async def test_a_payment_to_an_own_account_takes_the_transfer_key(
    kasten: KastenApi, finance_client: httpx.AsyncClient
):
    # Firefly booked this as spending, its note naming the saving account.
    ff = firefly(journal(1, "-50.00", notes=f"IBAN: {SAVING.iban}"))

    await imported(kasten, ff)

    [row] = await stored(finance_client)
    assert row["source_key"] == f"{MOVE}:2026-10-20:50.00:0"


def test_skipped_journals_come_from_the_flag_and_the_env():
    ff = firefly(journal(1, "-1.00"), journal(2, "-2.00"), journal(3, "-3.00"))

    skip = skipped_journals([1], " 3, ")

    assert [j.id for j in without(ff, skip).journals] == [2]
