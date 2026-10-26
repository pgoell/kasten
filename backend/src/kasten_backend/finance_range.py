"""Spans of months, how they compare, and the figures the budget setup starts from.

A span is the months from one to another, each read as over, as the sankey
reads a month: a scope's or a category's span is its months added up, so a
span's figures are the drilldowns' months summed and nothing new is counted.
It compares with the same months a year before, and with the 6 whole months
before it, averaged and taken as many times as the span has months.
docs/reference/budget-model.md states it.

Pure, so the rules are tested without a database.
"""

from dataclasses import dataclass, fields, replace
from decimal import ROUND_CEILING, Decimal
from typing import TYPE_CHECKING

from kasten_backend.finance_budget import (
    AVERAGE_MONTHS,
    LimitRows,
    average_spent,
    limit_in,
    step_of,
)
from kasten_backend.finance_drill import (
    Counted,
    ScopeMonth,
    counted,
    of_category,
    scope_month,
)
from kasten_backend.finance_free import alive, free_to_spend
from kasten_backend.finance_ledger import (
    CENT,
    SCOPES,
    SPENDING_KINDS,
    ZERO,
    Ledger,
    Scope,
    add_months,
    months_between,
)

if TYPE_CHECKING:
    import datetime as dt
    from collections.abc import Mapping

    from kasten_backend.finance_plans import Book, Plan

YEAR = 12


def months_of(first: dt.date, last: dt.date) -> list[dt.date]:
    """The months from `first` to `last`, both included, oldest first."""
    return [add_months(first, step) for step in range(months_between(first, last) + 1)]


FIGURES = [f.name for f in fields(ScopeMonth) if f.name != "month"]
"""The figures of a scope's month, each a sum over its lines."""


def _added(rows: list[ScopeMonth], first: dt.date) -> ScopeMonth:
    """Scope months added figure by figure, dated `first`."""
    totals = {name: sum((getattr(row, name) for row in rows), ZERO) for name in FIGURES}
    return ScopeMonth(month=first, **totals)


def scope_span(
    ledger: Ledger, scope: Scope, months: list[dt.date], book: Book | None
) -> ScopeMonth:
    """A scope's months added up; `left` is what the span kept in all."""
    return _added([scope_month(ledger, scope, at, book) for at in months], months[0])


def _scaled(row: ScopeMonth, by: Decimal) -> ScopeMonth:
    """Each figure times `by`, to the cent."""
    return replace(row, **{name: (getattr(row, name) * by).quantize(CENT) for name in FIGURES})


@dataclass(frozen=True)
class Compared[T]:
    """A span's figures, the same months a year before, and the 6 months before at that length.

    `last_year` is None when the history does not reach back to it, and
    `average` when the history holds no whole month before the span.
    """

    now: T
    last_year: T | None
    average: T | None


def _before(ledger: Ledger, first: dt.date, key: int | Scope | None = None) -> list[dt.date]:
    """The whole months an average before `first` reads, from where `key`'s history starts."""
    return ledger.history(first, AVERAGE_MONTHS, key)


def scope_compared(
    ledger: Ledger, scope: Scope, first: dt.date, last: dt.date, book: Book | None
) -> Compared[ScopeMonth]:
    """A scope's span, a year before, and its 6-month average for as many months."""
    months = months_of(first, last)
    before = _before(ledger, first)
    average = None
    if before:
        # One rounding, at the end: the sum over the months before, times the span's share of them.
        by = Decimal(len(months)) / len(before)
        average = replace(_scaled(scope_span(ledger, scope, before, book), by), month=first)
    year_before = [add_months(m, -YEAR) for m in months]
    return Compared(
        scope_span(ledger, scope, months, book),
        scope_span(ledger, scope, year_before, book)
        if _reaches(ledger.first, year_before)
        else None,
        average,
    )


def _reaches(first: dt.date | None, months: list[dt.date]) -> bool:
    """Whether a history starting in `first` holds any of the months."""
    return first is not None and months[-1] >= first


def _counted_span(part: Ledger, category: int, months: list[dt.date]) -> Counted:
    """What a category counted over the months, added up."""
    rows = [counted(part, category, at) for at in months]
    return Counted(
        sum((r.mine for r in rows), ZERO),
        sum((r.household for r in rows), ZERO),
        sum((r.from_reserve for r in rows), ZERO),
    )


def category_compared(
    ledger: Ledger, category: int, first: dt.date, last: dt.date
) -> Compared[Counted]:
    """What a category counted in the span, a year before, and at its 6-month average.

    The average starts from the category's first month with money, as the
    budget's does.
    """
    part = of_category(ledger, category)
    months = months_of(first, last)
    before = _before(ledger, first, category)
    average = None
    if before:
        total = _counted_span(part, category, before)
        by = Decimal(len(months)) / len(before)
        average = Counted(
            (total.mine * by).quantize(CENT),
            (total.household * by).quantize(CENT),
            (total.from_reserve * by).quantize(CENT),
        )
    year_before = [add_months(m, -YEAR) for m in months]
    return Compared(
        _counted_span(part, category, months),
        _counted_span(part, category, year_before)
        if _reaches(ledger.since.get(category), year_before)
        else None,
        average,
    )


def available_in(
    ledger: Ledger, rows: LimitRows, category: int, months: list[dt.date]
) -> Decimal | None:
    """What the limits made available over the months, None where no month had a limit.

    Each month's limit added up, less only the overspend carried into the
    first: an overspend inside the span is spending the span already counts,
    so taking it off the next month's limit too would count it twice. A month
    with no limit adds nothing.
    """
    limits = [limit_in(rows, at) for at in months]
    if all(limit is None for limit in limits):
        return None
    total = sum((limit for limit in limits if limit is not None), ZERO)
    return max(ZERO, total - step_of(ledger, rows, category, months[0]).carried)


@dataclass(frozen=True)
class SetupRow:
    """One spending category on the budget setup: its limit now and what to start from.

    `planned` is what its monthly plans cost: a plan that reserves sets its
    bill aside through the reserve, and one due once is no monthly cost, so
    neither is in it. `suggested` is the larger of that and the average
    rounded up to the euro, as free to spend counts a planned cost.
    """

    id: int
    name: str
    kind: str
    limit: Decimal | None
    average: Decimal | None
    planned: Decimal | None
    plans: list[str]

    @property
    def suggested(self) -> Decimal | None:
        """The larger of the planned cost and the average up to the next euro."""
        found = [
            figure
            for figure in (
                self.planned,
                None
                if self.average is None
                else self.average.quantize(Decimal(1), rounding=ROUND_CEILING),
            )
            if figure is not None
        ]
        return max(found) if found else None


def monthly_cost(
    plans: list[Plan], category: int, month: dt.date
) -> tuple[Decimal | None, list[str]]:
    """What a category's monthly cost plans come to in `month`, and their names.

    Read as free to spend reads plans: from the month each was confirmed in.
    """
    found = [
        p
        for p in plans
        if p.category == category and p.amount < 0 and p.every == 1 and alive(p, month)
    ]
    if not found:
        return None, []
    return sum((-p.amount for p in found), ZERO), sorted(p.name for p in found)


def setup(
    ledger: Ledger, limits: Mapping[int, LimitRows], plans: list[Plan], month: dt.date
) -> list[SetupRow]:
    """Every spending category, by kind then name, with its limit, average and plans."""
    rows = []
    for category in sorted(
        (c for c in ledger.categories.values() if c.kind in SPENDING_KINDS),
        key=lambda c: (SPENDING_KINDS.index(c.kind), c.name),
    ):
        planned, names = monthly_cost(plans, category.id, month)
        rows.append(
            SetupRow(
                category.id,
                category.name,
                category.kind,
                limit_in(limits.get(category.id, []), month),
                average_spent(ledger, category.id, month),
                planned,
                names,
            )
        )
    return rows


def expected_income(ledger: Ledger, month: dt.date, today: dt.date, book: Book | None) -> Decimal:
    """The month's income as free to spend expects it, both scopes, each income category once.

    Household's money from mine is left out: it is mine's own income moved, and
    counting it would count that money twice.
    """
    total = ZERO
    for scope in SCOPES:
        free = free_to_spend(ledger, scope, month, today, book)
        total += sum((p.counted for p in free.income if p.category_id is not None), ZERO)
    return total
