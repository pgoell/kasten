"""What the drilldowns read from the tables beyond the budget's ledger. Nothing here writes.

The bookings of a budget month are read for the month before it too, since a
salary booked after the cutoff day counts for the next month, and then kept by
`finance_drill.booking_months`, the rule the ledger counts them by.
"""

from calendar import monthrange
from dataclasses import replace
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from kasten_backend import finance
from kasten_backend import finance_models as tables
from kasten_backend.finance_drill import booking_months
from kasten_backend.finance_ledger import add_months
from kasten_backend.finance_plan_models import Plan, PlanMatch

if TYPE_CHECKING:
    import datetime as dt
    from decimal import Decimal

    from sqlalchemy.ext.asyncio import AsyncSession

    from kasten_backend.finance_ledger import Category

MOST = 5000
"""The most bookings a drilldown lists; a month holds about 100."""


def last_day(month: dt.date) -> dt.date:
    """The last day of `month`."""
    return month.replace(day=monthrange(month.year, month.month)[1])


async def month_bookings(
    session: AsyncSession,
    filters: finance.Filters,
    month: dt.date,
    categories: dict[int, Category],
    cutoff: int,
) -> list[tuple[tables.Transaction, set[dt.date]]]:
    """The bookings that pass `filters` and count in budget `month`, newest first."""
    span = replace(filters, first=add_months(month, -1), last=last_day(month))
    found = await finance.list_transactions(
        session, span, after=None, limit=MOST, newest_first=True
    )
    kept = []
    for booking in found:
        parts = [(s.amount, s.category_id) for s in booking.splits] or [
            (booking.amount, booking.category_id)
        ]
        months = booking_months(booking.booking_date, parts, categories, cutoff)
        if month in months:
            kept.append((booking, months))
    return kept


async def booking_counts(  # noqa: PLR0913  each input of the count is its own argument
    session: AsyncSession,
    filters: finance.Filters,
    months: list[dt.date],
    *,
    categories: dict[int, Category],
    cutoff: int,
    own: set[str],
) -> dict[dt.date, int]:
    """How many bookings count in each of `months`; a move between own accounts is none.

    `own` is the own accounts' IBANs, which name a move whose other half is not in yet.
    """
    span = replace(filters, first=add_months(months[0], -1), last=last_day(months[-1]))
    found = await finance.list_transactions(session, span, after=None, limit=MOST)
    count = dict.fromkeys(months, 0)
    for booking in found:
        if booking.transfer_group is not None or booking.counterparty_iban in own:
            continue
        parts = [(s.amount, s.category_id) for s in booking.splits] or [
            (booking.amount, booking.category_id)
        ]
        for month in booking_months(booking.booking_date, parts, categories, cutoff):
            if month in count:
                count[month] += 1
    return count


async def snapshots(session: AsyncSession, account: int) -> list[tuple[dt.date, Decimal]]:
    """The account's bank balances, oldest first."""
    snapshot = tables.BalanceSnapshot
    rows = await session.execute(
        select(snapshot.date, snapshot.amount)
        .where(snapshot.account_id == account)
        .order_by(snapshot.date)
    )
    return [(day, amount) for day, amount in rows]


async def daily(session: AsyncSession, account: int) -> list[tuple[dt.date, Decimal]]:
    """What the account's bookings add up to on each day, oldest first."""
    booking = tables.Transaction
    rows = await session.execute(
        select(booking.booking_date, func.sum(booking.amount))
        .where(booking.account_id == account)
        .group_by(booking.booking_date)
        .order_by(booking.booking_date)
    )
    return [(day, amount) for day, amount in rows]


async def plans_of(session: AsyncSession, category: int) -> list[Plan]:
    """The plans that book into a category, by name."""
    return list(
        await session.scalars(select(Plan).where(Plan.category_id == category).order_by(Plan.name))
    )


async def rules_of(session: AsyncSession, category: int | None = None) -> list[tables.Rule]:
    """The rules, or the rules that sort into one category, by kind and pattern."""
    statement = select(tables.Rule).order_by(tables.Rule.kind, tables.Rule.pattern)
    if category is not None:
        statement = statement.where(tables.Rule.category_id == category)
    return list(await session.scalars(statement))


def names_payee(rule: tables.Rule, key: str) -> bool:
    """Whether a payee rule matches a payee key: its pattern starts at a word of the key."""
    return rule.kind == "payee" and f" {rule.pattern}" in f" {key}"


async def matched_plans(session: AsyncSession, transaction: int) -> list[tuple[int, str, dt.date]]:
    """The plan a booking met, its name and the period, as id, name and period."""
    rows = await session.execute(
        select(Plan.id, Plan.name, PlanMatch.period)
        .join(PlanMatch, PlanMatch.plan_id == Plan.id)
        .where(PlanMatch.transaction_id == transaction)
    )
    return [(plan, name, period) for plan, name, period in rows]


async def twin_of(session: AsyncSession, booking: tables.Transaction) -> tables.Transaction | None:
    """The other half of a move between own accounts, when it is in."""
    if booking.transfer_group is None:
        return None
    twin = tables.Transaction
    return await session.scalar(
        select(twin)
        .options(selectinload(twin.splits))
        .where(twin.transfer_group == booking.transfer_group, twin.id != booking.id)
    )
