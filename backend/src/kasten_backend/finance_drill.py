"""The drilldowns' figures: a scope, a category, a payee, an account and a booking, by month.

Each figure is read off the budget's own ledger, or a part of it
(`Ledger.only`), so a booking counts in a drilldown exactly where it counts in
free to spend and the sankey: the salary cutoff, moves between own accounts,
splits, refunds and `ignore` all hold. A part ledger's figures add up to the
whole, since each line counts on its own. An account is the one exception: it
reads its bookings by booking date, as its bank balance does.
docs/reference/budget-model.md states the rules.

Pure, so the rules are tested without a database.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import TYPE_CHECKING

from kasten_backend.finance_budget import AVERAGE_MONTHS, LimitRows, step_of
from kasten_backend.finance_free import free_to_spend
from kasten_backend.finance_ledger import SCOPES, ZERO, Category, Ledger, Line, Scope, add_months

if TYPE_CHECKING:
    import datetime as dt
    from collections.abc import Iterable, Sequence

    from kasten_backend.finance_plans import Book


def months_to(month: dt.date, count: int) -> list[dt.date]:
    """The `count` months up to and with `month`, oldest first."""
    return [add_months(month, back) for back in range(1 - count, 1)]


@dataclass(frozen=True)
class ScopeMonth:
    """One scope's month as it stands once over, each part as the sankey draws it.

    `other_scope` is the move between mine and household: a cost on mine, income
    on household. So `left` is income, plus or less it, less every other part.
    """

    month: dt.date
    income: Decimal
    other_scope: Decimal
    fixed: Decimal
    flexible: Decimal
    non_monthly: Decimal
    reserved: Decimal
    saved: Decimal
    unsorted: Decimal
    left: Decimal


def scope_month(ledger: Ledger, scope: Scope, month: dt.date, book: Book | None) -> ScopeMonth:
    """A scope's month read as `month_flow` reads it: what happened, nothing estimated."""
    free = free_to_spend(ledger, scope, month, add_months(month, 1), book)

    def total(parts: Iterable, *, named: bool) -> Decimal:
        return sum((p.counted for p in parts if (p.category_id is not None) == named), ZERO)

    return ScopeMonth(
        month=month,
        income=total(free.income, named=True),
        other_scope=total([*free.income, *free.fixed], named=False),
        fixed=total(free.fixed, named=True),
        flexible=free.total_of(free.flexible),
        non_monthly=free.total_of(free.non_monthly),
        reserved=free.reserved + free.shortfall,
        saved=free.saved,
        unsorted=free.unsorted,
        left=free.total,
    )


@dataclass(frozen=True)
class Counted:
    """What one category counted in a month, by scope, and what of it a plan's reserve paid.

    Money in for an income category, money out for every other; `ignore` counts nothing.
    """

    mine: Decimal = ZERO
    household: Decimal = ZERO
    from_reserve: Decimal = ZERO

    @property
    def total(self) -> Decimal:
        """Both scopes together."""
        return self.mine + self.household


def counted(ledger: Ledger, category: int, month: dt.date) -> Counted:
    """What `category` counted in `month`, on a ledger that holds only its lines or more.

    `saved` holds a `saving` category's spending, and nothing else here when the
    ledger is one category's: a move between own accounts has no category.
    """
    kind = ledger.categories[category].kind
    by_scope: dict[Scope, Decimal] = {}
    reserve = ZERO
    for scope in SCOPES:
        at = ledger.month(month, scope)
        paid = at.from_reserve.get(category, ZERO)
        reserve += paid
        if kind == "income":
            by_scope[scope] = at.income.get(category, ZERO)
        elif kind == "saving":
            by_scope[scope] = at.saved
        else:
            by_scope[scope] = at.spent.get(category, ZERO) + paid
    return Counted(by_scope["mine"], by_scope["household"], reserve)


def of_category(ledger: Ledger, category: int) -> Ledger:
    """The part of a ledger one category holds."""
    return ledger.only(lambda line: line.category == category and line.twin_account is None)


@dataclass(frozen=True)
class CategoryMonth:
    """A category's month: what it counted, its limit and what was available, and its average."""

    month: dt.date
    counted: Counted
    limit: Decimal | None
    available: Decimal | None
    average: Decimal | None


def category_months(
    ledger: Ledger, rows: LimitRows, category: int, months: list[dt.date]
) -> list[CategoryMonth]:
    """Each month's figures, the limit as the budget tab gives it.

    The average is of what the bars show, so an income category's is its
    money in; a spending category's is the budget's `average`.
    """
    part = of_category(ledger, category)
    found = []
    for month in months:
        step = step_of(ledger, rows, category, month)
        found.append(
            CategoryMonth(
                month,
                counted(part, category, month),
                step.limit,
                step.available,
                part.average(
                    month,
                    AVERAGE_MONTHS,
                    lambda at: counted(part, category, at).total,
                    category,
                ),
            )
        )
    return found


def by_payee(ledger: Ledger, category: int, months: list[dt.date]) -> dict[int | None, Decimal]:
    """What each payee gave a category over `months`; None for bookings with no payee."""
    part = of_category(ledger, category)
    found: dict[int | None, Decimal] = {}
    for payee in {line.payee for line in part.lines}:
        sub = part.only(lambda line, payee=payee: line.payee == payee)
        amount = sum((counted(sub, category, month).total for month in months), ZERO)
        if amount:
            found[payee] = amount
    return found


@dataclass(frozen=True)
class PayeeMonth:
    """A payee's month: money out as spending, money in as income, and money moved to saving."""

    month: dt.date
    spent: Decimal
    received: Decimal
    saved: Decimal


def _payee_month(ledger: Ledger, month: dt.date) -> PayeeMonth:
    spent = received = saved = ZERO
    for scope in SCOPES:
        at = ledger.month(month, scope)
        spent += sum(at.spent.values(), ZERO) + sum(at.from_reserve.values(), ZERO) + at.unsorted
        received += sum(at.income.values(), ZERO)
        saved += at.saved
    return PayeeMonth(month, spent, received, saved)


@dataclass(frozen=True)
class PayeeView:
    """A payee's months, its average spending and money in, and what each category got of it.

    `average_received` is for a payee that pays in, such as an employer, whose
    spending averages nothing.
    """

    months: list[PayeeMonth]
    average: Decimal | None
    average_received: Decimal | None
    categories: dict[int, Decimal]


def payee_view(ledger: Ledger, payee: int, months: list[dt.date]) -> PayeeView:
    """A payee's figures over `months`, from its lines alone.

    A move between own accounts counts as the budget counts it, never as
    spending: nothing between accounts of one scope, saved into an own saving
    account. The move between mine and household is in none of these figures.
    """
    part = ledger.only(lambda line: line.payee == payee)
    categories: dict[int, Decimal] = {}
    for category in {line.category for line in part.lines if line.category is not None}:
        sub = of_category(part, category)
        amount = sum((counted(sub, category, month).total for month in months), ZERO)
        if amount:
            categories[category] = amount
    average, received = (
        part.average(months[-1], AVERAGE_MONTHS, lambda at, f=f: getattr(_payee_month(part, at), f))
        for f in ("spent", "received")
    )
    return PayeeView([_payee_month(part, month) for month in months], average, received, categories)


@dataclass
class AccountFlow:
    """An account's bookings in a span of months by booking date: net by category, and transfers.

    `categories` holds None for bookings not sorted yet; `transfers` is by the
    other own account. Together they add up to what the balance moved.
    """

    categories: dict[int | None, Decimal] = field(default_factory=lambda: defaultdict(Decimal))
    transfers: dict[int, Decimal] = field(default_factory=lambda: defaultdict(Decimal))

    @property
    def net(self) -> Decimal:
        """What the balance moved."""
        return sum(self.categories.values(), ZERO) + sum(self.transfers.values(), ZERO)


def account_flow(lines: list[Line], account: int, first: dt.date, last: dt.date) -> AccountFlow:
    """What moved on `account` in the months from `first` to `last`, by booking date."""
    flow = AccountFlow()
    for line in lines:
        if line.account != account or not first <= line.month <= last:
            continue
        if line.twin_account is not None:
            flow.transfers[line.twin_account] += line.amount
        else:
            flow.categories[line.category] += line.amount
    return flow


def balance_on(
    day: dt.date,
    snapshots: list[tuple[dt.date, Decimal]],
    daily: list[tuple[dt.date, Decimal]],
) -> tuple[Decimal, dt.date | None]:
    """An account's balance at the end of `day`, and the bank balance it was counted from.

    From the latest bank balance on or before the day, adding the bookings
    after it; else from the first one after it, taking away the bookings
    between. A bank balance holds the bookings of its own day. With none at
    all, the bookings summed from nothing, and no bank balance named.
    Both lists are oldest first.
    """
    before = [s for s in snapshots if s[0] <= day]
    if before:
        start, amount = before[-1]
        return amount + sum((a for d, a in daily if start < d <= day), ZERO), start
    if snapshots:
        start, amount = snapshots[0]
        return amount - sum((a for d, a in daily if day < d <= start), ZERO), start
    return sum((a for d, a in daily if d <= day), ZERO), None


def booking_months(
    day: dt.date,
    parts: Sequence[tuple[Decimal, int | None]],
    categories: dict[int, Category],
    cutoff: int,
) -> set[dt.date]:
    """The budget months a booking counts in: its own, or the next for a salary after the cutoff.

    `parts` is its splits, or the booking whole, each as amount and category.
    """
    first = day.replace(day=1)
    found = set()
    for amount, category in parts:
        known = categories.get(category) if category is not None else None
        late = known is not None and known.salary and amount > 0 and day.day > cutoff
        found.add(add_months(first, 1) if late else first)
    return found


@dataclass(frozen=True)
class Count:
    """Where a booking counts: a month, a scope, a part, a category, and the amount."""

    month: dt.date
    scope: Scope
    part: str
    """`income`, a spending kind, `reserve` (a bill a plan's reserve paid), `saved`,
    `unsorted` or `other_scope` (the move between mine and household)."""
    category: int | None
    amount: Decimal


def counts(ledger: Ledger) -> list[Count]:
    """Every place the booking a ledger holds counts in; none for a move inside one scope."""
    found = []
    for month, scope, at in ledger.entries():
        for category, amount in at.income.items():
            found.append(Count(month, scope, "income", category, amount))
        for category, amount in at.spent.items():
            kind = ledger.categories[category].kind
            found.append(Count(month, scope, kind, category, amount))
        for category, amount in at.from_reserve.items():
            found.append(Count(month, scope, "reserve", category, amount))
        for part, amount in (
            ("saved", at.saved),
            ("unsorted", at.unsorted),
            ("other_scope", at.other_scope),
        ):
            if amount:
                found.append(Count(month, scope, part, None, amount))
    return [count for count in found if count.amount]
