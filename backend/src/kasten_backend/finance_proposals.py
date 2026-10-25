"""Plans proposed from history, for the owner to confirm: Firefly's bills and recurring payees.

Pure, and it writes nothing: a proposal becomes a plan only when the owner
posts it to `POST /api/finance/plans`. docs/reference/http-api/finance-plans.md
says how the two sources are read.
"""

import datetime as dt
from collections import Counter
from dataclasses import dataclass
from decimal import ROUND_UP, Decimal
from itertools import pairwise
from statistics import median
from typing import Literal

from kasten_backend.finance_ledger import ZERO

EVERY = (1, 2, 3, 4, 6, 12)
"""The schedules a gap between bookings is rounded to, in months."""

DAYS_A_MONTH = Decimal("30.44")

SAME_AMOUNT = Decimal("0.10")
"""A booking within this share of the usual amount counts as the same bill."""

LEAST_SEEN = 3
"""How many bookings of a payee at a steady gap make it recurring."""

LOOKBACK = dt.timedelta(days=400)
"""How far back a payee's bookings are read; an older habit is likely over."""


@dataclass(frozen=True)
class Seen:
    """One booking as the proposals read it. `bill` is Firefly's bill name from its raw record."""

    day: dt.date
    amount: Decimal
    account: int
    payee: int | None
    payee_name: str | None
    counterparty: str | None
    category: int | None
    bill: str | None


@dataclass(frozen=True)
class Proposal:
    """A plan as `POST /api/finance/plans` would take it, and what it was read from."""

    key: str
    source: Literal["bill", "payee"]
    name: str
    account: int
    payee: int | None
    text: str | None
    amount: Decimal
    tolerance: Decimal
    every: int
    category: int | None
    start: dt.date
    seen: int
    last: dt.date


def every_of(days: list[dt.date]) -> int | None:
    """The months between bookings, from their median gap; yearly for one; None for more often."""
    if len(days) < 2:  # noqa: PLR2004  one gap needs two days
        return 12
    ordered = sorted(days)
    gap = Decimal(median((b - a).days for a, b in pairwise(ordered)))
    if gap < 20:  # noqa: PLR2004  under three weeks is no monthly bill
        return None
    months = gap / DAYS_A_MONTH
    return min(EVERY, key=lambda every: abs(every - months))


def _most[T](values: list[T]) -> T:
    return Counter(values).most_common(1)[0][0]


def _proposal(
    key: str, source: Literal["bill", "payee"], name: str, rows: list[Seen], every: int
) -> Proposal:
    usual = Decimal(median(row.amount for row in rows))
    spread = max(abs(row.amount - usual) for row in rows)
    payee = _most([row.payee for row in rows])
    days = [row.day for row in rows]
    return Proposal(
        key=key,
        source=source,
        name=name,
        account=_most([row.account for row in rows]),
        payee=payee,
        text=None if payee is not None else _most([row.counterparty for row in rows]),
        amount=usual.quantize(Decimal("0.01")),
        # To the euro above, so a bill that rose by cents still matches.
        tolerance=spread.quantize(Decimal(1), rounding=ROUND_UP),
        every=every,
        category=_most([row.category for row in rows]),
        start=min(days),
        seen=len(rows),
        last=max(days),
    )


def _over(rows: list[Seen], every: int, today: dt.date) -> bool:
    """Whether a habit is over: its last booking more than its gap plus half a month ago."""
    return (today - max(row.day for row in rows)).days > every * 31 + 15


def from_bills(history: list[Seen], today: dt.date) -> list[Proposal]:
    """A proposal per Firefly bill still paid: Firefly matched these bookings to it.

    The schedule comes from all of the bill's history; the amount from its
    last 400 days, so a bill that rose is proposed at what it costs now.
    """
    bills: dict[str, list[Seen]] = {}
    for row in history:
        if row.bill:
            bills.setdefault(row.bill, []).append(row)
    found = []
    for name, rows in sorted(bills.items()):
        recent = [row for row in rows if row.day >= today - LOOKBACK]
        every = every_of([row.day for row in rows]) or 1
        if recent and not _over(rows, every, today):
            found.append(_proposal(f"bill:{name}", "bill", name, recent, every))
    return found


def _steady(rows: list[Seen]) -> list[Seen]:
    """The bookings near the usual amount, which a recurring bill is."""
    usual = Decimal(median(row.amount for row in rows))
    near = max(abs(usual) * SAME_AMOUNT, Decimal(1))
    return [row for row in rows if abs(row.amount - usual) <= near]


def from_payees(history: list[Seen], today: dt.date) -> list[Proposal]:
    """A proposal per payee paid or paying about the same amount at a steady gap of a month or more.

    Read by payee, account and direction over the last 400 days. A payee
    booked every three weeks or more often overall is left out, and so is a
    habit whose last booking is more than its gap plus half a month ago.
    """
    groups: dict[tuple[int, int, bool], list[Seen]] = {}
    for row in history:
        if row.payee is not None and not row.bill and row.day >= today - LOOKBACK:
            groups.setdefault((row.payee, row.account, row.amount > ZERO), []).append(row)
    found = []
    for (payee, account, incoming), rows in groups.items():
        # A shop visited every week at the same price is no bill, though its
        # same-priced visits alone might look monthly.
        if every_of([row.day for row in rows]) is None:
            continue
        steady = _steady(rows)
        every = every_of([row.day for row in steady]) if len(steady) >= LEAST_SEEN else None
        if every is None or _over(steady, every, today):
            continue
        name = steady[0].payee_name or steady[0].counterparty or "Payee"
        side = "in" if incoming else "out"
        found.append(_proposal(f"payee:{payee}:{account}:{side}", "payee", name, steady, every))
    return sorted(found, key=lambda p: p.name.casefold())


def proposals(
    history: list[Seen], today: dt.date, planned: set[tuple[int | None, int]], names: set[str]
) -> list[Proposal]:
    """The bills, then the recurring payees no bill covers, leaving out what a plan covers.

    `planned` holds each plan's payee and account, `names` each plan's name casefolded.
    """
    bills = from_bills(history, today)
    covered = set(planned) | {(p.payee, p.account) for p in bills if p.payee is not None}
    payees = [p for p in from_payees(history, today) if (p.payee, p.account) not in covered]
    return [
        p
        for p in bills + payees
        if p.name.casefold() not in names
        and (p.payee is None or (p.payee, p.account) not in planned)
    ]
