"""The span routes: both scopes over a span of months, and the budget setup.

Each scope's span is set against the same months a year before and the
average; the setup sets every limit at once.

A span is `from` to `month`, both `YYYY-MM` and both included; with no `from`
it is the one month. The drilldown routes take the same two. docs/reference/
http-api/finance-range.md has the shapes and budget-model.md the rules.
"""

import datetime as dt  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from kasten_backend import finance_budget_reads as reads
from kasten_backend import finance_plan_reads as plan_reads
from kasten_backend import finance_range as span
from kasten_backend.finance_drill import Counted, ScopeMonth  # noqa: TC001  read at runtime
from kasten_backend.finance_ledger import SPENDING_KINDS
from kasten_backend.finance_models import Category
from kasten_backend.routes.finance import Money, Session  # noqa: TC001  FastAPI reads both
from kasten_backend.routes.finance_budget import (
    MONTH_PATTERN,
    Cents,
    LimitOut,
    MonthParam,
    TodayParam,
    parse_month,
    parse_when,
)

router = APIRouter(prefix="/api/finance")

FromParam = Annotated[str | None, Query(alias="from", pattern=MONTH_PATTERN)]
"""The span's first month; left out, the span is `month` alone."""


def parse_span(month: str, start: str | None) -> tuple[dt.date, dt.date]:
    """The span's first and last month; a `from` after `month` is a 422."""
    last = parse_month(month)
    first = last if start is None else parse_month(start)
    if first > last:
        raise HTTPException(status_code=422, detail="`from` is after `month`")
    return first, last


def label(at: dt.date) -> str:
    """A month as the routes write it, `YYYY-MM`."""
    return at.strftime("%Y-%m")


class ScopeMonthOut(BaseModel):
    """A scope's month or span, each part as the sankey draws it.

    `left` below zero is what was taken from before.
    """

    month: str
    income: Cents
    other_scope: Cents
    fixed: Cents
    flexible: Cents
    non_monthly: Cents
    reserved: Cents
    saved: Cents
    unsorted: Cents
    left: Cents


def scope_out(row: ScopeMonth) -> ScopeMonthOut:
    """A scope's month as answered."""
    return ScopeMonthOut(**{**vars(row), "month": label(row.month)})


class ScopeComparedOut(BaseModel):
    """A scope's span, the same months a year before, and the 6 months before at that length."""

    now: ScopeMonthOut
    last_year: ScopeMonthOut
    average: ScopeMonthOut | None


def scope_compared_out(found: span.Compared[ScopeMonth]) -> ScopeComparedOut:
    """A scope's comparison as answered."""
    return ScopeComparedOut(
        now=scope_out(found.now),
        last_year=scope_out(found.last_year),
        average=None if found.average is None else scope_out(found.average),
    )


class CountedOut(BaseModel):
    """What a category counted, by scope, and what of it a plan's reserve paid."""

    mine: Cents
    household: Cents
    total: Cents
    from_reserve: Cents


def counted_out(found: Counted) -> CountedOut:
    """A category's figure as answered."""
    return CountedOut(
        mine=found.mine,
        household=found.household,
        total=found.total,
        from_reserve=found.from_reserve,
    )


class CategoryComparedOut(BaseModel):
    """A category's span against a year before and its average; `available` is the limits'."""

    now: CountedOut
    last_year: CountedOut
    average: CountedOut | None
    available: Cents | None


class RangeOut(BaseModel):
    """Both scopes over a span of months."""

    first: str
    month: str
    months: int
    mine: ScopeComparedOut
    household: ScopeComparedOut


@router.get("/budget/range")
async def read_range(session: Session, month: MonthParam, start: FromParam = None) -> RangeOut:
    """Each scope over `from` to `month`, as the sankey reads it, against a year and the average."""
    first, last = parse_span(month, start)
    ledger, book = await reads.ledger(session), await plan_reads.book(session)
    return RangeOut(
        first=label(first),
        month=label(last),
        months=len(span.months_of(first, last)),
        mine=scope_compared_out(span.scope_compared(ledger, "mine", first, last, book)),
        household=scope_compared_out(span.scope_compared(ledger, "household", first, last, book)),
    )


class SetupCategoryOut(BaseModel):
    """A spending category on the setup: its limit now, its average, its plans, and a start."""

    id: int
    name: str
    kind: str
    limit: Cents | None
    average: Cents | None
    planned: Cents | None
    plans: list[str]
    suggested: Cents | None


class SetupOut(BaseModel):
    """Every spending category's limit on one screen, with the income it is set against."""

    month: str
    expected_income: Cents
    limits: Cents
    suggested: Cents
    categories: list[SetupCategoryOut]


@router.get("/budget/setup")
async def read_setup(session: Session, month: MonthParam, today: TodayParam) -> SetupOut:
    """Every spending category with its limit, average and plans, and the expected income."""
    first, day = parse_when(month, today)
    ledger, limits, book = (
        await reads.ledger(session),
        await reads.limits(session),
        await plan_reads.book(session),
    )
    rows = span.setup(ledger, limits, book.plans, first)
    return SetupOut(
        month=label(first),
        expected_income=span.expected_income(ledger, first, day, book),
        limits=sum((r.limit for r in rows if r.limit is not None), span.ZERO),
        suggested=sum((r.suggested for r in rows if r.suggested is not None), span.ZERO),
        categories=[
            SetupCategoryOut(
                id=r.id,
                name=r.name,
                kind=r.kind,
                limit=r.limit,
                average=r.average,
                planned=r.planned,
                plans=r.plans,
                suggested=r.suggested,
            )
            for r in rows
        ],
    )


class LimitRowIn(BaseModel):
    """One category's monthly limit; null takes it away."""

    category_id: int
    amount: Annotated[Money | None, Field(ge=0)]


class LimitsIn(BaseModel):
    """Every limit the setup sets, all from one month on."""

    start: Annotated[str, Field(alias="from", pattern=MONTH_PATTERN)]
    limits: list[LimitRowIn]


@router.put("/budget/limits")
async def write_limits(body: LimitsIn, session: Session) -> list[LimitOut]:
    """Set many categories' limits from one month on, all or none.

    A category that is not a spending one, or is named twice, is a 422 and
    nothing is written.
    """
    start = parse_month(body.start)
    wanted = [row.category_id for row in body.limits]
    if len(set(wanted)) != len(wanted):
        raise HTTPException(status_code=422, detail="A category is named twice")
    kinds = dict(
        (await session.execute(select(Category.id, Category.kind).where(Category.id.in_(wanted))))
        .tuples()
        .all()
    )
    refused = sorted(i for i in wanted if kinds.get(i) not in SPENDING_KINDS)
    if refused:
        names = ", ".join(str(i) for i in refused)
        raise HTTPException(status_code=422, detail=f"Not a spending category: {names}")
    for row in body.limits:
        await reads.set_limit(session, row.category_id, start, row.amount)
    await session.commit()
    return [
        LimitOut(category_id=row.category_id, start=label(start), amount=row.amount)
        for row in body.limits
    ]
