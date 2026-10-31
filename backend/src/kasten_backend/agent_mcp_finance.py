"""The finance reads, served as MCP tools beside the vault's eight.

Thin wrappers over the pane's route functions, so a tool answers what the pane shows.
All of them only read. Their docstrings are what models read, since the MCP
instructions are close to the 2KiB Claude Code keeps.
"""

import logging
from datetime import date  # noqa: TC003  the SDK reads the annotation at runtime
from typing import TYPE_CHECKING, Any, Literal

from fastapi import HTTPException
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy.exc import SQLAlchemyError

from kasten_backend import agent_finance, db
from kasten_backend.routes import (
    finance_budget,
    finance_drill,
    finance_goals,
    finance_plans,
    finance_tax,
)
from kasten_backend.routes import finance_sync as sync

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from pydantic import BaseModel
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

UNREADABLE = "Finance could not be read just now; the server log says why"
"""What a tool says when the database fails mid-read, in place of the driver's text."""


async def _read(read: Callable[[AsyncSession], Awaitable[BaseModel]]) -> dict[str, Any]:
    """One read on its own session, as JSON, its refusals as tool errors.

    A refusal is an `HTTPException` because the reads are the routes'. The 503 of a
    backend with no database is one, so a tool says what a route says.
    """
    try:
        async with db.session() as session:
            found = await read(session)
    except HTTPException as refused:
        raise ToolError(str(refused.detail)) from refused
    except SQLAlchemyError as failed:
        # The driver's text can carry the statement and its values, which are
        # the user's bookings and no use to a model. The log keeps them.
        logger.exception("A finance tool failed on the database")
        raise ToolError(UNREADABLE) from failed
    # JSON mode, so an amount comes as the string the routes send, to the cent.
    return found.model_dump(mode="json")


async def free_to_spend(month: str, today: date) -> dict[str, Any]:
    """What is free to spend in `month` (YYYY-MM), for "mine" and for "household", and its parts.

    Read this first for any question about money. The rules every finance tool
    follows: amounts are euros as strings, negative is money out. "mine" is
    the user's own accounts, "household" the shared account; an own saving
    account is in neither. The user's transfer into the shared account counts
    as a fixed cost on mine and as income on household, so never add the two
    scopes' income. A move between own accounts has no category and is no
    spending. Budget months are calendar months, but a salary booked after the
    cutoff day counts for the next month. `today` is the user's local date:
    "so far" and the average-based lines depend on it. The total is income less
    fixed, flexible and non-monthly costs, unsorted spending, saving, the
    plans' reserves and the goals' contributions still to move.
    """
    return await _read(lambda s: finance_budget.read_free_to_spend(s, month, today.isoformat()))


async def monthly_by_category(month: str, today: date) -> dict[str, Any]:
    """Every spending category's `month` (YYYY-MM), both scopes together: the budget table.

    Per category: its limit, the overspend `carried` off it from last month,
    what is `available`, what was `spent`, its 6-month average, what pace
    expects by `today` (the user's local date) and a status of ok, near or
    over. `unreserved` is what the limits left in earlier months, less what
    went into goals. Rules as in free_to_spend.
    """
    return await _read(lambda s: finance_budget.read_budget(s, month, today.isoformat()))


async def goal_progress(today: date) -> dict[str, Any]:
    """Every saving goal: target, due date, reserved, progress (0 to 1), monthly need.

    Also each own saving account's bank balance, what its goals reserve and
    the rest. `this_month` is the month's planned contribution and what of it
    moved into the account. `today` is the user's local date.
    """
    return await _read(lambda s: finance_goals.read_goals(s, today.isoformat()))


async def plan_forecast(today: date) -> dict[str, Any]:
    """Each scope's balance at the end of this month and the 11 after, by its plans alone.

    `upcoming` is every date a plan falls due in this month, with the booking
    that met it or null. A plan that `reserves` sets its monthly share aside
    off free to spend until the bill comes. `today` is the user's local date.
    """
    day = today.isoformat()

    async def both(session: AsyncSession) -> agent_finance.Forecast:
        return agent_finance.Forecast(
            forecast=await finance_plans.read_forecast(session, day),
            upcoming=await finance_plans.read_upcoming(session, day[:7]),
        )

    return await _read(both)


async def sync_status() -> dict[str, Any]:
    """When the bank sync last ran and succeeded, and each account's newest booking.

    Check it before trusting a recent figure: bookings since the last good
    pull are not in yet.
    """
    return await _read(sync.read_status)


async def tax_year_summary(year: int) -> dict[str, Any]:
    """The tax `year` (paid in it, by booking date) as the Tax tab shows it: totals per line.

    Lines: werbungskosten (Anlage N), sonderausgaben, §35a haushaltsnahe_dienste
    and handwerker (labour only), aussergewoehnliche_belastungen. A marked
    refund counts negative. `werbungskosten_over` is the part above `allowance`,
    the year's (1,230 from 2023, 1,200 in 2022, 1,000 before). Also the
    bookings missing a receipt and unmarked money back.
    """
    return await _read(lambda s: finance_tax.read_year(s, year))


async def list_transactions(  # noqa: PLR0913  each filter is its own argument
    *,
    month: str | None = None,
    start: date | None = None,
    end: date | None = None,
    scope: Literal["mine", "household"] | None = None,
    account: int | None = None,
    category: int | None = None,
    payee: int | None = None,
    text: str | None = None,
    oldest_first: bool = False,
    after: int | None = None,
    limit: int = agent_finance.PAGE,
) -> dict[str, Any]:
    """A page of single bookings, newest first, narrowed by the filters given.

    Prefer the summary tools for a total: summing a page misses the rules
    (cutoff, transfers, splits). `month` (YYYY-MM) or `start`/`end` go by
    booking date, not by budget month. `text` matches purpose, counterparty and
    payee, ignoring case. Ids come from finance_lookup. A booking with splits
    keeps its categories on them. Up to 500 a page, 100 by default; pass
    `next` back as `after` for the page after, null means the last.
    """
    # Before the read, so a refusal names this tool's `start` and `end` rather
    # than the routes' `from` and `to`.
    if month is not None and (start is not None or end is not None):
        raise ToolError("`month` comes without `start` and `end`")
    if start is not None and end is not None and start > end:
        raise ToolError("`start` is after `end`")

    def page(session: AsyncSession) -> Awaitable[agent_finance.BookingPage]:
        return agent_finance.bookings(
            session,
            month=month,
            start=None if start is None else start.isoformat(),
            end=None if end is None else end.isoformat(),
            scope=scope,
            account=account,
            category=category,
            payee=payee,
            text=text,
            newest_first=not oldest_first,
            after=after,
            limit=limit,
        )

    return await _read(page)


async def read_transaction(transaction_id: int) -> dict[str, Any]:
    """One booking whole: every field and the bank's raw record, its account and payee.

    Also its twin when it is a move between own accounts, the plans it met,
    and `counts`: where it counts, by budget month, scope, part and category.
    """
    return await _read(lambda s: finance_drill.read_booking(transaction_id, s))


async def finance_lookup() -> dict[str, Any]:
    """Every account (with its kind and shared flag), category (with its kind) and payee, by id.

    The ids list_transactions filters by and the summaries name.
    """
    return await _read(agent_finance.lookup)


TOOLS = (
    free_to_spend,
    monthly_by_category,
    goal_progress,
    plan_forecast,
    sync_status,
    tax_year_summary,
    list_transactions,
    read_transaction,
    finance_lookup,
)
"""The finance reads, in the order the reference page lists them."""

READING = frozenset(tool.__name__ for tool in TOOLS)
"""Every one of them, since none writes."""
