"""What the drilldowns read from the tables beyond the budget's ledger. Nothing here writes.

The bookings of a budget month are read for the month before it too, since a
salary booked after the cutoff day counts for the next month, and then kept by
`finance_drill.booking_months`, the rule the ledger counts them by.
"""

from calendar import monthrange
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

from sqlalchemy import case, func, select
from sqlalchemy.orm import selectinload

from kasten_backend import finance
from kasten_backend import finance_models as tables
from kasten_backend.finance_budget_reads import cutoff_day
from kasten_backend.finance_drill import booking_months
from kasten_backend.finance_ledger import Account, add_months, scope_of
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


@dataclass(frozen=True)
class Reading:
    """What deciding a booking's budget months takes, beside the booking.

    `scoped` is the accounts in mine or household: a booking on an own saving
    account counts nowhere, so no drilldown lists it. `own` is each own
    account's IBAN, which names a move whose other half is not in yet.
    """

    categories: dict[int, Category]
    cutoff: int
    scoped: frozenset[int]
    own: dict[str, int]

    def moves(self, booking: tables.Transaction) -> bool:
        """Whether a booking is a move between own accounts, its twin in or not."""
        if booking.transfer_group is not None:
            return True
        other = self.own.get(booking.counterparty_iban or "")
        return other is not None and other != booking.account_id

    def months(
        self,
        booking: tables.Transaction,
        *,
        category: int | None = None,
        counted: bool = False,
    ) -> set[dt.date]:
        """The budget months a booking counts in, as the ledger counts it.

        With `category`, by that category's parts alone, and a move between own
        accounts in none. With `counted`, as a payee's figures count it: no
        move, no `ignore` part, no money in not sorted.
        """
        if booking.account_id not in self.scoped:
            return set()
        parts = [(s.amount, s.category_id) for s in booking.splits] or [
            (booking.amount, booking.category_id)
        ]
        if (category is not None or counted) and self.moves(booking):
            return set()
        if category is not None:
            parts = [(amount, c) for amount, c in parts if c == category]
        if counted:
            parts = [
                (amount, c)
                for amount, c in parts
                if (amount < 0 if c is None else self.categories[c].kind != "ignore")
            ]
        return booking_months(booking.booking_date, parts, self.categories, self.cutoff)


async def reading(session: AsyncSession, categories: dict[int, Category]) -> Reading:
    """The reading for every account there is."""
    accounts = await finance.list_accounts(session)
    return Reading(
        categories,
        await cutoff_day(session),
        frozenset(a.id for a in accounts if scope_of(Account(a.shared, a.kind)) is not None),
        {a.iban: a.id for a in accounts if a.iban},
    )


async def month_bookings(
    session: AsyncSession,
    filters: finance.Filters,
    months: list[dt.date],
    how: Reading,
) -> list[tuple[tables.Transaction, set[dt.date]]]:
    """The bookings that pass `filters` and count in one of the budget `months`, newest first.

    With a category in `filters`, a booking counts by that category's parts.
    """
    span = replace(filters, first=add_months(months[0], -1), last=last_day(months[-1]))
    found = await finance.list_transactions(
        session, span, after=None, limit=MOST, newest_first=True
    )
    kept = []
    for booking in found:
        counts_in = how.months(booking, category=filters.category)
        if counts_in & set(months):
            kept.append((booking, counts_in))
    return kept


async def booking_counts(
    session: AsyncSession, filters: finance.Filters, months: list[dt.date], how: Reading
) -> dict[dt.date, int]:
    """How many bookings count in each of `months`, as a payee's figures count them.

    A move between own accounts is none, nor a booking in an `ignore` category,
    money in not sorted yet, or a booking on an own saving account.
    """
    span = replace(filters, first=add_months(months[0], -1), last=last_day(months[-1]))
    found = await finance.list_transactions(session, span, after=None, limit=MOST)
    count = dict.fromkeys(months, 0)
    for booking in found:
        for month in how.months(booking, counted=True):
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


async def sides(session: AsyncSession, account: int) -> dict[dt.date, tuple[Decimal, Decimal]]:
    """Each month's money in and money out on the account, by booking date, both positive.

    Summed apart, so a refund on a day of spending does not net the two.
    """
    booking = tables.Transaction
    month = func.date_trunc("month", booking.booking_date)
    rows = await session.execute(
        select(
            month,
            func.coalesce(func.sum(case((booking.amount > 0, booking.amount))), 0),
            func.coalesce(func.sum(case((booking.amount < 0, -booking.amount))), 0),
        )
        .where(booking.account_id == account)
        .group_by(month)
    )
    return {at.date(): (money_in, money_out) for at, money_in, money_out in rows}


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


def names_payee(rule: tables.Rule, key: str, sides: set[str]) -> bool:
    """Whether a payee rule sorts some of a payee's bookings.

    Its pattern starts at a word of the key, and it sorts a side the payee's
    bookings are on: `in` for money in, `out` for money out; `both` sorts either.
    """
    if rule.kind != "payee" or f" {rule.pattern}" not in f" {key}":
        return False
    return rule.side == "both" or rule.side in sides


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
