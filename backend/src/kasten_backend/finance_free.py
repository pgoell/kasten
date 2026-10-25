"""Free to spend: what one scope may still spend this month, and the parts it is made of.

    free = income expected - fixed costs - flexible so far - non-monthly so far
           - unsorted so far - moved to saving - reserved for plans - goals still to move

A bill a plan's reserve paid counts in none of the spending parts: the
reserve took its share each month before. docs/reference/budget-model.md
states it in full. Each part is a list of
lines, so the overview can say what made the number. A month that is over
counts what happened and estimates nothing.
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from kasten_backend.finance_budget import AVERAGE_MONTHS
from kasten_backend.finance_ledger import CENT, ZERO, Ledger, Month, Scope
from kasten_backend.finance_plans import Book, GoalMonth, Plan, Reserve, goal_months

if TYPE_CHECKING:
    import datetime as dt
    from collections.abc import Callable
    from decimal import Decimal

Basis = Literal["so_far", "average", "plan"]
"""Where a line's counted figure came from: what happened this month, the average, or plans."""

OTHER_SCOPE = {"mine": "Into the shared account", "household": "From mine"}
"""The name of the line for what moves between mine and household, in each scope."""


@dataclass(frozen=True)
class Part:
    """One line of free to spend: a category, or the move between mine and household."""

    name: str
    category_id: int | None
    so_far: Decimal
    average: Decimal | None
    counted: Decimal
    basis: Basis


@dataclass
class Free:
    """One scope's free to spend and the lines under each part."""

    scope: Scope
    income: list[Part] = field(default_factory=list)
    fixed: list[Part] = field(default_factory=list)
    flexible: list[Part] = field(default_factory=list)
    non_monthly: list[Part] = field(default_factory=list)
    unsorted: Decimal = ZERO
    saved: Decimal = ZERO
    reserves: list[Reserve] = field(default_factory=list)
    goals: list[GoalMonth] = field(default_factory=list)
    over: bool = False

    @property
    def reserved(self) -> Decimal:
        """What the plans' reserves took off this month."""
        return sum((reserve.share for reserve in self.reserves), ZERO)

    @property
    def to_move(self) -> Decimal:
        """The goal contributions planned and not yet moved, while the month runs; then none."""
        if self.over:
            return ZERO
        return sum((goal.planned - goal.moved for goal in self.goals), ZERO)

    @staticmethod
    def total_of(parts: list[Part]) -> Decimal:
        """What a part counts, all its lines together."""
        return sum((part.counted for part in parts), ZERO)

    @property
    def total(self) -> Decimal:
        """Income less everything that went or will go this month."""
        spent = sum(
            (self.total_of(parts) for parts in (self.fixed, self.flexible, self.non_monthly)),
            ZERO,
        )
        income = self.total_of(self.income)
        return income - spent - self.unsorted - self.saved - self.reserved - self.to_move


class _Reader:
    """One scope's months off the ledger, with the averages each line needs."""

    def __init__(self, ledger: Ledger, scope: Scope, month: dt.date, *, over: bool) -> None:
        self.ledger, self.scope, self.month, self.over = ledger, scope, month, over
        self.now = ledger.month(month, scope)
        months = ledger.history(month, AVERAGE_MONTHS)
        self.before = [ledger.month(earlier, scope) for earlier in months]

    def average(self, figure: Callable[[Month], Decimal], key: int | Scope) -> Decimal | None:
        """The mean over the whole months before, from the first month `key` had money."""
        months = self.ledger.history(self.month, AVERAGE_MONTHS, key)
        if not months:
            return None
        total = sum((figure(self.ledger.month(at, self.scope)) for at in months), ZERO)
        return (total / len(months)).quantize(CENT)

    def name(self, category: int) -> str:
        return self.ledger.categories[category].name

    def ids(self, figures: Callable[[Month], dict[int, Decimal]], kind: str) -> list[int]:
        """The categories of a kind with a figure this month or in the months averaged."""
        seen = {
            c for month in [self.now, *self.before] for c, value in figures(month).items() if value
        }
        return sorted((c for c in seen if self.ledger.categories[c].kind == kind), key=self.name)

    def so_far(self, figures: Callable[[Month], dict[int, Decimal]], kind: str) -> list[Part]:
        """A line per category of the kind that moved money this month, counting what it did."""
        return [
            Part(self.name(c), c, figures(self.now)[c], None, figures(self.now)[c], "so_far")
            for c in self.ids(figures, kind)
            if figures(self.now).get(c)
        ]

    def expected(
        self,
        name: str,
        category: int | None,
        figure: Callable[[Month], Decimal],
        *,
        larger: bool,
        estimate: bool = True,
    ) -> Part:
        """A line counted as what happened, or as its average when that is the better guess.

        With `larger`, the larger of the two (a cost may still come); without,
        the average only while nothing happened yet (income not yet in). Without
        `estimate`, what happened and nothing more.
        """
        key = self.scope if category is None else category
        so_far, average = figure(self.now), self.average(figure, key)
        if self.over or average is None or not estimate:
            return Part(name, category, so_far, average, so_far, "so_far")
        use_average = average > so_far if larger else so_far == 0
        counted, basis = (average, "average") if use_average else (so_far, "so_far")
        return Part(name, category, so_far, average, counted, basis)


def _spent(month: Month) -> dict[int, Decimal]:
    return month.spent


def expected_income(reader: _Reader) -> list[Part]:
    """What came in, and for a salary or household's money from mine, its average until it does.

    Only those two come every month; a refund or a one-off payment in another
    income category counts once it is in. A salary booked after the cutoff
    day already counts in the next month, by the ledger.
    """
    categories = reader.ledger.categories
    parts = [
        reader.expected(
            reader.name(c),
            c,
            lambda m, c=c: m.income.get(c, ZERO),
            larger=False,
            estimate=categories[c].salary,
        )
        for c in reader.ids(lambda m: m.income, "income")
    ]
    if reader.scope == "household":
        parts.append(
            reader.expected(OTHER_SCOPE["household"], None, lambda m: m.other_scope, larger=False)
        )
    return [part for part in parts if part.counted or part.so_far]


def planned_fixed(reader: _Reader, book: Book) -> list[Part]:
    """Each fixed category with a plan in this scope: what it cost so far, plus its plans to come.

    A plan that reserves is left out: its bill comes out of the reserve. A
    month that is over counts what it cost.
    """
    upcoming: dict[int, Decimal] = {}
    for plan in book.plans:
        if plan.scope != reader.scope or plan.category is None or plan.reserves:
            continue
        if reader.ledger.categories[plan.category].kind != "fixed":
            continue
        if not _alive(plan, reader.month):
            continue
        dues = [] if reader.over else book.upcoming(plan, reader.month)
        upcoming[plan.category] = upcoming.get(plan.category, ZERO) - plan.amount * len(dues)
    parts = []
    for c in sorted(upcoming, key=reader.name):
        so_far = reader.now.spent.get(c, ZERO)
        parts.append(Part(reader.name(c), c, so_far, None, so_far + upcoming[c], "plan"))
    return parts


def _alive(plan: Plan, month: dt.date) -> bool:
    """Whether free to spend reads the plan in `month`: in its life, and once it was confirmed.

    A plan that falls due once lives in its month.
    """
    start = plan.start.replace(day=1)
    if month < plan.confirmed:
        return False
    if plan.every is None:
        return start == month
    return start <= month and (plan.end is None or plan.end >= month)


def estimate_fixed(reader: _Reader, planned: set[int] | None = None) -> list[Part]:
    """Each fixed cost with no plan, the larger of what it cost so far and its average.

    A category in `planned` has its line from `planned_fixed` instead.
    """
    parts = [
        reader.expected(reader.name(c), c, lambda m, c=c: m.spent.get(c, ZERO), larger=True)
        for c in reader.ids(lambda m: m.spent, "fixed")
        if c not in (planned or set())
    ]
    if reader.scope == "mine":
        parts.append(
            reader.expected(OTHER_SCOPE["mine"], None, lambda m: m.other_scope, larger=True)
        )
    return [part for part in parts if part.counted or part.so_far]


def free_to_spend(
    ledger: Ledger, scope: Scope, month: dt.date, today: dt.date, book: Book | None = None
) -> Free:
    """One scope's free to spend in `month`, as it stands on `today`.

    Goal contributions come off mine only: a goal lives in an own saving
    account, which money reaches from mine.
    """
    book = Book() if book is None else book
    over = today.replace(day=1) > month
    reader = _Reader(ledger, scope, month, over=over)
    planned = planned_fixed(reader, book)
    reserves = [
        book.reserve(plan, month) for plan in book.plans if plan.scope == scope and plan.reserves
    ]
    return Free(
        scope=scope,
        income=expected_income(reader),
        fixed=planned
        + estimate_fixed(reader, {p.category_id for p in planned if p.category_id is not None}),
        flexible=reader.so_far(_spent, "flexible"),
        # A non-monthly cost with a plan comes out of its reserve; one without counts when paid.
        non_monthly=reader.so_far(_spent, "non_monthly"),
        unsorted=reader.now.unsorted,
        saved=reader.now.saved,
        reserves=[r for r in reserves if r.share or r.paid],
        goals=goal_months(book.goals, month, reader.now.saved_into) if scope == "mine" else [],
        over=over,
    )
