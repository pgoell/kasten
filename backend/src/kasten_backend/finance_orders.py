"""PayPal and Amazon orders: store what the order mail job sends, and match each charge.

The bank booking stays the one transaction. A charge that matches one
splits it into the charge's items, so the budget counts each item in its
own category and nothing twice. The rules that keep it so:

- An order is stored by its source and order id; sending it again changes
  nothing. A charge already matched is never rewritten by a later send.
- A charge whose items do not add up to it is never matched (`items_off`).
- A charge matches a booking of the opposite amount (a refund, the same
  amount) booked from `EARLY_DAYS` before to `LATE_DAYS` after it, or up to
  `NAMED_LATE_DAYS` when it names the order id, whose purpose or
  counterparty names the source, which is not a move between own accounts
  and which no other charge holds. Amazon's debits start with the order id;
  PayPal's name the shop ("Ihr Einkauf bei ..."). One that names the order
  id beats one that names the merchant, which beats one that names none; one
  that names another order or shop never matches. Two of the best kind
  leave the charge `ambiguous`, never guessed, unless both name the order
  id: two shipments of one amount, either right.
- A booking the owner split or sorted by hand is linked but left as it is
  (`kept`); the booking view shows the order's items beside it.
- A refund is linked to its own booking and never split.
- Amazon refunds come with no mail the job reads, so a booking of money in
  that names a stored Amazon order id becomes that order's refund.

Nothing here commits.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import exists, func, literal, or_, select
from sqlalchemy.orm import selectinload

from kasten_backend import finance, finance_sorting
from kasten_backend.finance_models import Account, Transaction, TransactionSplit
from kasten_backend.finance_order_models import OrderCharge, OrderItem, ShopOrder

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

EARLY_DAYS = 3
"""How many days before its charge a booking may be booked: the mail can come a day late."""

LATE_DAYS = 10
"""How many days after its charge a booking may be booked.

PayPal books a payment one or two working days later, Amazon a shipment
within a few days, a card a week later at most. A refund takes longer.
"""

REFUND_LATE_DAYS = 14
"""How many days after the refund mail its booking may be booked."""

NAMED_LATE_DAYS = 30
"""How many days after its charge a booking that names the order id may be booked.

Amazon's direct debits start with the order id, which no other booking
carries, so a late one is still safe to take.
"""

_ORDER_ID = re.compile(r"\b(?:\d{3}|d01)-\d{7}-\d{7}\b")
"""An Amazon order id as a booking's lowercased text carries it."""

_PAYPAL_SHOP = re.compile(r"(?:^|/)\s*\.\s*(.*?),\s*ihr einkauf bei")
"""The shop a PayPal debit names: `.../PP.1234.PP/. Shop GmbH, Ihr Einkauf bei Shop GmbH`."""

AMAZON_REFUND_DAYS = 180
"""How long after an Amazon order a booking of money in naming it counts as its refund."""

WORDS: dict[str, tuple[str, ...]] = {"amazon": ("amazon", "amzn"), "paypal": ("paypal",)}
"""What a booking of each source carries in its purpose or counterparty, lowercased."""


@dataclass(frozen=True)
class Stored:
    """What one post did to its orders, and how many charges it matched."""

    created: int
    updated: int
    unchanged: int
    matched: int


def _merchant_word(merchant: str) -> str | None:
    """The merchant's first word of three letters or more, lowercased, which a purpose may name."""
    words = re.findall(r"[^\W_]{3,}", merchant.lower())
    return words[0] if words else None


def _items_of(charge: dict[str, Any]) -> list[tuple[str, Decimal]]:
    return [(item["text"], item["amount"]) for item in charge.get("items", [])]


def _same(charge: OrderCharge, sent: dict[str, Any]) -> bool:
    """Whether a stored charge already holds what was sent."""
    return (
        charge.charged_on == sent["charged_on"]
        and charge.amount == sent["amount"]
        and [(item.text, item.amount) for item in charge.items] == _items_of(sent)
    )


def _status_of(kind: str, amount: Decimal, items: list[tuple[str, Decimal]]) -> str:
    """A charge's status before matching: `items_off` when its items do not add up to it."""
    if kind == "charge" and sum((a for _, a in items), Decimal(0)) != amount:
        return "items_off"
    return "waiting"


def _fill(charge: OrderCharge, sent: dict[str, Any]) -> None:
    charge.charged_on = sent["charged_on"]
    charge.amount = sent["amount"]
    items = _items_of(sent)
    charge.items = [
        OrderItem(position=at, text=text, amount=amount) for at, (text, amount) in enumerate(items)
    ]
    charge.status = _status_of(charge.kind, charge.amount, items)


def _merge(order: ShopOrder, sent: dict[str, Any]) -> bool:
    """Bring what was sent into a stored order; whether anything changed.

    A charge not sent stays, since the job reads only recent mail and an old
    shipment falls out of its window. A matched charge stays as it is. A send
    with no total is one whose order confirmation the job did not find, and
    its day a stand-in, so a stored total and day stay.
    """
    changed = False
    guessed = sent["total"] is None and order.total is not None
    fields = (
        ("merchant", "currency") if guessed else ("ordered_on", "merchant", "total", "currency")
    )
    for field in fields:
        if getattr(order, field) != sent[field]:
            setattr(order, field, sent[field])
            changed = True
    held = {(c.kind, c.key): c for c in order.charges}
    for part in sent["charges"]:
        charge = held.get((part["kind"], part["key"]))
        if charge is None:
            charge = OrderCharge(kind=part["kind"], key=part["key"])
            _fill(charge, part)
            order.charges.append(charge)
            changed = True
        elif charge.transaction_id is None and not _same(charge, part):
            _fill(charge, part)
            changed = True
    return changed


async def store_orders(session: AsyncSession, orders: list[dict[str, Any]]) -> Stored:
    """Store each order by its source and order id, then match every charge that waits."""
    await finance_sorting.lock(session)
    created = updated = unchanged = 0
    for sent in orders:
        order = await session.scalar(
            _loaded().where(
                ShopOrder.source == sent["source"], ShopOrder.order_key == sent["order_key"]
            )
        )
        if order is None:
            order = ShopOrder(
                **{k: sent[k] for k in ("source", "order_key", "ordered_on", "merchant")},
                total=sent["total"],
                currency=sent["currency"],
            )
            order.charges = []
            _merge(order, sent)
            session.add(order)
            created += 1
        elif _merge(order, sent):
            updated += 1
        else:
            unchanged += 1
        # Each order in turn, so a batch that names one twice finds it the second time.
        await session.flush()
    matched = await match(session)
    return Stored(created, updated, unchanged, matched)


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


def _rank(text: str, order: ShopOrder) -> int:
    """How well a booking's lowercased text names the order.

    `NAMED` for the order id. Else, for Amazon, `OTHER` when it names
    another order id; for PayPal, 1 when the shop it names holds the
    merchant's first word, 0 when it names none, `OTHER` when it names
    another shop.
    """
    if order.order_key.lower() in text:
        return NAMED
    if order.source == "amazon":
        return OTHER if _ORDER_ID.search(text) else 0
    shop = _PAYPAL_SHOP.search(text)
    word = _merchant_word(order.merchant)
    if shop is None or not shop.group(1).strip() or word is None:
        return 0
    return 1 if word in shop.group(1) else OTHER


def _text() -> Any:
    return func.lower(
        func.concat(
            func.coalesce(Transaction.purpose, ""),
            " ",
            func.coalesce(Transaction.counterparty_name, ""),
        )
    )


def _free() -> Any:
    """A booking no charge holds, and no move between own accounts, its twin in or not."""
    return (
        ~exists().where(OrderCharge.transaction_id == Transaction.id),
        Transaction.transfer_group.is_(None),
        ~exists().where(
            Account.iban == Transaction.counterparty_iban, Account.id != Transaction.account_id
        ),
    )


async def _candidates(session: AsyncSession, charge: OrderCharge) -> list[Candidate]:
    order = charge.order
    sign = -1 if charge.kind == "charge" else 1
    late = LATE_DAYS if charge.kind == "charge" else REFUND_LATE_DAYS
    text = _text()
    rows = await session.execute(
        select(Transaction.id, Transaction.booking_date, text)
        .where(
            Transaction.amount == sign * charge.amount,
            Transaction.currency == order.currency,
            Transaction.booking_date.between(
                charge.charged_on - timedelta(days=EARLY_DAYS),
                charge.charged_on + timedelta(days=max(late, NAMED_LATE_DAYS)),
            ),
            or_(*(func.strpos(text, word) > 0 for word in WORDS[order.source])),
            *_free(),
        )
        .order_by(Transaction.booking_date, Transaction.id)
    )
    last = charge.charged_on + timedelta(days=late)
    found = [(id_, day, _rank(words, order)) for id_, day, words in rows]
    # Past the usual window only a booking that names the order id is taken.
    return [Candidate(id_, rank) for id_, day, rank in found if rank == NAMED or day <= last]


async def _split(session: AsyncSession, charge: OrderCharge, booking_id: int) -> str:
    """Split the booking into the charge's items, unless the owner split or sorted it by hand.

    A booking with splits of any kind counts as split by hand: a charge
    matched before holds its booking, so no split here came from an order.
    """
    if charge.kind == "refund":
        return "linked"
    by_hand = await session.scalar(
        select(
            or_(
                exists().where(Transaction.id == booking_id, Transaction.category_set_by == "hand"),
                exists().where(TransactionSplit.transaction_id == booking_id),
            )
        )
    )
    if by_hand:
        return "kept"
    parts = [{"amount": -item.amount, "text": item.text} for item in charge.items]
    await finance.replace_splits(session, booking_id, parts)
    await finance_sorting.apply_rules(session, [booking_id])
    return "split"


async def _amazon_refunds(session: AsyncSession, ids: Sequence[int] | None) -> int:
    """Make a refund of each booking of money in that names a stored Amazon order id."""
    text = _text()
    rows = await session.execute(
        select(ShopOrder.id, Transaction.id, Transaction.booking_date, Transaction.amount)
        .join(
            Transaction,
            (func.strpos(text, func.lower(ShopOrder.order_key)) > 0)
            & (Transaction.amount > 0)
            & Transaction.booking_date.between(
                ShopOrder.ordered_on, ShopOrder.ordered_on + literal(AMAZON_REFUND_DAYS)
            ),
        )
        .where(
            ShopOrder.source == "amazon",
            *_free(),
            *([] if ids is None else [Transaction.id.in_(ids)]),
        )
        # A booking that names two orders refunds the first of them only.
        .distinct(Transaction.id)
        .order_by(Transaction.id, ShopOrder.id)
    )
    made = 0
    for order_id, booking_id, day, amount in rows:
        session.add(
            OrderCharge(
                order_id=order_id,
                kind="refund",
                key=f"booking-{booking_id}",
                charged_on=day,
                amount=amount,
                transaction_id=booking_id,
                status="linked",
            )
        )
        made += 1
    await session.flush()
    return made


async def match(session: AsyncSession, ids: Sequence[int] | None = None) -> int:
    """Match each charge that waits to its booking; how many matched.

    With `ids`, the bookings a batch just brought in, only the charges whose
    window could hold one of them are tried. Charges go oldest first, so of
    two that could take one booking the older one does.
    """
    await finance_sorting.lock(session)
    waiting = (
        select(OrderCharge)
        .options(selectinload(OrderCharge.order), selectinload(OrderCharge.items))
        .where(OrderCharge.transaction_id.is_(None), OrderCharge.status != "items_off")
        .order_by(OrderCharge.charged_on, OrderCharge.id)
    )
    if ids is not None:
        if not ids:
            return 0
        days = (
            await session.execute(
                select(
                    func.min(Transaction.booking_date), func.max(Transaction.booking_date)
                ).where(Transaction.id.in_(ids))
            )
        ).one()
        first: date = days[0] - timedelta(days=max(REFUND_LATE_DAYS, NAMED_LATE_DAYS))
        last: date = days[1] + timedelta(days=EARLY_DAYS)
        waiting = waiting.where(OrderCharge.charged_on.between(first, last))
    matched = await _amazon_refunds(session, ids)
    charges = list(await session.scalars(waiting))
    # Twice: first only bookings that name their order id, so an older charge
    # cannot take a booking that names another order; then the rest.
    for named in (True, False):
        for charge in charges:
            if charge.transaction_id is not None:
                continue
            found = await _candidates(session, charge)
            status, booking_id = choose([c for c in found if c.rank == NAMED] if named else found)
            if booking_id is None:
                charge.status = status
                continue
            charge.transaction_id = booking_id
            # Flushed first, so the booking is held before its splits are written.
            await session.flush()
            charge.status = await _split(session, charge, booking_id)
            matched += 1
    await session.flush()
    return matched


def _loaded() -> Any:
    """Orders with their charges and items, read afresh.

    A refund made from a booking that names its order is not in the charges
    of that order as the session already holds it.
    """
    return (
        select(ShopOrder)
        .options(selectinload(ShopOrder.charges).selectinload(OrderCharge.items))
        .execution_options(populate_existing=True)
    )


async def unmatched(session: AsyncSession, limit: int) -> list[ShopOrder]:
    """The newest orders with a charge no booking holds yet, or with no charge at all."""
    open_charge = exists().where(
        OrderCharge.order_id == ShopOrder.id, OrderCharge.transaction_id.is_(None)
    )
    no_charge = ~exists().where(OrderCharge.order_id == ShopOrder.id)
    statement = (
        _loaded()
        .where(or_(open_charge, no_charge))
        .order_by(ShopOrder.ordered_on.desc(), ShopOrder.id.desc())
        .limit(limit)
    )
    return list(await session.scalars(statement))


async def of_booking(session: AsyncSession, booking_id: int) -> tuple[ShopOrder, int] | None:
    """The order a booking paid or got back from, and the charge it holds, or None."""
    row = (
        await session.execute(
            select(OrderCharge.order_id, OrderCharge.id).where(
                OrderCharge.transaction_id == booking_id
            )
        )
    ).first()
    if row is None:
        return None
    order = (await session.scalars(_loaded().where(ShopOrder.id == row[0]))).one()
    return order, row[1]
