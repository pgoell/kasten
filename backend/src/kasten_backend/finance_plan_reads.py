"""What plans and goals read from the tables, and the matching they write.

The rules are in `finance_plans` and `finance_proposals`; this turns rows
into their terms and back. Nothing here commits.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import delete, exists, func, select, true
from sqlalchemy.dialects.postgresql import insert

from kasten_backend import finance_models as tables
from kasten_backend.finance_ledger import ZERO, Account, Scope, scope_of
from kasten_backend.finance_plan_models import Goal, GoalLeftover, Plan, PlanMatch
from kasten_backend.finance_plans import Book, Booking, GoalPlan, match
from kasten_backend.finance_plans import Plan as Rule
from kasten_backend.finance_proposals import Seen

if TYPE_CHECKING:
    import datetime as dt
    from decimal import Decimal

    from sqlalchemy.ext.asyncio import AsyncSession


def rule_of(plan: Plan, scope: Scope | None) -> Rule:
    """A stored plan in the rules' terms, with the scope its account gives it."""
    return Rule(
        id=plan.id,
        name=plan.name,
        account=plan.account_id,
        scope=scope,
        category=plan.category_id,
        amount=plan.amount,
        tolerance=plan.tolerance,
        every=plan.every_months,
        start=plan.start_date,
        end=plan.end_date,
        payee=plan.payee_id,
        text=plan.text,
        confirmed=plan.confirmed,
    )


async def rules(session: AsyncSession) -> list[Rule]:
    """Every plan, by id."""
    rows = await session.execute(
        select(Plan, tables.Account).join(tables.Account, tables.Account.id == Plan.account_id)
    )
    return sorted(
        (rule_of(plan, scope_of(Account(a.shared, a.kind))) for plan, a in rows),
        key=lambda r: r.id,
    )


async def scopes(session: AsyncSession) -> dict[int, Scope | None]:
    """Each account's scope."""
    rows = await session.scalars(select(tables.Account))
    return {a.id: scope_of(Account(a.shared, a.kind)) for a in rows}


async def run_matching(session: AsyncSession, ids: list[int] | None = None) -> int:
    """Match every period of every plan that has no booking yet; how many matched.

    Reads only bookings no plan holds and no transfer, since a move between
    own accounts pays no bill; with `ids`, only those bookings, the ones a
    batch just brought in.
    """
    if ids is not None and not ids:
        return 0
    plans = await rules(session)
    if not plans:
        return 0
    booking = tables.Transaction
    first = min(plan.start for plan in plans).replace(day=1)
    rows = await session.execute(
        select(
            booking.id,
            booking.account_id,
            booking.booking_date,
            booking.amount,
            booking.payee_id,
            booking.purpose,
            booking.counterparty_name,
        ).where(
            booking.transfer_group.is_(None),
            booking.booking_date >= first,
            booking.account_id.in_({plan.account for plan in plans}),
            ~exists().where(PlanMatch.transaction_id == booking.id),
            true() if ids is None else booking.id.in_(ids),
        )
    )
    bookings = [
        Booking(id_, account, day, amount, payee, f"{purpose or ''} {name or ''}".casefold())
        for id_, account, day, amount, payee, purpose, name in rows
    ]
    matched = {
        (p, at) for p, at in await session.execute(select(PlanMatch.plan_id, PlanMatch.period))
    }
    found = match(plans, bookings, matched)
    if found:
        await session.execute(
            insert(PlanMatch)
            .values([{"plan_id": p, "period": at, "transaction_id": t} for p, at, t in found])
            .on_conflict_do_nothing()
        )
    return len(found)


async def forget_matches(session: AsyncSession, plan_id: int) -> None:
    """Drop a plan's matches, so a changed plan is matched afresh."""
    await session.execute(delete(PlanMatch).where(PlanMatch.plan_id == plan_id))


@dataclass(frozen=True)
class Met:
    """The booking that met a period: its id, day and amount."""

    id: int
    day: dt.date
    amount: Decimal


async def matches(session: AsyncSession) -> dict[tuple[int, dt.date], Met]:
    """Every match's booking, by plan and period."""
    booking = tables.Transaction
    rows = await session.execute(
        select(
            PlanMatch.plan_id, PlanMatch.period, booking.id, booking.booking_date, booking.amount
        ).join(booking, booking.id == PlanMatch.transaction_id)
    )
    return {(plan, period): Met(id_, day, amount) for plan, period, id_, day, amount in rows}


async def goal_plans(session: AsyncSession) -> list[GoalPlan]:
    """Every goal, in the terms free to spend reads."""
    rows = await session.execute(
        select(Goal, tables.Account.name).join(tables.Account, tables.Account.id == Goal.account_id)
    )
    return [
        GoalPlan(
            goal.id,
            goal.name,
            goal.account_id,
            name,
            goal.monthly or ZERO,
            goal.due,
            goal.reserved >= goal.target,
        )
        for goal, name in rows
    ]


async def book(session: AsyncSession) -> Book:
    """The plans, their matches and what each paid, and the goals."""
    found = await matches(session)
    return Book(
        plans=await rules(session),
        matched=set(found),
        paid={key: -met.amount for key, met in found.items()},
        paid_on={key: met.day for key, met in found.items()},
        goals=await goal_plans(session),
    )


async def balances(session: AsyncSession) -> dict[int, tuple[dt.date, Decimal]]:
    """Each account's latest bank balance and its day."""
    snapshot = tables.BalanceSnapshot
    latest = (
        select(snapshot.account_id, func.max(snapshot.date).label("date"))
        .group_by(snapshot.account_id)
        .subquery()
    )
    rows = await session.execute(
        select(snapshot.account_id, snapshot.date, snapshot.amount).join(
            latest,
            (latest.c.account_id == snapshot.account_id) & (latest.c.date == snapshot.date),
        )
    )
    return {account: (day, amount) for account, day, amount in rows}


async def history(session: AsyncSession) -> list[Seen]:
    """Every booking that is no transfer, as proposals read it, with its Firefly bill if any."""
    booking, payee = tables.Transaction, tables.Payee
    rows = await session.execute(
        select(
            booking.booking_date,
            booking.amount,
            booking.account_id,
            booking.payee_id,
            payee.name,
            booking.counterparty_name,
            booking.category_id,
            booking.raw["firefly"]["bill"].astext,
        )
        .outerjoin(payee, payee.id == booking.payee_id)
        .where(booking.transfer_group.is_(None))
    )
    return [Seen(*row) for row in rows]


async def moved_leftovers(session: AsyncSession, month: dt.date | None = None) -> Decimal:
    """What the owner moved of the limits' leftovers into goals, in `month` and before.

    With no month, every move there is, which is what a new move is checked
    against: a move dated earlier must not spend money a later one already took.
    """
    statement = select(func.sum(GoalLeftover.amount))
    if month is not None:
        statement = statement.where(GoalLeftover.month <= month)
    return await session.scalar(statement) or ZERO
