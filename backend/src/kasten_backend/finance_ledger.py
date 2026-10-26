"""The budget's ledger: every booking and split put in a budget month, a scope and a part.

The budget reads two scopes. Household is every shared account; mine is every
account of the owner's own that is not a saving account (giro, card, cash). A
saving account of the owner's own is in neither: what moves into it from mine
counts as saved, and its own bookings (interest) count nowhere.

Each booking counts once, in the part its category's kind or its transfer twin
gives it. A move from mine into the shared account is a fixed cost on mine and
income on household, the same amount, so nothing counts twice; a move between
two accounts of one scope is no money at all. See docs/reference/budget-model.md.

Pure: the loader in `finance_budget_reads` hands this the rows, so the rules
are tested without a database.
"""

import datetime as dt
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from collections.abc import Callable

Scope = Literal["mine", "household"]

SCOPES: tuple[Scope, ...] = ("mine", "household")

SPENDING_KINDS = ("fixed", "flexible", "non_monthly")
"""The kinds a limit is set on and spending is counted in."""

ZERO = Decimal(0)

CENT = Decimal("0.01")
"""Averages and shares are kept to the cent, so the parts of a figure add up to it exactly."""


@dataclass(frozen=True)
class Account:
    """What the budget needs of an account: whether it is shared, and its kind."""

    shared: bool
    kind: str


@dataclass(frozen=True)
class Category:
    """What the budget needs of a category."""

    id: int
    name: str
    kind: str
    salary: bool = False


@dataclass(frozen=True)
class Line:
    """Bookings or splits summed by the fields that decide where they count.

    `late` is a booking made after the salary cutoff day. `twin_account` is
    the account of a transfer's other half, None for every other booking.
    `reserved` is a booking that paid a plan's bill out of its reserve.
    `payee` is the booking's payee, a split's being its booking's; the budget
    never reads it, the drilldowns do.
    """

    month: dt.date
    account: int
    amount: Decimal
    category: int | None = None
    twin_account: int | None = None
    late: bool = False
    reserved: bool = False
    payee: int | None = None


@dataclass
class Month:
    """One scope's money in one budget month, each part as a positive figure.

    `income` is by income category, `spent` by spending category. `other_scope`
    is what moved to the other scope: a cost on mine, income on household.
    `from_reserve` is spending a plan's reserve paid, by category (None for
    a booking not sorted yet), kept out of `spent` so free to spend does not
    count the bill a second time. `saved_into` is `saved` by saving account.
    """

    income: dict[int, Decimal] = field(default_factory=lambda: defaultdict(Decimal))
    spent: dict[int, Decimal] = field(default_factory=lambda: defaultdict(Decimal))
    other_scope: Decimal = ZERO
    saved: Decimal = ZERO
    unsorted: Decimal = ZERO
    from_reserve: dict[int | None, Decimal] = field(default_factory=lambda: defaultdict(Decimal))
    saved_into: dict[int, Decimal] = field(default_factory=lambda: defaultdict(Decimal))


def scope_of(account: Account) -> Scope | None:
    """Household for a shared account, mine for an own spending account, None for own savings."""
    if account.shared:
        return "household"
    return None if account.kind == "saving" else "mine"


def add_months(month: dt.date, count: int) -> dt.date:
    """The first of the month `count` months after `month`, or before it when negative."""
    index = month.year * 12 + month.month - 1 + count
    return dt.date(index // 12, index % 12 + 1, 1)


def budget_month(line: Line, category: Category | None) -> dt.date:
    """The month a line counts in: a salary booked after the cutoff counts for the next."""
    if category is not None and category.salary and line.late and line.amount > 0:
        return add_months(line.month, 1)
    return line.month


class Ledger:
    """The lines sorted into budget months, scopes and parts, read by month and scope."""

    def __init__(
        self,
        lines: list[Line],
        accounts: dict[int, Account],
        categories: dict[int, Category],
    ) -> None:
        """Sort every line once. Lines on accounts or categories not named are left out."""
        self.lines, self.accounts, self.categories = lines, accounts, categories
        self._months: dict[tuple[dt.date, Scope], Month] = defaultdict(Month)
        self.first: dt.date | None = None
        # The first month each category, and each scope's move to the other, had money,
        # so an average starts there rather than counting the months before as zero.
        self.since: dict[int | Scope, dt.date] = {}
        for line in lines:
            self._add(line, accounts)

    def _add(self, line: Line, accounts: dict[int, Account]) -> None:
        account = accounts.get(line.account)
        if account is None:
            return
        self.first = line.month if self.first is None else min(self.first, line.month)
        scope = scope_of(account)
        if scope is None:
            return
        if line.twin_account is not None:
            twin = accounts.get(line.twin_account)
            self._add_transfer(line, scope, None if twin is None else scope_of(twin))
            return
        category = self.categories.get(line.category) if line.category is not None else None
        self._add_booking(line, scope, category)

    def _add_transfer(self, line: Line, scope: Scope, twin: Scope | None) -> None:
        """A move between own accounts, by where its other half is."""
        if twin == scope:
            return
        month = self._months[line.month, scope]
        if twin is not None:
            self._seen(scope, line.month)
        if twin is None:
            month.saved -= line.amount
            if line.twin_account is not None:
                month.saved_into[line.twin_account] -= line.amount
        elif scope == "mine":
            month.other_scope -= line.amount
        else:
            month.other_scope += line.amount

    def _add_booking(self, line: Line, scope: Scope, category: Category | None) -> None:
        """A booking that is no transfer, by its category's kind."""
        at = budget_month(line, category)
        month = self._months[at, scope]
        if category is not None:
            self._seen(category.id, at)
        if line.reserved and (category is None or category.kind in SPENDING_KINDS):
            month.from_reserve[None if category is None else category.id] -= line.amount
        elif category is None:
            # Money in with no category yet is left out until it is sorted: it
            # may be a refund as easily as income.
            if line.amount < 0:
                month.unsorted -= line.amount
        elif category.kind == "income":
            month.income[category.id] += line.amount
        elif category.kind in SPENDING_KINDS:
            month.spent[category.id] -= line.amount
        elif category.kind == "saving":
            month.saved -= line.amount

    def _seen(self, key: int | Scope, month: dt.date) -> None:
        self.since[key] = min(self.since.get(key, month), month)

    def only(self, keep: Callable[[Line], bool]) -> Ledger:
        """A ledger of the lines `keep` takes, sorted by the same rules.

        Each line counts on its own, so the parts of a part ledger add up to the
        whole: what a payee or an account gave each part of the month. The
        averages start from the part's own first month.
        """
        return Ledger([line for line in self.lines if keep(line)], self.accounts, self.categories)

    def entries(self) -> list[tuple[dt.date, Scope, Month]]:
        """Every month and scope something counts in, oldest first."""
        return sorted(
            ((at, scope, month) for (at, scope), month in self._months.items()),
            key=lambda e: (e[0], e[1]),
        )

    def month(self, month: dt.date, scope: Scope) -> Month:
        """One scope's month, empty when nothing counts in it."""
        return self._months.get((month, scope), Month())

    def spent(self, month: dt.date, category: int) -> Decimal:
        """What a category spent in a month, in both scopes, a bill its reserve paid included."""
        return sum(
            (
                self.month(month, scope).spent.get(category, ZERO)
                + self.month(month, scope).from_reserve.get(category, ZERO)
                for scope in SCOPES
            ),
            ZERO,
        )

    def history(self, month: dt.date, count: int, key: int | Scope | None = None) -> list[dt.date]:
        """The up to `count` whole months before `month` that the history reaches.

        With `key`, from the first month that category, or that scope's move to
        the other, had money: a category made last month averages over one month.
        """
        first = self.first if key is None else self.since.get(key)
        if first is None:
            return []
        start = max(add_months(month, -count), first)
        return [add_months(start, step) for step in range(months_between(start, month))]

    def average(
        self,
        month: dt.date,
        count: int,
        figure: Callable[[dt.date], Decimal],
        key: int | Scope | None = None,
    ) -> Decimal | None:
        """The mean of `figure(month)` over the whole months before `month`, None with none."""
        months = self.history(month, count, key)
        if not months:
            return None
        return (sum((figure(earlier) for earlier in months), ZERO) / len(months)).quantize(CENT)


def months_between(start: dt.date, end: dt.date) -> int:
    """How many months from the first of `start` to the first of `end`; never below zero."""
    return max(0, (end.year - start.year) * 12 + end.month - start.month)
