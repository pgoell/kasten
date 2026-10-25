"""The finance tables: accounts, balances, bookings, splits, and what sorts them into categories.

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

CategoryKind = Literal["fixed", "flexible", "non_monthly", "income", "saving", "ignore"]
"""What a category counts as in the budget. The budget itself comes later (#1036)."""

CATEGORY_KINDS: tuple[str, ...] = get_args(CategoryKind)

RuleKind = Literal["text_contains", "payee"]
"""What a rule reads: the booking's purpose, or its payee's name."""

RULE_KINDS: tuple[str, ...] = get_args(RuleKind)

SetBy = Literal["rule", "hand"]
"""Who gave a booking its category. A rule never overwrites `hand`."""

SET_BY: tuple[str, ...] = get_args(SetBy)


def _one_of(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    """A check that `column` holds one of `values`, since jobs write here as well as the routes."""
    return CheckConstraint(f"{column} IN ({', '.join(f"'{v}'" for v in values)})", name=name)


def _sorted_by_someone(name: str) -> CheckConstraint:
    """A category and the word for who set it come and go together."""
    return CheckConstraint("(category_id IS NULL) = (category_set_by IS NULL)", name=name)


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


class Category(Base):
    """One line of the budget, such as Groceries, in one kind."""

    __tablename__ = "category"
    __table_args__ = (_one_of("kind", CATEGORY_KINDS, "category_kind_check"), {"schema": SCHEMA})

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    kind: Mapped[str] = mapped_column(Text)


class Payee(Base):
    """A counterparty under its cleaned name, with the category its bookings take by default.

    `key` is what bookings are matched by: the counterparty name casefolded,
    every run of characters that are not letters or digits made one space, and
    trimmed (`finance_sorting.payee_key`). `name` is the first spelling seen,
    for showing.
    """

    __tablename__ = "payee"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    key: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    category_id: Mapped[int | None] = mapped_column(ForeignKey(Category.id, ondelete="SET NULL"))


class Rule(Base):
    """A pattern that gives a booking a category. `finance_sorting` says the order they fire in."""

    __tablename__ = "rule"
    __table_args__ = (
        _one_of("kind", RULE_KINDS, "rule_kind_check"),
        UniqueConstraint("kind", "pattern", name="rule_kind_pattern"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    pattern: Mapped[str] = mapped_column(Text)
    category_id: Mapped[int] = mapped_column(ForeignKey(Category.id, ondelete="CASCADE"))


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
        _one_of("category_set_by", SET_BY, "transaction_set_by_check"),
        _sorted_by_someone("transaction_category_set_by"),
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
    payee_id: Mapped[int | None] = mapped_column(ForeignKey(Payee.id))
    # No `ondelete`: deleting a category clears its bookings first, both columns
    # at once, which a `SET NULL` here could not do.
    category_id: Mapped[int | None] = mapped_column(ForeignKey(Category.id))
    category_set_by: Mapped[str | None] = mapped_column(Text)

    payee: Mapped[Payee | None] = relationship()
    splits: Mapped[list[TransactionSplit]] = relationship(
        order_by="TransactionSplit.id", cascade="all, delete-orphan"
    )


class TransactionSplit(Base):
    """One part of a booking, such as one item of an order paid in one charge.

    The parts of a booking add up to its amount. The database cannot say so
    across rows, so `finance.replace_splits` refuses a set that does not.
    """

    __tablename__ = "transaction_split"
    __table_args__ = (
        _one_of("category_set_by", SET_BY, "transaction_split_set_by_check"),
        _sorted_by_someone("transaction_split_category_set_by"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey(Transaction.id, ondelete="CASCADE"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Amount)
    text: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[int | None] = mapped_column(ForeignKey(Category.id))
    category_set_by: Mapped[str | None] = mapped_column(Text)
