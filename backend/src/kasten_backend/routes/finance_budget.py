"""The budget routes: a month's budget, free to spend, the 12-month trend, limits and settings.

Beside the other finance routes, under the same prefix and gate. The reads
take the month and the reader's today, since pace and "so far" depend on the
day and the server's clock sits in UTC. docs/reference/budget-model.md says
how every figure is worked out.
"""

import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import select

from kasten_backend import finance_budget as budget
from kasten_backend import finance_budget_reads as reads
from kasten_backend.finance_free import Free, Part, free_to_spend
from kasten_backend.finance_ledger import SPENDING_KINDS
from kasten_backend.finance_models import Category
from kasten_backend.log import DATE_PATTERN
from kasten_backend.routes.finance import (  # noqa: TC001  FastAPI reads both at runtime
    Money,
    Session,
)

router = APIRouter(prefix="/api/finance")

MONTH_PATTERN = r"^[0-9]{4}-[0-9]{2}$"

CENT = Decimal("0.01")

Cents = Annotated[Decimal, AfterValidator(lambda amount: amount.quantize(CENT))]
"""An amount as answered: to the cent, so an average reads `412.33` and a sum of none `0.00`."""

# Both come from the reader, never the server's clock: the server keeps UTC, and on
# the evening of the last day of a month that is already the next one in Berlin.
MonthParam = Annotated[str, Query(pattern=MONTH_PATTERN)]
TodayParam = Annotated[str, Query(pattern=DATE_PATTERN)]


def _month(text: str) -> dt.date:
    try:
        return dt.date.fromisoformat(f"{text}-01")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`month` must be a real month") from error


def _when(month: str, today: str) -> tuple[dt.date, dt.date]:
    """The month asked for, as its first day, and the reader's today."""
    try:
        day = dt.date.fromisoformat(today)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`today` must be a real date") from error
    return _month(month), day


class SuggestionOut(BaseModel):
    """Raise or lower the limit to this amount."""

    direction: Literal["raise", "lower"]
    amount: Cents


class BudgetCategoryOut(BaseModel):
    """One spending category in the month."""

    id: int
    name: str
    kind: str
    limit: Cents | None
    carried: Cents
    available: Cents | None
    spent: Cents
    average: Cents | None
    expected_by_now: Cents | None
    status: Literal["ok", "near", "over"] | None
    suggestion: SuggestionOut | None


class UnreservedOut(BaseModel):
    """What the limits left: the month before, and every month since limits began."""

    last_month: Cents
    total: Cents


class BudgetOut(BaseModel):
    """A month's budget, every spending category by name."""

    month: str
    share_of_month: Decimal
    categories: list[BudgetCategoryOut]
    unreserved: UnreservedOut


class FreeLineOut(BaseModel):
    """One line of a part: what happened so far, the average, and what free to spend counts."""

    name: str
    category_id: int | None
    so_far: Cents
    average: Cents | None
    counted: Cents
    basis: Literal["so_far", "average"]


class FreePartOut(BaseModel):
    """A part of free to spend, and its lines."""

    total: Cents
    lines: list[FreeLineOut]


class FreeOut(BaseModel):
    """One scope's free to spend and what it is made of."""

    total: Cents
    income: FreePartOut
    fixed: FreePartOut
    flexible: FreePartOut
    non_monthly: FreePartOut
    unsorted: Cents
    saved: Cents


class FreeToSpendOut(BaseModel):
    """Free to spend for mine and for household."""

    month: str
    mine: FreeOut
    household: FreeOut


class TrendCategoryOut(BaseModel):
    """One spending category's spending in each month of the trend."""

    id: int
    name: str
    kind: str
    amounts: list[Cents]


class TrendOut(BaseModel):
    """Spending per month, oldest first."""

    months: list[str]
    categories: list[TrendCategoryOut]
    totals: list[Cents]
    limits: list[Cents | None]


class LimitIn(BaseModel):
    """A category's monthly limit from a month on; null takes the limit away from then."""

    amount: Annotated[Money | None, Field(ge=0)]
    start: Annotated[str, Field(alias="from", pattern=MONTH_PATTERN)]


class LimitOut(BaseModel):
    """A limit as stored."""

    model_config = {"populate_by_name": True}

    category_id: int
    start: Annotated[str, Field(serialization_alias="from")]
    amount: Cents | None


class SettingsIn(BaseModel):
    """The budget settings: the salary cutoff day and the income categories that are salary."""

    salary_cutoff_day: Annotated[int, Field(ge=1, le=31)]
    salary_category_ids: list[int]


SettingsOut = SettingsIn


def _part(parts: list[Part]) -> FreePartOut:
    return FreePartOut(
        total=Free.total_of(parts),
        lines=[FreeLineOut.model_validate(part, from_attributes=True) for part in parts],
    )


def _free(free: Free) -> FreeOut:
    return FreeOut(
        total=free.total,
        income=_part(free.income),
        fixed=_part(free.fixed),
        flexible=_part(free.flexible),
        non_monthly=_part(free.non_monthly),
        unsorted=free.unsorted,
        saved=free.saved,
    )


def _category(row: budget.CategoryBudget) -> BudgetCategoryOut:
    step, suggestion = row.step, row.suggestion
    return BudgetCategoryOut(
        id=row.category.id,
        name=row.category.name,
        kind=row.category.kind,
        limit=step.limit,
        carried=step.carried,
        available=step.available,
        spent=step.spent,
        average=row.average,
        expected_by_now=row.expected_by_now,
        status=row.status,
        suggestion=None
        if suggestion is None
        else SuggestionOut(direction=suggestion.direction, amount=suggestion.amount),
    )


@router.get("/budget")
async def read_budget(session: Session, month: MonthParam, today: TodayParam) -> BudgetOut:
    """Every spending category's month: limit, carried overspend, spent, average, status."""
    first, day = _when(month, today)
    ledger, limits = await reads.ledger(session), await reads.limits(session)
    left = budget.unreserved(ledger, limits, first, day)
    return BudgetOut(
        month=first.strftime("%Y-%m"),
        share_of_month=budget.share_of_month(first, day).quantize(Decimal("0.0001")),
        categories=[_category(row) for row in budget.budget_of(ledger, limits, first, day)],
        unreserved=UnreservedOut(last_month=left.last_month, total=left.total),
    )


@router.get("/budget/free")
async def read_free_to_spend(
    session: Session, month: MonthParam, today: TodayParam
) -> FreeToSpendOut:
    """Free to spend this month for mine and household, with the lines each is made of."""
    first, day = _when(month, today)
    ledger = await reads.ledger(session)
    return FreeToSpendOut(
        month=first.strftime("%Y-%m"),
        mine=_free(free_to_spend(ledger, "mine", first, day)),
        household=_free(free_to_spend(ledger, "household", first, day)),
    )


@router.get("/budget/trend")
async def read_trend(
    session: Session,
    month: MonthParam,
    months: Annotated[int, Query(ge=1, le=60)] = 12,
) -> TrendOut:
    """Each spending category's spending per month, over `months` months up to `month`."""
    first = _month(month)
    found = budget.trend(await reads.ledger(session), await reads.limits(session), first, months)
    return TrendOut(
        months=[at.strftime("%Y-%m") for at in found.months],
        categories=[
            TrendCategoryOut(id=c.id, name=c.name, kind=c.kind, amounts=amounts)
            for c, amounts in found.categories
        ],
        totals=found.totals,
        limits=found.limits,
    )


@router.put("/categories/{category_id}/limit")
async def write_limit(category_id: int, limit: LimitIn, session: Session) -> LimitOut:
    """Set a spending category's monthly limit from the month named on."""
    category = await session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="No such category")
    if category.kind not in SPENDING_KINDS:
        raise HTTPException(status_code=422, detail="Only a spending category takes a limit")
    start = _month(limit.start)
    await reads.set_limit(session, category_id, start, limit.amount)
    await session.commit()
    return LimitOut(category_id=category_id, start=start.strftime("%Y-%m"), amount=limit.amount)


@router.get("/budget/settings")
async def read_settings(session: Session) -> SettingsOut:
    """The salary cutoff day and the income categories that count as salary."""
    salary = await session.scalars(select(Category.id).where(Category.salary).order_by(Category.id))
    return SettingsOut(
        salary_cutoff_day=await reads.cutoff_day(session), salary_category_ids=list(salary)
    )


@router.put("/budget/settings")
async def write_settings(settings: SettingsIn, session: Session) -> SettingsOut:
    """Set the cutoff day and which income categories are salary; a non-income one is a 422."""
    wanted = set(settings.salary_category_ids)
    income = set(
        await session.scalars(
            select(Category.id).where(Category.id.in_(wanted), Category.kind == "income")
        )
    )
    if wanted - income:
        missing = ", ".join(str(i) for i in sorted(wanted - income))
        raise HTTPException(status_code=422, detail=f"Not an income category: {missing}")
    await reads.set_settings(session, settings.salary_cutoff_day, wanted)
    await session.commit()
    return SettingsOut(
        salary_cutoff_day=settings.salary_cutoff_day, salary_category_ids=sorted(wanted)
    )
