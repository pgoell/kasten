"""A Firefly built by hand for the import tests, and the bridge the import reaches the backend by.

The Firefly is the records `firefly.read` would answer, with no Firefly
behind them. The bridge is there because the import is sync, as the host jobs
are, and the test client is async, on the test's event loop and its
rolled-back database transaction: the test runs the import in a worker
thread, and the bridge hands each request back to that loop, which is free
while the test awaits the thread.
"""

import asyncio
from datetime import date
from decimal import Decimal

import httpx

from kasten_jobs.firefly import Account, Firefly, Journal, Leg, Trigger

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
    """A Firefly with the accounts above, the journals given and two categories."""
    return Firefly(ACCOUNTS, list(journals), ["Dining", "Groceries"], list(triggers))


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
