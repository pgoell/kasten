"""The plan routes: plans, the month's dates with their matches, the forecast and the proposals.

Beside the other finance routes, under the same prefix and gate. A write
matches the plans again before it commits, so a read only reads.
docs/reference/budget-model.md says how plans count in free to spend.
"""

import datetime as dt  # noqa: TC003  pydantic reads the annotation at runtime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from kasten_backend import finance_plan_reads as reads
from kasten_backend.finance_ledger import SCOPES
from kasten_backend.finance_plan_models import Plan
from kasten_backend.finance_plans import due_in, forecast
from kasten_backend.finance_proposals import proposals
from kasten_backend.routes.finance import (  # noqa: TC001  FastAPI reads both at runtime
    Money,
    Session,
)
from kasten_backend.routes.finance_budget import (
    Cents,
    MonthParam,
    TodayParam,
    parse_month,
    parse_when,
)

router = APIRouter(prefix="/api/finance")


class PlanIn(BaseModel):
    """A plan: a payee or a text to match, an amount give or take, a schedule, a category.

    `every_months` is 1 for monthly, 12 for yearly, any months between; null
    for a plan that falls due once, on `start`.
    """

    name: Annotated[str, Field(min_length=1)]
    account_id: int
    payee_id: int | None = None
    text: Annotated[str | None, Field(min_length=1)] = None
    amount: Money
    tolerance: Annotated[Money, Field(ge=0)] = Decimal(0)
    every_months: Annotated[int | None, Field(ge=1, le=120)] = 1
    category_id: int | None = None
    start: dt.date
    end: dt.date | None = None

    @model_validator(mode="after")
    def _matchable(self) -> PlanIn:
        if self.payee_id is None and self.text is None:
            raise ValueError("A plan needs a payee or a text to match")
        if self.end is not None and self.end < self.start:
            raise ValueError("`end` comes before `start`")
        return self


class PlanOut(PlanIn):
    """A plan as stored, and what it sets aside each month when it reserves."""

    id: int
    reserves: bool
    share: Cents


class MatchOut(BaseModel):
    """The booking that met a date."""

    transaction_id: int
    booking_date: dt.date
    amount: Cents


class DueOut(BaseModel):
    """A date a plan falls due in the month, and the booking that met it, if one did."""

    plan_id: int
    name: str
    due: dt.date
    amount: Cents
    category_id: int | None
    reserves: bool
    match: MatchOut | None


class ForecastMonthOut(BaseModel):
    """A month's end: what the plans bring in and take out, and the balance after."""

    month: str
    planned_in: Cents
    planned_out: Cents
    balance: Cents


class ScopeForecastOut(BaseModel):
    """A scope's bank balance today and its balance at each month's end by its plans."""

    balance: Cents
    months: list[ForecastMonthOut]


class ForecastOut(BaseModel):
    """The forecast for mine and for household."""

    mine: ScopeForecastOut
    household: ScopeForecastOut


class ProposalOut(BaseModel):
    """A plan read from history, ready to post as it is, and what it was read from."""

    key: str
    source: Literal["bill", "payee"]
    name: str
    account_id: int
    payee_id: int | None
    text: str | None
    amount: Cents
    tolerance: Cents
    every_months: int
    category_id: int | None
    start: dt.date
    seen: int
    last: dt.date


def _out(plan: Plan) -> PlanOut:
    rule = reads.rule_of(plan, None)
    return PlanOut(
        id=plan.id,
        name=plan.name,
        account_id=plan.account_id,
        payee_id=plan.payee_id,
        text=plan.text,
        amount=plan.amount,
        tolerance=plan.tolerance,
        every_months=plan.every_months,
        category_id=plan.category_id,
        start=plan.start_date,
        end=plan.end_date,
        reserves=rule.reserves,
        share=rule.share,
    )


def _fill(plan: Plan, body: PlanIn) -> None:
    fields = body.model_dump()
    fields["start_date"], fields["end_date"] = fields.pop("start"), fields.pop("end")
    for name, value in fields.items():
        setattr(plan, name, value)


async def _save(session: Session, plan: Plan) -> PlanOut:
    """Match afresh and commit; an account, payee or category that is not there is a 422."""
    try:
        await session.flush()
        await reads.forget_matches(session, plan.id)
        await reads.run_matching(session)
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        if "foreign key" not in str(error.orig).lower():
            raise
        raise HTTPException(status_code=422, detail="No such account, payee or category") from error
    return _out(plan)


@router.get("/plans")
async def read_plans(session: Session) -> list[PlanOut]:
    """Every plan, by name."""
    return [_out(plan) for plan in await session.scalars(select(Plan).order_by(Plan.name))]


@router.post("/plans")
async def write_plan(body: PlanIn, session: Session) -> PlanOut:
    """Make a plan, a proposal confirmed or one made by hand, and match it against the bookings."""
    plan = Plan()
    _fill(plan, body)
    session.add(plan)
    return await _save(session, plan)


@router.put("/plans/{plan_id}")
async def rewrite_plan(plan_id: int, body: PlanIn, session: Session) -> PlanOut:
    """Change a plan; its matches are dropped and matched afresh."""
    plan = await session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="No such plan")
    _fill(plan, body)
    return await _save(session, plan)


@router.delete("/plans/{plan_id}", status_code=204)
async def delete_plan(plan_id: int, session: Session) -> Response:
    """Delete a plan and its matches; the bookings stay."""
    plan = await session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="No such plan")
    await session.delete(plan)
    await session.commit()
    return Response(status_code=204)


@router.get("/plans/upcoming")
async def read_upcoming(session: Session, month: MonthParam) -> list[DueOut]:
    """Every date a plan falls due in the month, by date, each with its match or none."""
    first = parse_month(month)
    found = await reads.matches(session)
    dues = []
    for plan in await reads.rules(session):
        booking = found.get((plan.id, first))
        matched = (
            None
            if booking is None
            else MatchOut(
                transaction_id=booking.id, booking_date=booking.booking_date, amount=booking.amount
            )
        )
        dues.extend(
            DueOut(
                plan_id=plan.id,
                name=plan.name,
                due=due,
                amount=plan.amount,
                category_id=plan.category,
                reserves=plan.reserves,
                match=matched,
            )
            for due in due_in(plan, first)
        )
    return sorted(dues, key=lambda due: (due.due, due.name))


@router.get("/plans/forecast")
async def read_forecast(session: Session, today: TodayParam) -> ForecastOut:
    """Each scope's balance at the end of this month and the 11 after it, by its plans alone."""
    first, _ = parse_when(today[:7], today)
    book, banks = await reads.book(session), await reads.balances(session)
    scoped = await reads.scopes(session)
    out = {}
    for scope in SCOPES:
        balance = sum(
            (amount for account, (_, amount) in banks.items() if scoped.get(account) == scope),
            Decimal(0),
        )
        months = forecast(book, scope, balance, first)
        out[scope] = ScopeForecastOut(
            balance=balance,
            months=[
                ForecastMonthOut(
                    month=m.month.strftime("%Y-%m"),
                    planned_in=m.planned_in,
                    planned_out=m.planned_out,
                    balance=m.balance,
                )
                for m in months
            ],
        )
    return ForecastOut(**out)


@router.get("/plans/proposals")
async def read_proposals(session: Session, today: TodayParam) -> list[ProposalOut]:
    """Plans read from Firefly's bills and from recurring payees; nothing is written."""
    _, day = parse_when(today[:7], today)
    plans = await reads.rules(session)
    found = proposals(
        await reads.history(session),
        day,
        {(plan.payee, plan.account) for plan in plans},
        {plan.name.casefold() for plan in plans},
    )
    return [
        ProposalOut(
            key=p.key,
            source=p.source,
            name=p.name,
            account_id=p.account,
            payee_id=p.payee,
            text=p.text,
            amount=p.amount,
            tolerance=p.tolerance,
            every_months=p.every,
            category_id=p.category,
            start=p.start,
            seen=p.seen,
            last=p.last,
        )
        for p in found
    ]
