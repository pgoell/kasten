"""The finance tables: accounts, their balances, bookings and the splits under a booking.

Every table lives in the `finance` schema and is the only copy of what it
holds, unlike the derived index. See docs/explanation/finance-in-postgres.md.
"""

import datetime as dt  # noqa: TC003  SQLAlchemy reads the annotation at runtime
import uuid  # noqa: TC003  SQLAlchemy reads the annotation at runtime
from decimal import Decimal  # noqa: TC003  SQLAlchemy reads the annotation at runtime
from typing import Any, Literal, get_args

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kasten_backend.db import Base

SCHEMA = "finance"

Kind = Literal["giro", "saving", "card", "cash"]
"""What an account is. Checked in the database as well as the route, since jobs write here."""

KINDS: tuple[str, ...] = get_args(Kind)

Amount = Numeric(14, 2)
"""Euros and cents, signed: spending is negative. Never a float."""


class Account(Base):
    """A real bank account, or the cash in a wallet."""

    __tablename__ = "account"
    __table_args__ = (
        CheckConstraint(
            f"kind IN ({', '.join(f"'{kind}'" for kind in KINDS)})", name="account_kind_check"
        ),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    # The key a job upserts by. Not the IBAN, which cash has none of.
    name: Mapped[str] = mapped_column(Text, unique=True)
    bank: Mapped[str | None] = mapped_column(Text)
    # Unique, because transfer linking reads an account off a counterparty IBAN.
    iban: Mapped[str | None] = mapped_column(Text, unique=True)
    kind: Mapped[str] = mapped_column(Text)
    shared: Mapped[bool] = mapped_column(server_default=text("false"))


class BalanceSnapshot(Base):
    """The balance the bank reported for an account on one day.

    Stored as the bank said it, never summed from bookings, so a gap in the
    bookings shows as a mismatch rather than a wrong balance.
    """

    __tablename__ = "balance_snapshot"
    __table_args__ = ({"schema": SCHEMA},)

    account_id: Mapped[int] = mapped_column(ForeignKey(Account.id), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    amount: Mapped[Decimal] = mapped_column(Amount)


class Transaction(Base):
    """One booking on one account, as the bank sent it."""

    __tablename__ = "transaction"
    __table_args__ = (
        # The source key carries an occurrence index, so two identical bookings
        # on one day are two keys and both survive, and a job that sends the
        # same booking again is refused by this and nothing else.
        UniqueConstraint("account_id", "source_key", name="transaction_account_source_key"),
        Index("transaction_account_booking_date", "account_id", "booking_date"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey(Account.id))
    booking_date: Mapped[dt.date] = mapped_column(Date)
    value_date: Mapped[dt.date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Amount)
    currency: Mapped[str] = mapped_column(String(3), server_default="EUR")
    purpose: Mapped[str | None] = mapped_column(Text)
    posting_text: Mapped[str | None] = mapped_column(Text)
    counterparty_name: Mapped[str | None] = mapped_column(Text)
    counterparty_iban: Mapped[str | None] = mapped_column(Text)
    bank_ref: Mapped[str | None] = mapped_column(Text)
    # `none_as_null`: a booking sent without its raw record holds SQL NULL, not JSON `null`.
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    source_key: Mapped[str] = mapped_column(Text)
    imported_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    transfer_group: Mapped[uuid.UUID | None] = mapped_column(UUID)

    splits: Mapped[list[TransactionSplit]] = relationship(
        order_by="TransactionSplit.id", cascade="all, delete-orphan"
    )


class TransactionSplit(Base):
    """One part of a booking, such as one item of an order paid in one charge.

    The parts of a booking add up to its amount. The database cannot say so
    across rows, so `finance.replace_splits` refuses a set that does not.
    """

    __tablename__ = "transaction_split"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey(Transaction.id, ondelete="CASCADE"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Amount)
    text: Mapped[str | None] = mapped_column(Text)
