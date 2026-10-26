"""Where a month's money went: the streams from income through mine and household to each category.

Read off free to spend, as the month would stand once it is over: every line
counts what happened so far and nothing is estimated. So the flow follows every
rule free to spend does (the salary cutoff, moves between the scopes, splits,
refunds, ignore, plans' reserves), and each scope's money in, less its money
out, is its free to spend for a month that is over. docs/reference/budget-model.md states it.
"""

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

from kasten_backend.finance_free import Free, Part, free_to_spend, joined
from kasten_backend.finance_ledger import SCOPES, ZERO, Ledger, Scope, add_months

if TYPE_CHECKING:
    import datetime as dt

    from kasten_backend.finance_plans import Book

Role = Literal["source", "scope", "kind", "category", "left_over", "from_savings"]

KINDS = {
    "fixed": "Fixed",
    "flexible": "Flexible",
    "non_monthly": "Non-monthly",
    "reserved": "Reserved",
    "saved": "Saved",
    "into_household": "Into household",
    "unsorted": "Not sorted",
}
"""The kinds money goes out by, in the order the flow stacks them."""

FOLD_SHARE = Decimal("0.03")
"""A category or an income below this share of the month's money in folds into "Other …"."""

COLUMNS: dict[Role, int] = {
    "source": 0,
    "from_savings": 0,
    "scope": 1,
    "kind": 2,
    "left_over": 2,
    "category": 3,
}


@dataclass(frozen=True)
class Node:
    """A place money passes: an income, a scope, a kind or a category. `amount` is what passes."""

    key: str
    name: str
    role: Role
    category_id: int | None
    amount: Decimal

    @property
    def column(self) -> int:
        """The column the node is drawn in, from the left."""
        return COLUMNS[self.role]


@dataclass(frozen=True)
class Link:
    """Money from one node to the next, always a positive amount."""

    source: str
    target: str
    amount: Decimal


@dataclass
class Flow:
    """The month's nodes, each column in the order it is drawn, and the links between them."""

    nodes: list[Node]
    links: list[Link]
    total: Decimal


class _Builder:
    """The links of both scopes, keyed by node, before small streams are folded."""

    def __init__(self) -> None:
        self.links: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
        self.nodes: dict[str, tuple[str, Role, int | None]] = {}

    def node(self, key: str, name: str, role: Role, category: int | None = None) -> str:
        self.nodes.setdefault(key, (name, role, category))
        return key

    def link(self, source: str, target: str, amount: Decimal) -> None:
        self.links[source, target] += amount

    def money_in(self, scope: str, part: Part) -> None:
        """Money into a scope; a negative amount goes out instead, as paid back."""
        category, amount = part.category_id, part.so_far
        key = "from-mine" if category is None else f"income-{category}"
        if amount > 0:
            self.link(self.node(key, part.name, "source", category), scope, amount)
        elif amount < 0:
            back = self.node(f"back-{scope}-{key}", f"{part.name} paid back", "kind")
            self.link(scope, back, -amount)

    def money_out(self, scope: str, kind: str, part: Part | None, amount: Decimal) -> None:
        """Money out of a scope by a kind, and on to its category when it has one.

        A negative amount, a refund larger than the month's spending or savings
        drawn on, comes in as a source of its own.
        """
        category = None if part is None else part.category_id
        name = KINDS[kind] if part is None else part.name
        if amount < 0:
            backs = {"saved": "From saving", "into_household": "From the shared account"}
            back = backs.get(kind, f"{name} refunded")
            key = f"refund-{kind}-{category}"
            self.link(self.node(key, back, "source"), scope, -amount)
            return
        if amount == 0:
            return
        # Each scope has its own kinds, so mine's streams stay above household's.
        kind_key = self.node(f"kind-{scope}-{kind}", KINDS[kind], "kind")
        self.link(scope, kind_key, amount)
        if category is not None:
            target = self.node(f"category-{category}", name, "category", category)
            self.link(kind_key, target, amount)

    def scope(self, free: Free) -> None:
        """One scope's lines as links, and what is left over or was taken from before."""
        scope = self.node(free.scope, "Mine" if free.scope == "mine" else "Household", "scope")
        for part in free.income:
            self.money_in(scope, part)
        for kind, parts in (
            ("fixed", free.fixed),
            ("flexible", free.flexible),
            ("non_monthly", free.non_monthly),
        ):
            for part in parts:
                # The one fixed line with no category is the move into the shared account.
                self.money_out(
                    scope, "into_household" if part.category_id is None else kind, part, part.so_far
                )
        # A plan's share into its reserve, and a bill's cost past it, as free to spend counts them.
        self.money_out(scope, "reserved", None, free.reserved + free.shortfall)
        self.money_out(scope, "saved", None, free.saved)
        self.money_out(scope, "unsorted", None, free.unsorted)
        left = free.total
        if left > 0:
            self.link(scope, self.node(f"left-over-{scope}", "Left over", "left_over"), left)
        elif left < 0:
            source = self.node(f"from-savings-{scope}", "From earlier months", "from_savings")
            self.link(source, scope, -left)


def _fold(builder: _Builder, total: Decimal) -> dict[str, str]:
    """Where each small category or income goes: "Other <kind>" or "Other income".

    A stream folds only when at least two of its group would, so "Other" never
    stands for a single named line.
    """
    sizes: dict[str, Decimal] = defaultdict(lambda: ZERO)
    group_of: dict[str, str] = {}
    for (source, target), amount in builder.links.items():
        if source.startswith("income-"):
            sizes[source] += amount
            group_of[source] = "income"
        elif target.startswith("category-"):
            sizes[target] += amount
            group_of[target] = _kind(source)
    groups: dict[str, list[str]] = defaultdict(list)
    for key, size in sizes.items():
        if size < total * FOLD_SHARE:
            groups[group_of[key]].append(key)
    moved: dict[str, str] = {}
    for group, keys in groups.items():
        if len(keys) < 2:  # noqa: PLR2004  one line is no "other"
            continue
        role: Role = "source" if group == "income" else "category"
        name = "Other income" if group == "income" else f"Other {KINDS[group].lower()}"
        other = builder.node(f"other-{group}", name, role)
        moved |= dict.fromkeys(keys, other)
    return moved


def _kind(key: str) -> str:
    """The kind of a kind node's key, `kind-<scope>-<kind>`."""
    return key.split("-", 2)[2]


def _rank(node: Node) -> tuple[int, int, Decimal]:
    """Within a scope's stack: kinds in their order, then "Other", left over and from before."""
    last = node.key.startswith("other-") or node.role in ("left_over", "from_savings")
    kinds = list(KINDS)
    if node.key.startswith("kind-"):
        group = kinds.index(_kind(node.key))
    elif node.role in ("kind", "left_over"):
        group = len(kinds)  # money paid back, then left over, after the kinds
    else:
        group = 0
    return (group, int(last), -node.amount)


def _centres(links: list[Link], at: dict[str, float], *, from_source: bool) -> dict[str, float]:
    """Each node's barycentre: the mean place of the placed nodes it links to, by amount."""
    sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for link in links:
        near, far = (link.target, link.source) if from_source else (link.source, link.target)
        if far in at:
            sums[near][0] += at[far] * float(link.amount)
            sums[near][1] += float(link.amount)
    return {key: total / weight for key, (total, weight) in sums.items() if weight}


def _order(nodes: dict[str, Node], links: list[Link]) -> list[Node]:
    """Each column top down so streams mostly run straight: mine's above household's.

    Mine and household are placed first; the kinds, then the categories, by
    the place of what flows into them, and the sources by where they flow.
    """
    columns: dict[int, list[Node]] = defaultdict(list)
    for node in nodes.values():
        columns[node.column].append(node)
    at: dict[str, float] = {key: float(SCOPES.index(key)) for key in SCOPES if key in nodes}
    order = sorted(columns[1], key=lambda node: at[node.key])
    for column, from_source in ((2, True), (3, True), (0, False)):
        centre = _centres(links, at, from_source=from_source)
        placed = sorted(columns[column], key=lambda n: (centre.get(n.key, 0.0), _rank(n)))
        at |= {node.key: float(index) for index, node in enumerate(placed)}
        order += placed
    return sorted(order, key=lambda node: node.column)


def month_flow(
    ledger: Ledger, month: dt.date, plans: Book | None = None, last: dt.date | None = None
) -> Flow:
    """Where `month`'s money went in both scopes, from what happened so far.

    With `plans`, the reserves' shares go out as `Reserved`, as free to spend
    takes them, and a bill a reserve paid stays out of its category. With
    `last`, the months from `month` to `last` as one: each scope's lines
    summed over them, so what is left over is what the span kept in all.
    """
    months = [month]
    while months[-1] < (last or month):
        months.append(add_months(months[-1], 1))
    # Read as a month that is over, so each line counts what happened and nothing is estimated.
    frees: dict[Scope, Free] = {
        s: joined([free_to_spend(ledger, s, at, add_months(at, 1), plans) for at in months])
        for s in SCOPES
    }
    return _flow(frees)


def _flow(frees: dict[Scope, Free]) -> Flow:
    """The flow of each scope's free to spend, small streams folded."""
    builder = _Builder()
    for free in frees.values():
        builder.scope(free)
    total = sum((amount for (_, target), amount in builder.links.items() if target in SCOPES), ZERO)
    moved = _fold(builder, total)
    links: dict[tuple[str, str], Decimal] = defaultdict(lambda: ZERO)
    for (source, target), amount in builder.links.items():
        links[moved.get(source, source), moved.get(target, target)] += amount
    found = [Link(source, target, amount) for (source, target), amount in links.items()]
    passing: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for link in found:
        passing[link.target] += link.amount
    for link in found:
        if builder.nodes[link.source][1] in ("source", "from_savings"):
            passing[link.source] += link.amount
    nodes = {
        key: Node(key, name, role, category, passing[key])
        for key, (name, role, category) in builder.nodes.items()
        if key in passing
    }
    return Flow(_order(nodes, found), found, total)
