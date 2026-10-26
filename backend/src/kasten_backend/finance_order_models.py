"""The order tables: PayPal and Amazon orders from the order mails, and the bookings they paid.

A job reads the order mails and sends what it found; kasten matches each
charge to the bank booking that paid it and splits that booking into the
charge's items. No order ever makes a booking of its own. See
docs/reference/http-api/finance-orders.md.
"""

import datetime as dt  # noqa: TC003  SQLAlchemy reads the annotation at runtime
from decimal import Decimal  # noqa: TC003  SQLAlchemy reads the annotation at runtime
from typing import Literal, get_args

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kasten_backend.db import Base
from kasten_backend.finance_models import SCHEMA, Amount, Transaction

Source = Literal["amazon", "paypal"]
"""Who the order came through. Each names the words its bank bookings carry."""

SOURCES: tuple[str, ...] = get_args(Source)

ChargeKind = Literal["charge", "refund"]
"""Money out for the order, or money back."""

CHARGE_KINDS: tuple[str, ...] = get_args(ChargeKind)

Status = Literal["waiting", "ambiguous", "items_off", "split", "kept", "linked"]
"""Where a charge stands.

`waiting`: no booking found yet. `ambiguous`: more than one booking fits.
`items_off`: its items do not add up to it, so it is never matched. `split`:
matched, the booking split into its items. `kept`: matched to a booking the
owner had split or sorted by hand, which stays as it was. `linked`: a refund,
matched and never split.
"""

STATUSES: tuple[str, ...] = get_args(Status)


def _one_of(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    return CheckConstraint(f"{column} IN ({', '.join(f"'{v}'" for v in values)})", name=name)


class ShopOrder(Base):
    """An order by its shop's id: the Amazon order number, or PayPal's transaction code."""

    __tablename__ = "shop_order"
    __table_args__ = (
        UniqueConstraint("source", "order_key", name="shop_order_source_key"),
        _one_of("source", SOURCES, "shop_order_source_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    source: Mapped[str] = mapped_column(Text)
    order_key: Mapped[str] = mapped_column(Text)
    ordered_on: Mapped[dt.date] = mapped_column(Date)
    merchant: Mapped[str] = mapped_column(Text)
    # What the order mail says it came to, for showing. Matching reads the charges.
    total: Mapped[Decimal | None] = mapped_column(Amount)
    currency: Mapped[str] = mapped_column(String(3), server_default="EUR")
    received_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    charges: Mapped[list[OrderCharge]] = relationship(
        order_by="OrderCharge.id", cascade="all, delete-orphan", back_populates="order"
    )


class OrderCharge(Base):
    """One payment for an order, or one refund, and the bank booking it matched.

    Amazon charges each shipment on its own, so an Amazon order has a charge
    per shipment; a PayPal payment is one charge. Amounts are positive: what
    was paid, or what came back. A booking pays at most one charge.
    """

    __tablename__ = "order_charge"
    __table_args__ = (
        UniqueConstraint("order_id", "kind", "key", name="order_charge_order_kind_key"),
        UniqueConstraint("transaction_id", name="order_charge_transaction"),
        _one_of("kind", CHARGE_KINDS, "order_charge_kind_check"),
        _one_of("status", STATUSES, "order_charge_status_check"),
        CheckConstraint("amount > 0", name="order_charge_amount_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey(ShopOrder.id, ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    # The job's name for it, such as the shipment mail's id; unique within the order.
    key: Mapped[str] = mapped_column(Text)
    charged_on: Mapped[dt.date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Amount)
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey(Transaction.id, ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(Text, server_default="waiting")

    order: Mapped[ShopOrder] = relationship(back_populates="charges")
    items: Mapped[list[OrderItem]] = relationship(
        order_by="OrderItem.position", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    """One line of a charge: an item at its line price, or shipping, tax or a discount."""

    __tablename__ = "order_item"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    charge_id: Mapped[int] = mapped_column(
        ForeignKey(OrderCharge.id, ondelete="CASCADE"), index=True
    )
    position: Mapped[int]
    text: Mapped[str] = mapped_column(Text)
    # Positive for what was paid; a discount is negative.
    amount: Mapped[Decimal] = mapped_column(Amount)
