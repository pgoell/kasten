"""What the budget reads from the tables, and the two settings it writes.

Bookings come out summed by month, account, category and transfer twin, and
`finance_ledger` sorts them into the budget's parts. Nothing here commits.
"""

from typing import TYPE_CHECKING

from sqlalchemy import Date, and_, cast, exists, func, null, select, union_all, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased

from kasten_backend import finance_models as tables
from kasten_backend.finance_budget_models import CUTOFF_DAY, BudgetSettings, CategoryLimit
from kasten_backend.finance_ledger import Account, Category, Ledger, Line
from kasten_backend.finance_plan_models import Plan, PlanMatch

if TYPE_CHECKING:
    import datetime as dt
    from decimal import Decimal

    from sqlalchemy.ext.asyncio import AsyncSession


async def cutoff_day(session: AsyncSession) -> int:
    """The day after which a salary counts for the next month."""
    settings = await session.get(BudgetSettings, 1)
    return CUTOFF_DAY if settings is None else settings.salary_cutoff_day


async def _lines(session: AsyncSession, cutoff: int, transaction: int | None = None) -> list[Line]:
    """Every booking without splits and every split, summed by what decides where it counts.

    Money in and money out are summed apart. A transfer carries its twin's account.
    A booking that paid a reserving plan's bill is marked, since the reserve paid it.
    With `transaction`, only that booking's lines.
    """
    booking, twin, own = tables.Transaction, aliased(tables.Transaction), aliased(tables.Account)
    split = tables.TransactionSplit
    reserved = exists().where(
        PlanMatch.transaction_id == booking.id,
        PlanMatch.plan_id == Plan.id,
        # A bill paid before the plan was confirmed counts where it did then.
        PlanMatch.period >= Plan.confirmed,
        Plan.every_months > 1,
        Plan.amount < 0,
    )
    whole = (
        select(
            booking.booking_date.label("day"),
            booking.account_id.label("account"),
            booking.amount.label("amount"),
            booking.category_id.label("category"),
            func.coalesce(twin.account_id, own.id).label("twin"),
            reserved.label("reserved"),
            booking.payee_id.label("payee"),
        )
        # A join, not a subquery per booking: the partial index on transfer_group
        # finds each twin at once.
        .outerjoin(
            twin,
            and_(twin.transfer_group == booking.transfer_group, twin.id != booking.id),
        )
        # A half whose twin is not in yet still names an own account: a move, not spending that
        # the twin would count again.
        .outerjoin(
            own,
            and_(
                booking.transfer_group.is_(None),
                own.iban == booking.counterparty_iban,
                own.id != booking.account_id,
            ),
        )
        .where(~exists().where(split.transaction_id == booking.id))
    )
    # A split of a bill a reserve paid is marked as the whole booking would be.
    parts = select(
        booking.booking_date,
        booking.account_id,
        split.amount,
        split.category_id,
        null(),
        reserved,
        booking.payee_id,
    ).join(split, split.transaction_id == booking.id)
    if transaction is not None:
        whole, parts = (q.where(booking.id == transaction) for q in (whole, parts))
    rows = union_all(whole, parts).subquery()
    month = cast(func.date_trunc("month", rows.c.day), Date).label("month")
    late = (func.extract("day", rows.c.day) > cutoff).label("late")
    keys = [
        month,
        rows.c.account,
        rows.c.category,
        rows.c.twin,
        late,
        rows.c.reserved,
        rows.c.payee,
        rows.c.amount < 0,
    ]
    summed = select(*keys[:7], func.sum(rows.c.amount)).group_by(*keys)
    return [
        Line(month, account, amount, category, twin, late, reserved, payee)
        for month, account, category, twin, late, reserved, payee, amount in await session.execute(
            summed
        )
    ]


async def ledger(session: AsyncSession, transaction: int | None = None) -> Ledger:
    """Every booking in the budget's terms, or with `transaction` that one booking alone."""
    accounts = {
        row.id: Account(row.shared, row.kind)
        for row in await session.scalars(select(tables.Account))
    }
    categories = {
        row.id: Category(row.id, row.name, row.kind, row.salary)
        for row in await session.scalars(select(tables.Category))
    }
    lines = await _lines(session, await cutoff_day(session), transaction)
    return Ledger(lines, accounts, categories)


async def limits(session: AsyncSession) -> dict[int, list[tuple[dt.date, Decimal | None]]]:
    """Each category's limits, oldest first."""
    found: dict[int, list[tuple[dt.date, Decimal | None]]] = {}
    statement = select(CategoryLimit).order_by(CategoryLimit.category_id, CategoryLimit.month)
    for row in await session.scalars(statement):
        found.setdefault(row.category_id, []).append((row.month, row.amount))
    return found


async def set_limit(
    session: AsyncSession, category: int, month: dt.date, amount: Decimal | None
) -> None:
    """Set a category's limit from `month` on, in place of one set from that same month."""
    statement = insert(CategoryLimit).values(category_id=category, month=month, amount=amount)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[CategoryLimit.category_id, CategoryLimit.month],
            set_={"amount": statement.excluded.amount},
        )
    )


async def set_settings(session: AsyncSession, cutoff: int, salary: set[int]) -> None:
    """Write the cutoff day, and mark exactly the categories in `salary` as salary."""
    statement = insert(BudgetSettings).values(id=1, salary_cutoff_day=cutoff)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[BudgetSettings.id], set_={"salary_cutoff_day": cutoff}
        )
    )
    await session.execute(update(tables.Category).values(salary=tables.Category.id.in_(salary)))
