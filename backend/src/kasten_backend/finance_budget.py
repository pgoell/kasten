"""The budget's figures for one month: each category against its limit, and free to spend.

Read off a `Ledger`, so the rules are tested without a database. The model,
with every threshold below, is in docs/reference/budget-model.md; a change
here changes that page.

A limit is kept per month it takes effect from, so changing it keeps the
months before as they were. What a category overspends comes off its limit
the month after, and what it leaves goes to the unreserved figure.
"""

import datetime as dt
from calendar import monthrange
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Literal

from kasten_backend.finance_ledger import (
    CENT,
    SPENDING_KINDS,
    ZERO,
    Category,
    Ledger,
    add_months,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

AVERAGE_MONTHS = 6
"""How many whole months the average beside a limit, and every estimate, reads."""

DRIFT_MONTHS = 3
"""How many months running a limit and its average must lie apart before a suggestion."""

DRIFT_SHARE = Decimal("0.10")
"""How far apart, as a share of the limit, a limit and its average must be to count as drift."""

DRIFT_FLOOR = Decimal(10)
"""The least gap in euros that counts as drift, so a €20 limit is not nagged over €3."""

NEAR_SHARE = Decimal("0.9")
"""A flexible category is near its limit once it has spent this share of it."""

PACE_SLACK = Decimal("0.10")
"""How far, as a share of the limit, a flexible category may run ahead of the month."""

Status = Literal["ok", "near", "over"]

LimitRows = Sequence[tuple[dt.date, Decimal | None]]
"""A category's limits, each with the month it takes effect from, oldest first. None: no limit."""


def limit_in(rows: LimitRows, month: dt.date) -> Decimal | None:
    """The limit in force in `month`: the newest row from that month or before."""
    found = None
    for start, amount in rows:
        if start > month:
            break
        found = amount
    return found


def share_of_month(month: dt.date, today: dt.date) -> Decimal:
    """How far through `month` today is: 0 before it starts, 1 once it is over."""
    first = today.replace(day=1)
    if first > month:
        return Decimal(1)
    if first < month:
        return ZERO
    return Decimal(today.day) / monthrange(today.year, today.month)[1]


@dataclass(frozen=True)
class Step:
    """One month of a category's limit: what was set, what was carried in, what was spent."""

    month: dt.date
    limit: Decimal | None
    carried: Decimal
    spent: Decimal

    @property
    def available(self) -> Decimal | None:
        """The limit less last month's overspend, never below nothing."""
        return None if self.limit is None else max(ZERO, self.limit - self.carried)

    @property
    def left(self) -> Decimal:
        """What the month left of what it had, which goes to unreserved; zero when over."""
        available = self.available
        return ZERO if available is None else max(ZERO, available - self.spent)

    @property
    def over(self) -> Decimal:
        """What the month spent past its own limit, which the next month's limit loses.

        Against the limit, not what was available, so an overspend is paid back
        once and never grows month on month.
        """
        return ZERO if self.limit is None else max(ZERO, self.spent - self.limit)


def step_of(ledger: Ledger, rows: LimitRows, category: int, month: dt.date) -> Step:
    """A category's month: its limit, what last month's overspend takes off it, what it spent."""
    limit = limit_in(rows, month)
    before = add_months(month, -1)
    last = Step(before, limit_in(rows, before), ZERO, ledger.spent(before, category))
    carried = ZERO if limit is None else last.over
    return Step(month, limit, carried, ledger.spent(month, category))


def walk(ledger: Ledger, rows: LimitRows, category: int, until: dt.date) -> Iterator[Step]:
    """Each month from the category's first limit up to and with `until`."""
    if not rows:
        return
    month = rows[0][0]
    while month <= until:
        yield step_of(ledger, rows, category, month)
        month = add_months(month, 1)


@dataclass(frozen=True)
class Suggestion:
    """Raise or lower a limit to the rounded average. A suggestion only; nothing changes alone."""

    direction: Literal["raise", "lower"]
    amount: Decimal


@dataclass(frozen=True)
class CategoryBudget:
    """One spending category in one month."""

    category: Category
    step: Step
    average: Decimal | None
    expected_by_now: Decimal | None
    status: Status | None
    suggestion: Suggestion | None


def average_spent(ledger: Ledger, category: int, month: dt.date) -> Decimal | None:
    """The category's mean spending over the whole months before `month`, since it first spent."""
    return ledger.average(
        month, AVERAGE_MONTHS, lambda earlier: ledger.spent(earlier, category), category
    )


def _drift(limit: Decimal, average: Decimal) -> Literal["raise", "lower"] | None:
    gap = average - limit
    if abs(gap) < max(DRIFT_FLOOR, limit * DRIFT_SHARE):
        return None
    return "raise" if gap > 0 else "lower"


def _rounded(amount: Decimal) -> Decimal:
    """To the nearest ten euros, so a suggestion reads as a limit a person would set."""
    return (amount / 10).quantize(Decimal(1), rounding=ROUND_HALF_UP) * 10


def suggest(ledger: Ledger, rows: LimitRows, category: int, month: dt.date) -> Suggestion | None:
    """A new limit, when the limit in force and the average lay apart the same way 3 months running.

    Each of the 3 whole months before `month` is read with the average as it
    stood at its end, against the limit in force now, so a limit just changed
    to fit stops the suggestion at once.
    """
    limit = limit_in(rows, month)
    # The category's own history must reach back 3 months, not the ledger's.
    since = ledger.since.get(category)
    if limit is None or since is None or since > add_months(month, -DRIFT_MONTHS):
        return None
    directions = {
        _drift(limit, average_spent(ledger, category, add_months(month, -back)) or ZERO)
        for back in range(DRIFT_MONTHS)
    }
    if len(directions) != 1:
        return None
    direction = directions.pop()
    amount = _rounded(average_spent(ledger, category, month) or ZERO)
    # An average that rounds to nothing is a category not used lately, not one
    # whose limit should go.
    if direction is None or amount in (limit, 0):
        return None
    return Suggestion(direction, amount)


def status_of(kind: str, step: Step, expected_by_now: Decimal | None) -> Status | None:
    """Over past the limit; near only for a flexible category, close to it or ahead of the month.

    A fixed or non-monthly cost is paid in one go, so rent at its limit on the
    first is fine, not near.
    """
    available = step.available
    if available is None:
        return None
    # Nothing spent is never over, even where an overspend took the whole limit.
    if step.spent > available and step.spent > 0:
        return "over"
    if kind != "flexible":
        return "ok"
    if step.spent > 0 and step.spent >= available * NEAR_SHARE:
        return "near"
    if expected_by_now is not None and step.spent > expected_by_now + available * PACE_SLACK:
        return "near"
    return "ok"


def category_budget(
    ledger: Ledger, category: Category, rows: LimitRows, month: dt.date, share: Decimal
) -> CategoryBudget:
    """One category's month: its limit, the carry, what it spent, its average and status."""
    step = step_of(ledger, rows, category.id, month)
    available = step.available
    expected = (
        None
        if available is None or category.kind != "flexible"
        else (max(ZERO, available) * share).quantize(CENT)
    )
    return CategoryBudget(
        category=category,
        step=step,
        average=average_spent(ledger, category.id, month),
        expected_by_now=expected,
        status=status_of(category.kind, step, expected),
        # A yearly cost averages badly over months, so a non-monthly limit gets no
        # suggestion; a plan reserves for it instead.
        suggestion=None
        if category.kind == "non_monthly"
        else suggest(ledger, rows, category.id, month),
    )


@dataclass(frozen=True)
class Unreserved:
    """What the limits left at month end: the month before, and every month since limits began.

    Apart from a saving account's unreserved, which is its balance less what
    its goals reserve (`routes/finance_goals.py`).
    """

    last_month: Decimal
    total: Decimal


def unreserved(
    ledger: Ledger, limits: Mapping[int, LimitRows], month: dt.date, today: dt.date
) -> Unreserved:
    """The leftovers of every whole month before `month` that is over by `today`.

    A month still running has left nothing yet, so a month ahead does not
    count this one.
    """
    last, total = ZERO, ZERO
    before = min(add_months(month, -1), add_months(today.replace(day=1), -1))
    for category in spending_categories(ledger):
        for step in walk(ledger, limits.get(category.id, []), category.id, before):
            total += step.left
            if step.month == before:
                last += step.left
    return Unreserved(last, total)


def spending_categories(ledger: Ledger) -> list[Category]:
    """Every fixed, flexible and non-monthly category, by name."""
    found = [c for c in ledger.categories.values() if c.kind in SPENDING_KINDS]
    return sorted(found, key=lambda category: category.name)


def budget_of(
    ledger: Ledger, limits: Mapping[int, LimitRows], month: dt.date, today: dt.date
) -> list[CategoryBudget]:
    """Every spending category's month."""
    share = share_of_month(month, today)
    return [
        category_budget(ledger, category, limits.get(category.id, []), month, share)
        for category in spending_categories(ledger)
    ]


@dataclass(frozen=True)
class Trend:
    """Each spending category's spending per month, the months' totals and their limits.

    `limits` is the sum of the limits in force each month, None in a month
    where no category has one.
    """

    months: list[dt.date]
    categories: list[tuple[Category, list[Decimal]]]
    totals: list[Decimal]
    limits: list[Decimal | None]


def trend(ledger: Ledger, limits: Mapping[int, LimitRows], month: dt.date, count: int) -> Trend:
    """The `count` months up to and with `month`, oldest first."""
    months = [add_months(month, back) for back in range(1 - count, 1)]
    categories = [
        (category, [ledger.spent(at, category.id) for at in months])
        for category in spending_categories(ledger)
    ]
    totals = [sum((amounts[i] for _, amounts in categories), ZERO) for i in range(count)]
    # What each month had to spend, as the budget's own figures say, so the trend
    # and the budget agree on the limits.
    in_force = [
        [
            found
            for category, _ in categories
            if (found := step_of(ledger, limits.get(category.id, []), category.id, at).available)
            is not None
        ]
        for at in months
    ]
    return Trend(
        months,
        categories,
        totals,
        [sum(found, ZERO) if found else None for found in in_force],
    )
