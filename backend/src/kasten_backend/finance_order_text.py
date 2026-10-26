"""How a bank booking's text names a PayPal or Amazon order, and which booking a charge takes.

Amazon's direct debits start with the order id. PayPal's name the shop twice,
the legal name before the comma and the shop's own after "Ihr Einkauf bei".
`finance_orders` reads the bookings; this ranks them and picks one.
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence

    from kasten_backend.finance_order_models import ShopOrder

_ORDER_ID = re.compile(r"\b(?:\d{3}|d01)-\d{7}-\d{7}\b")
"""An Amazon order id as a booking's lowercased text carries it."""

_PAYPAL_SHOP = re.compile(r"(?:^|/)\s*\.\s*([^/]*?),\s*ihr einkauf bei\s*([^/]*)")
"""The two names a PayPal debit gives its shop.

`1053.../PP.2275.PP/. Takeaway.com Payments B.V., Ihr Einkauf bei
Takeaway.comPayments B.V. FOLGELASTSCHRIFT`: the legal name before the
comma, and the shop's own after "Ihr Einkauf bei". A refund to the bank
starts at the dot.
"""

_NOISE = frozenset(
    (
        "gmbh", "bv", "inc", "ltd", "limited", "sarl", "sa", "sca", "ag", "se", "llc", "kg",
        "co", "eu", "folgelastschrift", "erstlastschrift", "lastschrift",
    )
)  # fmt: skip
"""Legal forms and the bank's own words, which say nothing about which shop it was."""


def shop_name(name: str) -> str:
    """A shop's name as it is compared: casefolded, legal forms dropped, only letters and digits.

    `Takeaway.com Payments B.V.` and `Takeaway.comPayments B.V.` are both
    `takeawaycompayments`; a name PayPal cut short, `Google Payment Irela...`,
    is the start of the whole one.
    """
    words = (re.sub(r"[^\w]|_", "", word) for word in name.casefold().split())
    return "".join(word for word in words if word not in _NOISE)


def _same_shop(merchant: str, named: str) -> bool:
    mine, theirs = shop_name(merchant), shop_name(named)
    return bool(mine and theirs) and (mine in theirs or theirs in mine)


@dataclass(frozen=True)
class Candidate:
    """A booking that could have paid a charge: its id and how well its text names the order.

    Candidates come oldest first, by booking date and id.
    """

    id: int
    rank: int


NAMED = 2
"""The rank of a booking that names the order id."""

OTHER = -1
"""The rank of a booking that names another order or another shop: never a match."""


def choose(candidates: Sequence[Candidate]) -> tuple[str, int | None]:
    """The booking a charge matches, or why none: `waiting`, or `ambiguous` for a tie.

    Two bookings that both name the order id are two shipments of one order
    at the same amount, so either is right: the older is taken, and the other
    is left for the next shipment.
    """
    fits = [c for c in candidates if c.rank > OTHER]
    if not fits:
        return "waiting", None
    best = max(c.rank for c in fits)
    top = [c for c in fits if c.rank == best]
    if len(top) > 1 and best != NAMED:
        return "ambiguous", None
    return "linked", top[0].id


def rank(text: str, purpose: str, order: ShopOrder) -> int:
    """How well a booking's lowercased text names the order.

    `NAMED` for the order id. An Amazon debit always starts with its order
    id, so one without this order's is `OTHER`. A PayPal debit is 1 when
    either name it gives the shop is the merchant's, 0 when it gives none
    (money sent to a person), and `OTHER` when it names another shop or is
    in no shape a PayPal debit takes, such as a card payment.
    """
    if order.order_key.lower() in text:
        return NAMED
    if order.source == "amazon":
        return OTHER
    # The purpose alone: the counterparty after it is PayPal's own name.
    shop = _PAYPAL_SHOP.search(purpose.lower())
    if shop is None:
        return OTHER
    names = [name for name in shop.groups() if shop_name(name)]
    if not names:
        return 0
    return 1 if any(_same_shop(order.merchant, name) for name in names) else OTHER
