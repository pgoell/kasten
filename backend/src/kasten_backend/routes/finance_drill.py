"""The drilldown routes: one scope, account, category, payee or booking, month by month.

Each reads the budget's own ledger (`finance_drill`), so its figures for a
month are the ones the overview and the sankey give for it. The bookings each
lists are those that count in the month named, by the salary cutoff, except an
account's, which go by booking date like its bank balance.
docs/reference/http-api/finance-drill.md has the shapes.
"""

import datetime as dt  # noqa: TC003  pydantic reads the annotation at runtime
from decimal import Decimal
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from kasten_backend import finance
from kasten_backend import finance_budget_reads as reads
from kasten_backend import finance_drill as drill
from kasten_backend import finance_drill_reads as drill_reads
from kasten_backend import finance_models as tables
from kasten_backend import finance_plan_reads as plan_reads
from kasten_backend import finance_range as spans
from kasten_backend.finance_ledger import Account, Scope, scope_of
from kasten_backend.routes.finance import AccountOut, Session, TransactionOut
from kasten_backend.routes.finance_budget import (  # noqa: TC001  FastAPI reads both at runtime
    Cents,
    MonthParam,
)
from kasten_backend.routes.finance_range import (
    CategoryComparedOut,
    FromParam,
    ScopeComparedOut,
    ScopeMonthOut,
    counted_out,
    parse_span,
    scope_compared_out,
    scope_out,
)
from kasten_backend.routes.finance_sorting import CategoryOut, PayeeOut, RuleOut

if TYPE_CHECKING:
    from kasten_backend.finance_ledger import Ledger

router = APIRouter(prefix="/api/finance/drill")

MonthsParam = Annotated[int, Query(ge=1, le=60)]


def _month(at: dt.date) -> str:
    return at.strftime("%Y-%m")


class ScopeAccountOut(BaseModel):
    """An account of the scope: its latest bank balance and what its bookings moved in the month."""

    id: int
    name: str
    kind: str
    balance: Cents | None
    balance_on: dt.date | None
    moved: Cents


class ScopeDrillOut(BaseModel):
    """One scope over the months up to `month`, its span compared, accounts and bookings."""

    scope: Scope
    first: str
    month: str
    months: list[ScopeMonthOut]
    span: ScopeComparedOut
    accounts: list[ScopeAccountOut]
    bookings: list[TransactionOut]


class CategoryMonthOut(BaseModel):
    """What a category counted in a month, by scope, against its limit and average."""

    month: str
    mine: Cents
    household: Cents
    total: Cents
    from_reserve: Cents
    limit: Cents | None
    available: Cents | None
    average: Cents | None


class AmountOut(BaseModel):
    """What one payee, category or account gave."""

    id: int | None
    name: str
    amount: Cents


class PlanBriefOut(BaseModel):
    """A plan behind a category or a booking."""

    id: int
    name: str
    amount: Cents
    every_months: int | None


class CategoryDrillOut(BaseModel):
    """A category over the months, its payees in the month, the plans and rules behind it."""

    category: CategoryOut
    first: str
    month: str
    months: list[CategoryMonthOut]
    span: CategoryComparedOut
    payees: list[AmountOut]
    plans: list[PlanBriefOut]
    rules: list[RuleOut]
    bookings: list[TransactionOut]


class PayeeMonthOut(BaseModel):
    """A payee's month: spending, income, money moved to saving and how many bookings."""

    month: str
    spent: Cents
    received: Cents
    saved: Cents
    bookings: int


class PayeeCategoryOut(AmountOut):
    """A category a payee's money went to over the months, with its kind."""

    kind: str


class PayeeDrillOut(BaseModel):
    """A payee over the months, its average spending, its categories, rules and bookings."""

    payee: PayeeOut
    first: str
    month: str
    months: list[PayeeMonthOut]
    average: Cents | None
    average_received: Cents | None
    categories: list[PayeeCategoryOut]
    rules: list[RuleOut]
    bookings: list[TransactionOut]


class BalanceMonthOut(BaseModel):
    """An account's month by booking date: the balance at its end, money in and out."""

    month: str
    balance: Cents
    balance_from: dt.date | None
    money_in: Cents
    money_out: Cents


class AccountDrillOut(BaseModel):
    """An account's balance over the months, the month's money by category and its transfers."""

    account: AccountOut
    scope: Scope | None
    first: str
    month: str
    months: list[BalanceMonthOut]
    categories: list[AmountOut]
    transfers: list[AmountOut]
    bookings: list[TransactionOut]


class CountOut(BaseModel):
    """Where a booking counts: the budget month, scope, part and category, and the amount."""

    month: str
    scope: Scope
    part: str
    category_id: int | None
    amount: Cents


class MatchedPlanOut(BaseModel):
    """The plan a booking met, and the period it met."""

    id: int
    name: str
    period: str


class BookingDrillOut(BaseModel):
    """A booking with every field, its account and payee, its twin, plan and where it counts."""

    transaction: TransactionOut
    account: AccountOut
    payee: PayeeOut | None
    twin: TransactionOut | None
    plans: list[MatchedPlanOut]
    counts: list[CountOut]


def _out(bookings: list[tuple[tables.Transaction, set[dt.date]]]) -> list[TransactionOut]:
    return [TransactionOut.model_validate(booking) for booking, _ in bookings]


def _largest[K](amounts: dict[K, Decimal]) -> list[tuple[K, Decimal]]:
    """The amounts that are not zero, the largest first, by size whatever the sign."""
    return sorted(((k, a) for k, a in amounts.items() if a), key=lambda pair: -abs(pair[1]))


def _name(ledger: Ledger, category: int | None) -> str:
    return "Not sorted" if category is None else ledger.categories[category].name


@router.get("/scopes/{scope}")
async def read_scope(
    scope: Scope,
    session: Session,
    month: MonthParam,
    start: FromParam = None,
    months: MonthsParam = 12,
) -> ScopeDrillOut:
    """A scope's months as the sankey reads them, its span, accounts and the span's bookings."""
    first, last = parse_span(month, start)
    ledger, book = await reads.ledger(session), await plan_reads.book(session)
    found = [drill.scope_month(ledger, scope, at, book) for at in _window(first, last, months)]
    accounts = [a for a in await finance.list_accounts(session) if _scope(a) == scope]
    balances = await plan_reads.balances(session)
    flows = {a.id: drill.account_flow(ledger.lines, a.id, first, last).net for a in accounts}
    filters = finance.Filters(accounts=tuple(a.id for a in accounts))
    bookings = await drill_reads.month_bookings(
        session,
        filters,
        spans.months_of(first, last),
        await drill_reads.reading(session, ledger.categories),
    )
    return ScopeDrillOut(
        scope=scope,
        first=_month(first),
        month=_month(last),
        months=[scope_out(m) for m in found],
        span=scope_compared_out(spans.scope_compared(ledger, scope, first, last, book)),
        accounts=[
            ScopeAccountOut(
                id=a.id,
                name=a.name,
                kind=a.kind,
                balance=balances.get(a.id, (None, None))[1],
                balance_on=balances.get(a.id, (None, None))[0],
                moved=flows[a.id],
            )
            for a in accounts
        ],
        bookings=_out(bookings) if accounts else [],
    )


def _window(first: dt.date, last: dt.date, months: int) -> list[dt.date]:
    """The months a drilldown's chart reads: `months` up to `last`, the whole span at least."""
    return drill.months_to(last, max(months, len(spans.months_of(first, last))))


def _scope(account: tables.Account) -> Scope | None:
    return scope_of(Account(account.shared, account.kind))


async def _category(session: Session, category_id: int) -> tables.Category:
    category = await session.get(tables.Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="No such category")
    return category


@router.get("/categories/{category_id}")
async def read_category(
    category_id: int,
    session: Session,
    month: MonthParam,
    start: FromParam = None,
    months: MonthsParam = 12,
) -> CategoryDrillOut:
    """A category's months against its limit, its span, payees, plans, rules and bookings."""
    category = await _category(session, category_id)
    first, last = parse_span(month, start)
    ledger, limits = await reads.ledger(session), await reads.limits(session)
    rows = limits.get(category_id, [])
    found = drill.category_months(ledger, rows, category_id, _window(first, last, months))
    payees = {p.id: p.name for p in await session.scalars(select(tables.Payee))}
    in_span = spans.months_of(first, last)
    by_payee = drill.by_payee(ledger, category_id, in_span)
    bookings = await drill_reads.month_bookings(
        session,
        finance.Filters(category=category_id),
        in_span,
        await drill_reads.reading(session, ledger.categories),
    )
    compared = spans.category_compared(ledger, category_id, first, last)
    return CategoryDrillOut(
        category=CategoryOut.model_validate(category),
        first=_month(first),
        month=_month(last),
        span=CategoryComparedOut(
            now=counted_out(compared.now),
            last_year=counted_out(compared.last_year),
            average=None if compared.average is None else counted_out(compared.average),
            available=spans.available_in(ledger, rows, category_id, in_span),
        ),
        months=[
            CategoryMonthOut(
                month=_month(m.month),
                mine=m.counted.mine,
                household=m.counted.household,
                total=m.counted.total,
                from_reserve=m.counted.from_reserve,
                limit=m.limit,
                available=m.available,
                average=m.average,
            )
            for m in found
        ],
        payees=[
            AmountOut(id=p, name="No payee" if p is None else payees[p], amount=amount)
            for p, amount in _largest(by_payee)
        ],
        plans=[
            PlanBriefOut(id=p.id, name=p.name, amount=p.amount, every_months=p.every_months)
            for p in await drill_reads.plans_of(session, category_id)
        ],
        rules=[RuleOut.model_validate(r) for r in await drill_reads.rules_of(session, category_id)],
        bookings=_out(bookings),
    )


@router.get("/payees/{payee_id}")
async def read_payee(
    payee_id: int,
    session: Session,
    month: MonthParam,
    start: FromParam = None,
    months: MonthsParam = 12,
) -> PayeeDrillOut:
    """A payee's months, average, categories, the rules that name it and the span's bookings."""
    payee = await session.get(tables.Payee, payee_id)
    if payee is None:
        raise HTTPException(status_code=404, detail="No such payee")
    first, last = parse_span(month, start)
    ledger = await reads.ledger(session)
    how = await drill_reads.reading(session, ledger.categories)
    span = _window(first, last, months)
    view = drill.payee_view(ledger, payee_id, span)
    filters = finance.Filters(payee=payee_id)
    count = await drill_reads.booking_counts(session, filters, span, how)
    bookings = await drill_reads.month_bookings(session, filters, spans.months_of(first, last), how)
    sides = {"in" if line.amount > 0 else "out" for line in ledger.lines if line.payee == payee_id}
    return PayeeDrillOut(
        payee=PayeeOut.model_validate(payee),
        first=_month(first),
        month=_month(last),
        months=[
            PayeeMonthOut(
                month=_month(m.month),
                spent=m.spent,
                received=m.received,
                saved=m.saved,
                bookings=count[m.month],
            )
            for m in view.months
        ],
        average=view.average,
        average_received=view.average_received,
        categories=[
            PayeeCategoryOut(
                id=c, name=_name(ledger, c), kind=ledger.categories[c].kind, amount=amount
            )
            for c, amount in _largest(view.categories)
        ],
        rules=[
            RuleOut.model_validate(r)
            for r in await drill_reads.rules_of(session)
            if drill_reads.names_payee(r, payee.key, sides)
        ],
        bookings=_out(bookings),
    )


@router.get("/accounts/{account_id}")
async def read_account(
    account_id: int,
    session: Session,
    month: MonthParam,
    start: FromParam = None,
    months: MonthsParam = 12,
) -> AccountDrillOut:
    """An account's month-end balances, the span's money by category and transfers, by date."""
    account = await session.get(tables.Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="No such account")
    first, last = parse_span(month, start)
    ledger = await reads.ledger(session)
    snapshots = await drill_reads.snapshots(session, account_id)
    daily = await drill_reads.daily(session, account_id)
    sides = await drill_reads.sides(session, account_id)
    found = []
    for at in _window(first, last, months):
        balance, since = drill.balance_on(drill_reads.last_day(at), snapshots, daily)
        money_in, money_out = sides.get(at, (Decimal(0), Decimal(0)))
        found.append(
            BalanceMonthOut(
                month=_month(at),
                balance=balance,
                balance_from=since,
                money_in=money_in,
                money_out=money_out,
            )
        )
    flow = drill.account_flow(ledger.lines, account_id, first, last)
    names = {a.id: a.name for a in await finance.list_accounts(session)}
    bookings = await finance.list_transactions(
        session,
        finance.Filters(account_id, first, drill_reads.last_day(last)),
        after=None,
        limit=drill_reads.MOST,
        newest_first=True,
    )
    return AccountDrillOut(
        account=AccountOut.model_validate(account),
        scope=_scope(account),
        first=_month(first),
        month=_month(last),
        months=found,
        categories=[
            AmountOut(id=c, name=_name(ledger, c), amount=amount)
            for c, amount in _largest(flow.categories)
        ],
        transfers=[
            AmountOut(id=a, name=names.get(a, "?"), amount=amount)
            for a, amount in sorted(flow.transfers.items())
            if amount
        ],
        bookings=[TransactionOut.model_validate(b) for b in bookings],
    )


@router.get("/bookings/{transaction_id}")
async def read_booking(transaction_id: int, session: Session) -> BookingDrillOut:
    """A booking whole: every field and its raw record, its twin, plan and where it counts."""
    booking = await session.scalar(
        select(tables.Transaction)
        .options(selectinload(tables.Transaction.splits))
        .where(tables.Transaction.id == transaction_id)
    )
    if booking is None:
        raise HTTPException(status_code=404, detail="No such transaction")
    account = await session.get(tables.Account, booking.account_id)
    payee = None if booking.payee_id is None else await session.get(tables.Payee, booking.payee_id)
    twin = await drill_reads.twin_of(session, booking)
    ledger = await reads.ledger(session, transaction_id)
    return BookingDrillOut(
        transaction=TransactionOut.model_validate(booking),
        account=AccountOut.model_validate(account),
        payee=None if payee is None else PayeeOut.model_validate(payee),
        twin=None if twin is None else TransactionOut.model_validate(twin),
        plans=[
            MatchedPlanOut(id=plan, name=name, period=_month(period))
            for plan, name, period in await drill_reads.matched_plans(session, transaction_id)
        ],
        counts=[
            CountOut(
                month=_month(c.month),
                scope=c.scope,
                part=c.part,
                category_id=c.category,
                amount=c.amount,
            )
            for c in drill.counts(ledger)
        ],
    )
