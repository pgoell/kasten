"""PayPal and Amazon orders: store what the order mail job sends, and match each charge.

A matched charge splits its bank booking into the charge's items, so the budget counts
each item once, and the booking stays the one transaction. A refund is linked, never split.
Sending an order again changes nothing. Nothing here commits.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import exists, func, literal, or_, select, update
from sqlalchemy.orm import selectinload

from kasten_backend import finance, finance_sorting
from kasten_backend.finance_models import Account, Transaction, TransactionSplit
from kasten_backend.finance_order_models import OrderCharge, OrderItem, ShopOrder
from kasten_backend.finance_order_text import NAMED, Candidate, choose, rank

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

    A charge not sent stays, since the job reads only recent mail. A matched charge stays as
    it is. A send with no total keeps the stored total and day.
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
        select(Transaction.id, Transaction.booking_date, text, Transaction.purpose)
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
    found = [(id_, day, rank(words, purpose or "", order)) for id_, day, words, purpose in rows]
    # Past the usual window only a booking that names the order id is taken.
    return [Candidate(id_, rank) for id_, day, rank in found if rank == NAMED or day <= last]


def net(items: Sequence[OrderItem]) -> list[tuple[str, Decimal]]:
    """The items with each discount or credit shared out over the others, cents exact.

    A discount kept as a part of its own would be money in on a booking of money out, which no
    rule sorts. Cents left by rounding go to the largest items, so the parts add up.
    """
    paid = [(item.text, int(item.amount * 100)) for item in items if item.amount > 0]
    credit = sum(int(item.amount * 100) for item in items if item.amount < 0)
    if not credit:
        return [(text, Decimal(cents) / 100) for text, cents in paid]
    gross = sum(cents for _, cents in paid)
    total = gross + credit
    shares = [cents * total // gross for _, cents in paid]
    order = sorted(range(len(paid)), key=lambda at: (-paid[at][1], at))
    for at in order[: total - sum(shares)]:
        shares[at] += 1
    # An item the credit took whole is no part at all.
    shared = zip(paid, shares, strict=True)
    return [(text, Decimal(share) / 100) for (text, _), share in shared if share]


async def unsplit_by_hand(session: AsyncSession, booking_id: int, *, removed: bool) -> None:
    """Mark the charge whose items split a booking once the owner rewrites that booking's splits.

    `unsplit` when the owner removed the splits, `kept` when they wrote their own.
    """
    await session.execute(
        update(OrderCharge)
        .where(OrderCharge.transaction_id == booking_id, OrderCharge.status == "split")
        .values(status="unsplit" if removed else "kept")
    )


async def _split(session: AsyncSession, charge: OrderCharge, booking_id: int) -> str:
    """Split the booking into the charge's items, unless the owner split or sorted it by hand.

    Splits already there were made by hand, since a matched charge already holds its booking.
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
    parts = [{"amount": -amount, "text": text} for text, amount in net(charge.items)]
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
    """Match each waiting charge to its booking; how many matched.

    With `ids`, only the charges whose window could hold one of the new bookings are tried.
    Charges go oldest first, so the older one takes a booking both could take.
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
    # Two passes: named bookings first, so an older charge cannot take another order's.
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

    A refund made from a booking that names its order is not in the session's copy.
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
