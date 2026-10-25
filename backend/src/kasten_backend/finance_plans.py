"""Plans and goals on their own: due dates, matching, reserves, goal contributions, the forecast.

Pure, like `finance_ledger`: `finance_plan_reads` hands this the rows. Free
to spend and the forecast both read due dates from here, so the two never
disagree on when a plan falls due. docs/reference/budget-model.md states the
rules.
"""

import datetime as dt
from calendar import monthrange
from dataclasses import dataclass, field
from decimal import ROUND_UP, Decimal

from kasten_backend.finance_ledger import CENT, ZERO, Scope, add_months, months_between

FORECAST_MONTHS = 12


@dataclass(frozen=True)
class Plan:
    """What the rules need of a plan. `every` is None for a plan that falls due once."""

    id: int
    name: str
    account: int
    scope: Scope | None
    category: int | None
    amount: Decimal
    tolerance: Decimal
    every: int | None
    start: dt.date
    end: dt.date | None = None
    payee: int | None = None
    text: str | None = None

    @property
    def reserves(self) -> bool:
        """A cost that comes less often than monthly sets its monthly share aside."""
        return self.every is not None and self.every > 1 and self.amount < 0

    @property
    def share(self) -> Decimal:
        """What it sets aside each month, positive: the bill over the months between two."""
        if not self.reserves or self.every is None:
            return ZERO
        return (-self.amount / self.every).quantize(CENT, rounding=ROUND_UP)


def nth_due(plan: Plan, step: int) -> dt.date:
    """The plan's `step`th date: its start's day, or the last day of a month too short for it."""
    month = add_months(plan.start.replace(day=1), step * (plan.every or 0))
    return month.replace(day=min(plan.start.day, monthrange(month.year, month.month)[1]))


def due_dates(plan: Plan, first: dt.date, last: dt.date) -> list[dt.date]:
    """Every date the plan falls due from `first` to `last`, both in, and none past its end."""
    last = last if plan.end is None else min(last, plan.end)
    if plan.every is None:
        return [plan.start] if first <= plan.start <= last else []
    found, step = [], 0
    if first > plan.start:
        # Skip straight to the months near `first` rather than walk from a start years ago.
        step = max(0, months_between(plan.start.replace(day=1), first) // plan.every - 1)
    while (due := nth_due(plan, step)) <= last:
        if due >= first:
            found.append(due)
        step += 1
    return found


def due_in(plan: Plan, month: dt.date) -> list[dt.date]:
    """The dates the plan falls due in one month."""
    return due_dates(plan, month, add_months(month, 1) - dt.timedelta(days=1))


@dataclass(frozen=True)
class Booking:
    """What matching reads of a booking. `text` is its purpose and counterparty, casefolded."""

    id: int
    account: int
    day: dt.date
    amount: Decimal
    payee: int | None
    text: str


def fits(plan: Plan, booking: Booking) -> bool:
    """Same account, the amount within the tolerance, and the payee or the text."""
    if booking.account != plan.account or abs(booking.amount - plan.amount) > plan.tolerance:
        return False
    if plan.payee is not None and booking.payee == plan.payee:
        return True
    return bool(plan.text) and plan.text.casefold() in booking.text


def match(
    plans: list[Plan], bookings: list[Booking], matched: set[tuple[int, dt.date]]
) -> list[tuple[int, dt.date, int]]:
    """New matches as (plan, period, booking), for every period with none yet.

    A period is the calendar month a date falls due in, and a booking matches
    it in that month only. Of several, the one nearest the date wins, then the
    one nearest the amount. `bookings` are those no plan holds yet; each goes
    to one plan at most, the plans taking turns by id.
    """
    if not bookings:
        return []
    by_month: dict[tuple[int, dt.date], list[Booking]] = {}
    for booking in bookings:
        by_month.setdefault((booking.account, booking.day.replace(day=1)), []).append(booking)
    # To the end of the latest booking's month: a booking before its date still meets it.
    last = add_months(max(b.day for b in bookings).replace(day=1), 1) - dt.timedelta(days=1)
    taken: set[int] = set()
    found = []
    for plan in sorted(plans, key=lambda p: p.id):
        for due in due_dates(plan, plan.start, last):
            period = due.replace(day=1)
            if (plan.id, period) in matched:
                continue
            fitting = [
                b
                for b in by_month.get((plan.account, period), [])
                if b.id not in taken and fits(plan, b)
            ]
            if fitting:
                best = min(
                    fitting, key=lambda b: (abs((b.day - due).days), abs(b.amount - plan.amount))
                )
                taken.add(best.id)
                found.append((plan.id, period, best.id))
    return found


def shares_until(plan: Plan, month: dt.date) -> int:
    """How many monthly shares the plan set aside up to and with `month`.

    Each date takes the `every` months up to and with its own month, so the
    reserve holds the whole bill by the time it comes: a yearly bill due in
    March sets aside from April the year before.
    """
    if not plan.reserves or plan.every is None:
        return 0
    first = add_months(plan.start.replace(day=1), 1 - plan.every)
    last = month
    if plan.end is not None:
        dates = due_dates(plan, plan.start, plan.end)
        last = min(month, dates[-1].replace(day=1)) if dates else first
    return max(0, months_between(first, last) + 1) if last >= first else 0


@dataclass(frozen=True)
class Reserve:
    """A plan's reserve in a month: the share set aside, what it paid, and what it holds after."""

    plan_id: int
    name: str
    share: Decimal
    paid: Decimal
    balance: Decimal


@dataclass(frozen=True)
class GoalPlan:
    """What free to spend needs of a goal: its account, its monthly contribution, its life."""

    id: int
    name: str
    account: int
    account_name: str
    monthly: Decimal
    due: dt.date
    reached: bool

    def contributes(self, month: dt.date) -> bool:
        """Whether its contribution counts in `month`: by its due month, and only until reached."""
        return not self.reached and month <= self.due.replace(day=1) and self.monthly > 0


@dataclass(frozen=True)
class GoalMonth:
    """One goal's contribution in a month: planned, and how much of it moved into the account."""

    goal_id: int
    name: str
    account_id: int
    account_name: str
    planned: Decimal
    moved: Decimal

    @property
    def done(self) -> bool:
        """Whether this month's contribution reached the account."""
        return self.moved >= self.planned


def goal_months(
    goals: list[GoalPlan], month: dt.date, moved: dict[int, Decimal]
) -> list[GoalMonth]:
    """Each contributing goal's month. What moved into an account fills its goals by due date."""
    found = []
    left = dict(moved)
    for goal in sorted(goals, key=lambda g: (g.due, g.id)):
        if not goal.contributes(month):
            continue
        taken = min(goal.monthly, max(ZERO, left.get(goal.account, ZERO)))
        left[goal.account] = left.get(goal.account, ZERO) - taken
        found.append(
            GoalMonth(goal.id, goal.name, goal.account, goal.account_name, goal.monthly, taken)
        )
    return found


@dataclass
class Book:
    """Plans, their matches, what each match paid, and the goals, for free to spend to read.

    `paid` is by plan and period, positive for a cost.
    """

    plans: list[Plan] = field(default_factory=list)
    matched: set[tuple[int, dt.date]] = field(default_factory=set)
    paid: dict[tuple[int, dt.date], Decimal] = field(default_factory=dict)
    goals: list[GoalPlan] = field(default_factory=list)

    def upcoming(self, plan: Plan, month: dt.date) -> list[dt.date]:
        """The dates the plan falls due in `month` that no booking met yet."""
        return [due for due in due_in(plan, month) if (plan.id, month) not in self.matched]

    def reserve(self, plan: Plan, month: dt.date) -> Reserve:
        """A reserving plan's month: its share, what it paid, and its balance at month end."""
        paid_before = sum(
            (amount for (pid, at), amount in self.paid.items() if pid == plan.id and at <= month),
            ZERO,
        )
        took = shares_until(plan, month) > shares_until(plan, add_months(month, -1))
        share = plan.share if took else ZERO
        return Reserve(
            plan.id,
            plan.name,
            share,
            self.paid.get((plan.id, month), ZERO),
            plan.share * shares_until(plan, month) - paid_before,
        )


def monthly_need(target: Decimal, reserved: Decimal, due: dt.date, today: dt.date) -> Decimal:
    """What must go in each month from this one on to reach the target by the due month."""
    months = max(1, months_between(today.replace(day=1), due.replace(day=1)))
    return max(ZERO, (target - reserved) / months).quantize(CENT, rounding=ROUND_UP)


@dataclass(frozen=True)
class ForecastMonth:
    """A scope's balance at a month's end, by its plans, and what they move in it."""

    month: dt.date
    planned_in: Decimal
    planned_out: Decimal
    balance: Decimal


def forecast(
    book: Book, scope: Scope, balance: Decimal, month: dt.date, count: int = FORECAST_MONTHS
) -> list[ForecastMonth]:
    """The balance month by month from `month`, from today's bank balance and the plans alone.

    This month counts only what no booking met yet, since the bank balance
    already holds what did. Flexible spending has no plan, so it is not in it.
    """
    found = []
    for step in range(count):
        at = add_months(month, step)
        moves = [
            plan.amount
            for plan in book.plans
            if plan.scope == scope
            for _ in book.upcoming(plan, at)
        ]
        planned_in = sum((m for m in moves if m > 0), ZERO)
        planned_out = -sum((m for m in moves if m < 0), ZERO)
        balance += planned_in - planned_out
        found.append(ForecastMonth(at, planned_in, planned_out, balance))
    return found
