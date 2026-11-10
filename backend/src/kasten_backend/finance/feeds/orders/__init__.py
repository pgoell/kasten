"""PayPal and Amazon orders: the tables, the shop names read off a booking, and the matching.

`models` holds the tables, `text` reads shop names, `matching` stores orders and splits bookings.
"""

from kasten_backend.finance.feeds.orders.matching import (
    match,
    net,
    of_booking,
    store_orders,
    unmatched,
    unsplit_by_hand,
)
from kasten_backend.finance.feeds.orders.models import (
    ChargeKind,
    OrderCharge,
    OrderItem,
    ShopOrder,
    Source,
)
from kasten_backend.finance.feeds.orders.text import Candidate, choose, same_shop, shop_name

__all__ = [
    "Candidate",
    "ChargeKind",
    "OrderCharge",
    "OrderItem",
    "ShopOrder",
    "Source",
    "choose",
    "match",
    "net",
    "of_booking",
    "same_shop",
    "shop_name",
    "store_orders",
    "unmatched",
    "unsplit_by_hand",
]
