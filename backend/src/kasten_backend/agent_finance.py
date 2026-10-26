"""What a token holder may read of finance: the pane's own reads, and a page of bookings.

Agents read everything, single bookings included (decided 2026-10-25), and
only read: no route or tool here writes. Every summary is the pane's route
function called as it is, from `/agent/finance/*` and from the MCP tools, so an
agent's figure for a month is the one the pane shows for it by construction.
That is why this imports from `routes/`, which `agent.py` does not: the pane's
figures are put together there, and a copy of that assembly here is a second
budget waiting to disagree with the first.

What is new is the page of bookings. The pane's own list answers up to 5,000
bookings with each one's raw bank record, which no context window wants, and
has no scope, which an agent asking about "mine" needs.
"""

import datetime as dt  # noqa: TC003  pydantic reads the annotation at runtime
import uuid  # noqa: TC003  pydantic reads the annotation at runtime
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from decimal import Decimal  # noqa: TC003  pydantic reads the annotation at runtime
from typing import TYPE_CHECKING

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict

from kasten_backend import db, finance
from kasten_backend.finance_ledger import Account, Scope, scope_of
from kasten_backend.routes.finance import (
    AccountOut,
    SplitOut,
    booking_span,
    read_accounts,
)
from kasten_backend.routes.finance_plans import (  # noqa: TC001  pydantic reads both at runtime
    DueOut,
    ForecastOut,
)
from kasten_backend.routes.finance_sorting import (
    CategoryOut,
    PayeeOut,
    read_categories,
    read_payees,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from sqlalchemy.ext.asyncio import AsyncSession

PAGE = 100
"""How many bookings a page holds when the caller names no `limit`."""

MAX_PAGE = 500
"""The most bookings one page holds."""

sessions: Callable[[], AsyncIterator[AsyncSession]] = db.get_session
"""Where the MCP tools get a session, which no FastAPI dependency hands them.

The routes' own dependency, so a backend with no database refuses a tool in
the words it refuses a route in. A module global so the tests can point it at
the session their rows are in, the way they override the routes' dependency.
"""


def session() -> AbstractAsyncContextManager[AsyncSession]:
    """One session for one tool call, closed when the call ends, whatever it raised."""
    return asynccontextmanager(sessions)()


class BookingOut(BaseModel):
    """A booking as a page lists it: no raw bank record, which `read_transaction` has."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    booking_date: dt.date
    value_date: dt.date | None
    amount: Decimal
    currency: str
    purpose: str | None
    posting_text: str | None
    counterparty_name: str | None
    counterparty_iban: str | None
    transfer_group: uuid.UUID | None
    payee_id: int | None
    category_id: int | None
    splits: list[SplitOut]


class BookingPage(BaseModel):
    """A page of bookings, and the `after` that asks for the next; null on the last page."""

    bookings: list[BookingOut]
    next: int | None


class Forecast(BaseModel):
    """The forecast, and the dates the plans fall due this month: the pane's plans tab."""

    forecast: ForecastOut
    upcoming: list[DueOut]


class Lookup(BaseModel):
    """The ids the filters and the summaries name: accounts, categories and payees."""

    accounts: list[AccountOut]
    categories: list[CategoryOut]
    payees: list[PayeeOut]


async def _in_scope(session: AsyncSession, scope: Scope) -> tuple[int, ...]:
    """The accounts of a scope: an own saving account is in neither."""
    return tuple(
        account.id
        for account in await finance.list_accounts(session)
        if scope_of(Account(account.shared, account.kind)) == scope
    )


async def bookings(  # noqa: PLR0913  each filter is its own argument
    session: AsyncSession,
    *,
    month: str | None = None,
    start: str | None = None,
    end: str | None = None,
    scope: Scope | None = None,
    account: int | None = None,
    category: int | None = None,
    payee: int | None = None,
    text: str | None = None,
    newest_first: bool = True,
    after: int | None = None,
    limit: int = PAGE,
) -> BookingPage:
    """A page of the bookings that pass every filter given, newest first unless told otherwise.

    `month` is by booking date, as the pane's list reads it, not the budget
    month a salary past the cutoff counts in. It stands for `start` and `end`,
    so the two cannot come with it.
    """
    first, last = booking_span(month, start, end)
    if not 1 <= limit <= MAX_PAGE:
        raise HTTPException(status_code=422, detail=f"`limit` is from 1 to {MAX_PAGE}")
    accounts = None if scope is None else await _in_scope(session, scope)
    filters = finance.Filters(account, first, last, category, text, payee, accounts)
    found = await finance.list_transactions(
        session, filters, after=after, limit=limit, newest_first=newest_first
    )
    return BookingPage(
        bookings=[BookingOut.model_validate(booking) for booking in found],
        next=found[-1].id if len(found) == limit else None,
    )


async def lookup(session: AsyncSession) -> Lookup:
    """Every account, category and payee, each by name or key."""
    return Lookup(
        accounts=await read_accounts(session),
        categories=await read_categories(session),
        payees=await read_payees(session),
    )
