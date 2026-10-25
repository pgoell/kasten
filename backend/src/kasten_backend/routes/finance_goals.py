"""The goal routes: saving goals, each a reserved share of one own saving account's balance.

Beside the other finance routes, under the same prefix and gate. The goals
in one account may together reserve no more than its latest bank balance;
docs/reference/budget-model.md says how a goal's monthly contribution comes
off free to spend.
"""

import datetime as dt  # noqa: TC003  pydantic reads the annotation at runtime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from kasten_backend import finance_budget_reads as budget_reads
from kasten_backend import finance_plan_reads as reads
from kasten_backend.finance_models import Account
from kasten_backend.finance_plan_models import Goal
from kasten_backend.finance_plans import goal_months, monthly_need
from kasten_backend.routes.finance import (  # noqa: TC001  FastAPI reads both at runtime
    Money,
    Session,
)
from kasten_backend.routes.finance_budget import Cents, TodayParam, parse_when

router = APIRouter(prefix="/api/finance")


class GoalIn(BaseModel):
    """A goal: a target by a date, the own saving account it lives in, what is reserved of it.

    `monthly` is the contribution the owner plans; null or 0 plans none.
    """

    name: Annotated[str, Field(min_length=1)]
    target: Annotated[Money, Field(gt=0)]
    due: dt.date
    account_id: int
    reserved: Annotated[Money, Field(ge=0)] = Decimal(0)
    monthly: Annotated[Money | None, Field(ge=0)] = None


class StoredGoalOut(GoalIn):
    """A goal as written."""

    id: int


class ContributionOut(BaseModel):
    """This month's contribution: what is planned, and what of it moved into the account."""

    planned: Cents
    moved: Cents
    done: bool


class GoalOut(GoalIn):
    """A goal as stored, with how far it is and what each month needs to reach it in time."""

    id: int
    progress: Decimal
    need: Cents
    this_month: ContributionOut | None


class SavingAccountOut(BaseModel):
    """An own saving account: its latest bank balance, what goals reserve, and the rest."""

    id: int
    name: str
    balance: Cents
    balance_date: dt.date | None
    reserved: Cents
    unreserved: Cents


class GoalsOut(BaseModel):
    """The goals, and the saving accounts they live in."""

    goals: list[GoalOut]
    accounts: list[SavingAccountOut]


async def _check(session: Session, body: GoalIn, goal_id: int | None) -> None:
    """Refuse an account that is no own saving account, or a reservation past its balance."""
    account = await session.get(Account, body.account_id)
    if account is None or account.kind != "saving" or account.shared:
        raise HTTPException(status_code=422, detail="A goal lives in an own saving account")
    others = await session.scalar(
        select(func.sum(Goal.reserved)).where(
            Goal.account_id == body.account_id, Goal.id != (goal_id or 0)
        )
    ) or Decimal(0)
    balance = (await reads.balances(session)).get(body.account_id, (None, Decimal(0)))[1]
    if others + body.reserved > balance:
        free = max(Decimal(0), balance - others)
        raise HTTPException(
            status_code=422,
            detail=f"{account.name} holds {balance}, of which {free} is unreserved",
        )


@router.get("/goals")
async def read_goals(session: Session, today: TodayParam) -> GoalsOut:
    """Every goal by due date, and each own saving account's balance, reserved and unreserved."""
    month, day = parse_when(today[:7], today)
    goals = list(await session.scalars(select(Goal).order_by(Goal.due, Goal.id)))
    moved = (await budget_reads.ledger(session)).month(month, "mine").saved_into
    contributions = {
        g.goal_id: g for g in goal_months(await reads.goal_plans(session), month, moved)
    }
    banks = await reads.balances(session)
    accounts = await session.scalars(
        select(Account).where(Account.kind == "saving", ~Account.shared).order_by(Account.name)
    )
    out = []
    for goal in goals:
        made = contributions.get(goal.id)
        out.append(
            GoalOut(
                id=goal.id,
                name=goal.name,
                target=goal.target,
                due=goal.due,
                account_id=goal.account_id,
                reserved=goal.reserved,
                monthly=goal.monthly,
                progress=min(Decimal(1), goal.reserved / goal.target).quantize(Decimal("0.0001")),
                need=monthly_need(goal.target, goal.reserved, goal.due, day),
                this_month=None
                if made is None
                else ContributionOut(planned=made.planned, moved=made.moved, done=made.done),
            )
        )
    saving = []
    for account in accounts:
        date, balance = banks.get(account.id, (None, Decimal(0)))
        reserved = sum((g.reserved for g in goals if g.account_id == account.id), Decimal(0))
        saving.append(
            SavingAccountOut(
                id=account.id,
                name=account.name,
                balance=balance,
                balance_date=date,
                reserved=reserved,
                unreserved=balance - reserved,
            )
        )
    return GoalsOut(goals=out, accounts=saving)


def _fill(goal: Goal, body: GoalIn) -> None:
    for name, value in body.model_dump().items():
        setattr(goal, name, value)


def _stored(goal: Goal) -> StoredGoalOut:
    return StoredGoalOut.model_validate(goal, from_attributes=True)


@router.post("/goals")
async def write_goal(body: GoalIn, session: Session) -> StoredGoalOut:
    """Make a goal; its reservation must fit the account's unreserved balance."""
    await _check(session, body, None)
    goal = Goal()
    _fill(goal, body)
    session.add(goal)
    await session.commit()
    return _stored(goal)


@router.put("/goals/{goal_id}")
async def rewrite_goal(goal_id: int, body: GoalIn, session: Session) -> StoredGoalOut:
    """Change a goal: assign more or less of the balance, or another monthly contribution."""
    goal = await session.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="No such goal")
    await _check(session, body, goal_id)
    _fill(goal, body)
    await session.commit()
    return _stored(goal)


@router.delete("/goals/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, session: Session) -> Response:
    """Delete a goal; what it reserved goes back to unreserved."""
    goal = await session.get(Goal, goal_id)
    if goal is None:
        raise HTTPException(status_code=404, detail="No such goal")
    await session.delete(goal)
    await session.commit()
    return Response(status_code=204)
