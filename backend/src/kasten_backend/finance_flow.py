"""Where a month's money went: the streams from income through mine and household to each category.

Read off free to spend, as the month would stand once it is over: every line
counts what happened so far and nothing is estimated. So the flow follows every
rule free to spend does (the salary cutoff, moves between the scopes, splits,
refunds, ignore), and each scope's money in, less its money out, is its free to
spend for a month that is over. docs/reference/budget-model.md states it.
"""

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

from kasten_backend.finance_free import Free, Part, free_to_spend
from kasten_backend.finance_ledger import SCOPES, ZERO, Ledger, Scope, add_months

if TYPE_CHECKING:
    import datetime as dt

Role = Literal["source", "scope", "kind", "category", "left_over", "from_savings"]

KINDS = {
    "fixed": "Fixed",
    "flexible": "Flexible",
    "non_monthly": "Non-monthly",
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
            self.link(scope, self.node(f"back-{key}", f"{part.name} paid back", "kind"), -amount)

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
        kind_key = self.node(f"kind-{kind}", KINDS[kind], "kind")
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
        self.money_out(scope, "saved", None, free.saved)
        self.money_out(scope, "unsorted", None, free.unsorted)
        left = free.total
        if left > 0:
            self.link(scope, self.node("left-over", "Left over", "left_over"), left)
        elif left < 0:
            source = self.node("from-savings", "From earlier months", "from_savings")
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
            group_of[target] = source.removeprefix("kind-")
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


def _order(nodes: dict[str, Node], links: list[Link]) -> list[Node]:
    """Each column largest first, kinds in their order; "Other", left over and from before last."""
    kinds = list(KINDS)

    def rank(node: Node) -> tuple[int, int, int, Decimal]:
        last = node.key.startswith("other-") or node.role in ("left_over", "from_savings")
        if node.role == "category":
            # A category sits beside its kind, so its streams do not cross the others.
            kind = next(link.source for link in links if link.target == node.key)
            group = kinds.index(kind.removeprefix("kind-"))
        elif node.key.startswith("kind-"):
            group = kinds.index(node.key.removeprefix("kind-"))
        elif node.role == "kind":
            group = len(kinds)  # money a scope paid back, after the kinds
        else:
            group = len(kinds) if last else 0
        return (node.column, group, int(last), -node.amount)

    return sorted(nodes.values(), key=rank)


def month_flow(ledger: Ledger, month: dt.date) -> Flow:
    """Where `month`'s money went in both scopes, from what happened so far."""
    builder = _Builder()
    # Read as a month that is over, so each line counts what happened and nothing is estimated.
    after = add_months(month, 1)
    frees: dict[Scope, Free] = {s: free_to_spend(ledger, s, month, after) for s in SCOPES}
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
