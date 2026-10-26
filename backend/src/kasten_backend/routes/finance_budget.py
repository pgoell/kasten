"""The budget routes: a month's budget, free to spend, its flow, the trend, limits and settings.

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
from kasten_backend import finance_plan_reads as plan_reads
from kasten_backend.finance_flow import Role, month_flow
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


def parse_month(text: str) -> dt.date:
    """A `YYYY-MM` month as its first day; a month that is none is a 422."""
    try:
        return dt.date.fromisoformat(f"{text}-01")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`month` must be a real month") from error


def parse_when(month: str, today: str) -> tuple[dt.date, dt.date]:
    """The month asked for, as its first day, and the reader's today."""
    try:
        day = dt.date.fromisoformat(today)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`today` must be a real date") from error
    return parse_month(month), day


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
    """What the limits left: the month before, and every month since less what went into goals."""

    last_month: Cents
    total: Cents
    moved: Cents


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
    basis: Literal["so_far", "average", "plan"]


class FreePartOut(BaseModel):
    """A part of free to spend, and its lines."""

    total: Cents
    lines: list[FreeLineOut]


class ReserveOut(BaseModel):
    """A plan's reserve this month: its share, the bill paid, the shortfall, what it holds after."""

    plan_id: int
    name: str
    share: Cents
    paid: Cents
    shortfall: Cents
    balance: Cents


class ReservesOut(BaseModel):
    """What the reserves took off this month, and each one."""

    total: Cents
    lines: list[ReserveOut]


class GoalMonthOut(BaseModel):
    """A goal's contribution this month: planned, and what of it moved into its account."""

    goal_id: int
    name: str
    account_id: int
    account_name: str
    planned: Cents
    moved: Cents
    done: bool


class GoalsPartOut(BaseModel):
    """What the goals take off: their contributions planned and not yet moved, while it runs."""

    total: Cents
    lines: list[GoalMonthOut]


class FreeOut(BaseModel):
    """One scope's free to spend and what it is made of."""

    total: Cents
    income: FreePartOut
    fixed: FreePartOut
    flexible: FreePartOut
    non_monthly: FreePartOut
    unsorted: Cents
    saved: Cents
    reserves: ReservesOut
    goals: GoalsPartOut


class FreeToSpendOut(BaseModel):
    """Free to spend for mine and for household."""

    month: str
    mine: FreeOut
    household: FreeOut


class FlowNodeOut(BaseModel):
    """A place the month's money passes, and how much passes it."""

    key: str
    name: str
    role: Role
    column: int
    category_id: int | None
    amount: Cents


class FlowLinkOut(BaseModel):
    """Money from one node to the next."""

    source: str
    target: str
    amount: Cents


class FlowOut(BaseModel):
    """Where the span's money went, from what happened so far; `total` is the money in."""

    first: str
    month: str
    total: Cents
    nodes: list[FlowNodeOut]
    links: list[FlowLinkOut]


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
        reserves=ReservesOut(
            total=free.reserved,
            lines=[ReserveOut.model_validate(r, from_attributes=True) for r in free.reserves],
        ),
        goals=GoalsPartOut(
            total=free.to_move,
            lines=[
                GoalMonthOut(**vars(g), done=g.done)  # the dataclass's fields and its property
                for g in free.goals
            ],
        ),
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
    first, day = parse_when(month, today)
    ledger, limits = await reads.ledger(session), await reads.limits(session)
    left = budget.unreserved(
        ledger, limits, first, day, await plan_reads.moved_leftovers(session, first)
    )
    return BudgetOut(
        month=first.strftime("%Y-%m"),
        share_of_month=budget.share_of_month(first, day).quantize(Decimal("0.0001")),
        categories=[_category(row) for row in budget.budget_of(ledger, limits, first, day)],
        unreserved=UnreservedOut(last_month=left.last_month, total=left.total, moved=left.moved),
    )


@router.get("/budget/free")
async def read_free_to_spend(
    session: Session, month: MonthParam, today: TodayParam
) -> FreeToSpendOut:
    """Free to spend this month for mine and household, with the lines each is made of."""
    first, day = parse_when(month, today)
    ledger, book = await reads.ledger(session), await plan_reads.book(session)
    return FreeToSpendOut(
        month=first.strftime("%Y-%m"),
        mine=_free(free_to_spend(ledger, "mine", first, day, book)),
        household=_free(free_to_spend(ledger, "household", first, day, book)),
    )


@router.get("/budget/flow")
async def read_flow(
    session: Session,
    month: MonthParam,
    start: Annotated[str | None, Query(alias="from", pattern=MONTH_PATTERN)] = None,
) -> FlowOut:
    """Where the money of `from` to `month` went in both scopes, each column in drawing order.

    No `today`: the flow counts what happened, which needs no reader's day.
    With no `from`, the one month.
    """
    last = parse_month(month)
    first = last if start is None else parse_month(start)
    if first > last:
        raise HTTPException(status_code=422, detail="`from` is after `month`")
    flow = month_flow(await reads.ledger(session), first, await plan_reads.book(session), last)
    return FlowOut(
        first=first.strftime("%Y-%m"),
        month=last.strftime("%Y-%m"),
        total=flow.total,
        nodes=[FlowNodeOut.model_validate(node, from_attributes=True) for node in flow.nodes],
        links=[FlowLinkOut.model_validate(link, from_attributes=True) for link in flow.links],
    )


@router.get("/budget/trend")
async def read_trend(
    session: Session,
    month: MonthParam,
    months: Annotated[int, Query(ge=1, le=60)] = 12,
) -> TrendOut:
    """Each spending category's spending per month, over `months` months up to `month`."""
    first = parse_month(month)
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
    start = parse_month(limit.start)
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
