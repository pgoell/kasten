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
    # The first of the month the plan was confirmed in. Free to spend reads the
    # plan from then on only, so confirming one from history leaves past months
    # as they were; matching still links the bookings before it.
    confirmed: dt.date = dt.date(1, 1, 1)

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


Index = dict[tuple[int, dt.date], list[Booking]]


NEAR_DAYS = 20
"""How far from its date a bill paid in the month before or after may lie and still meet it."""


def _nearest(  # noqa: PLR0913  each part of the search is its own argument
    plan: Plan,
    due: dt.date,
    months: list[dt.date],
    by_month: Index,
    taken: set[int],
    *,
    days: int | None = None,
) -> Booking | None:
    """Of the fitting bookings in `months` no plan took, the nearest the date, then the amount.

    With `days`, only those that many days from the date or fewer.
    """
    fitting = [
        b
        for month in months
        for b in by_month.get((plan.account, month), [])
        if b.id not in taken and fits(plan, b) and (days is None or abs((b.day - due).days) <= days)
    ]
    if not fitting:
        return None
    return min(fitting, key=lambda b: (abs((b.day - due).days), abs(b.amount - plan.amount)))


def match(
    plans: list[Plan], bookings: list[Booking], matched: set[tuple[int, dt.date]]
) -> list[tuple[int, dt.date, int]]:
    """New matches as (plan, period, booking), for every period with none yet.

    A period is the calendar month a date falls due in. First every open
    period takes a booking of its own month; then a period still open takes
    one of the month before or after within 20 days of the date, a bill paid
    early or late. Of several,
    the one nearest the date wins, then the one nearest the amount.
    `bookings` are those no plan holds yet; each goes to one plan at most,
    the plans taking turns by id.
    """
    if not bookings:
        return []
    by_month: Index = {}
    for booking in bookings:
        by_month.setdefault((booking.account, booking.day.replace(day=1)), []).append(booking)
    # To the end of the month after the latest booking's: a bill paid early meets a date
    # in the month after it.
    last = add_months(max(b.day for b in bookings).replace(day=1), 2) - dt.timedelta(days=1)
    dues = [
        (plan, due)
        for plan in sorted(plans, key=lambda p: p.id)
        for due in due_dates(plan, plan.start, last)
        if (plan.id, due.replace(day=1)) not in matched
    ]
    taken: set[int] = set()
    found = []
    for near in (False, True):
        still_open = []
        for plan, due in dues:
            period = due.replace(day=1)
            months = [add_months(period, -1), add_months(period, 1)] if near else [period]
            best = _nearest(plan, due, months, by_month, taken, days=NEAR_DAYS if near else None)
            if best is None:
                still_open.append((plan, due))
                continue
            taken.add(best.id)
            found.append((plan.id, period, best.id))
        dues = still_open
    return found


def next_due(plan: Plan, month: dt.date) -> dt.date | None:
    """The first date the plan falls due in `month` or after, none past its end."""
    found = due_dates(plan, month, add_months(month, (plan.every or 1) + 1))
    return found[0] if found else None


def saving_from(plan: Plan) -> dt.date:
    """The first month a reserving plan sets aside in.

    The `every` months up to its first date, or the month it was confirmed in
    when that is later.
    """
    every = plan.every or 1
    return max(add_months(plan.start.replace(day=1), 1 - every), plan.confirmed)


@dataclass(frozen=True)
class Reserve:
    """A plan's reserve in a month: what it set aside, paid, lacked, and holds after.

    `shortfall` is what the bill cost past what was set aside, which comes off
    free to spend that month.
    """

    plan_id: int
    name: str
    share: Decimal
    paid: Decimal
    shortfall: Decimal
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
    # The day of the booking that met each period, so the forecast knows whether
    # the bank balance it starts from already holds it.
    paid_on: dict[tuple[int, dt.date], dt.date] = field(default_factory=dict)

    def upcoming(self, plan: Plan, month: dt.date) -> list[dt.date]:
        """The dates the plan falls due in `month` that no booking met yet."""
        return [due for due in due_in(plan, month) if (plan.id, month) not in self.matched]

    def reserve(self, plan: Plan, month: dt.date) -> Reserve:
        """A reserving plan's month, walked from the first month it sets aside in.

        Each month sets aside what the next bill still lacks over the months
        left to it, this one included, so a plan made late catches up and the
        whole bill is there in its month. A bill that costs more than was set
        aside takes the rest off free to spend as `shortfall`; one that costs
        less leaves the rest for the next.
        """
        bill = -plan.amount
        balance = ZERO
        found = Reserve(plan.id, plan.name, ZERO, ZERO, ZERO, ZERO)
        at = saving_from(plan)
        while at <= month:
            due = next_due(plan, at)
            share = ZERO
            if due is not None:
                left = months_between(at, due.replace(day=1)) + 1
                share = max(ZERO, (bill - balance) / left).quantize(CENT, rounding=ROUND_UP)
            balance += share
            paid = self.paid.get((plan.id, at), ZERO)
            shortfall = max(ZERO, paid - balance)
            balance = max(ZERO, balance - paid)
            found = Reserve(plan.id, plan.name, share, paid, shortfall, balance)
            at = add_months(at, 1)
        return found


def monthly_need(target: Decimal, reserved: Decimal, due: dt.date, today: dt.date) -> Decimal:
    """What must go in each month from this one up to and with the due month to reach the target.

    The due month counts, as it does for the goal's contribution in free to spend.
    """
    months = months_between(today.replace(day=1), due.replace(day=1)) + 1
    if months < 1:
        return max(ZERO, target - reserved)
    return max(ZERO, (target - reserved) / months).quantize(CENT, rounding=ROUND_UP)


@dataclass(frozen=True)
class ForecastMonth:
    """A scope's balance at a month's end, by its plans, and what they move in it."""

    month: dt.date
    planned_in: Decimal
    planned_out: Decimal
    balance: Decimal


def forecast(  # noqa: PLR0913  each input of the forecast is its own argument
    book: Book,
    scope: Scope,
    balance: Decimal,
    month: dt.date,
    as_of: dict[int, dt.date],
    *,
    count: int = FORECAST_MONTHS,
) -> list[ForecastMonth]:
    """The balance month by month from `month`, from today's bank balance and the plans alone.

    A date counts unless a booking met it on or before the day of its
    account's bank balance (`as_of`), which already holds that booking.
    Flexible spending has no plan, so it is not in it.
    """

    def held(plan: Plan, at: dt.date) -> bool:
        paid = book.paid_on.get((plan.id, at))
        return paid is not None and paid <= as_of.get(plan.account, dt.date.min)

    found = []
    for step in range(count):
        at = add_months(month, step)
        moves = [
            plan.amount
            for plan in book.plans
            if plan.scope == scope and not held(plan, at)
            for _ in due_in(plan, at)
        ]
        planned_in = sum((m for m in moves if m > 0), ZERO)
        planned_out = -sum((m for m in moves if m < 0), ZERO)
        balance += planned_in - planned_out
        found.append(ForecastMonth(at, planned_in, planned_out, balance))
    return found
