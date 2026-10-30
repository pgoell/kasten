"""The tax tables: a booking's tax mark, and the receipts kept beside the vault.

A tax mark puts one booking on one line of the return, with the amount that counts there.
A receipt is a file in `settings.receipts_path`, known by its hash.
See docs/reference/http-api/finance-tax.md.
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
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base
from kasten_backend.finance_models import SCHEMA, Amount, Transaction

FormLine = Literal[
    "werbungskosten",
    "sonderausgaben",
    "haushaltsnahe_dienste",
    "handwerker",
    "aussergewoehnliche_belastungen",
]
"""The lines of the return a mark can name. `finance_tax.LINES` has their words."""

FORM_LINES: tuple[str, ...] = get_args(FormLine)

LABOUR_LINES = ("haushaltsnahe_dienste", "handwerker")
"""The §35a lines: only the labour counts, and only when paid by transfer, never cash."""

MediaType = Literal["application/pdf", "image/jpeg", "image/png"]
"""What a receipt may be. The receipt reader sends each to the model as it is."""

MEDIA_TYPES: tuple[str, ...] = get_args(MediaType)

ReceiptSource = Literal["upload", "capture", "mail"]
"""How a receipt came: dropped on a booking in the pane, shared to `/capture`, or a mail."""

RECEIPT_SOURCES: tuple[str, ...] = get_args(ReceiptSource)


def _one_of(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    return CheckConstraint(f"{column} IN ({', '.join(f"'{v}'" for v in values)})", name=name)


class TaxMark(Base):
    """A booking on one line of the return, and the amount that counts there.

    One mark a booking, never above its amount. A mark on money in takes its amount off the
    line in its year. Whether a receipt exists is not stored: it does when a receipt
    names the booking.
    """

    __tablename__ = "tax_mark"
    __table_args__ = (
        _one_of("form_line", FORM_LINES, "tax_mark_form_line_check"),
        CheckConstraint("tax_amount > 0", name="tax_mark_tax_amount_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey(Transaction.id, ondelete="CASCADE"), unique=True
    )
    form_line: Mapped[str] = mapped_column(Text)
    tax_amount: Mapped[Decimal] = mapped_column(Amount)
    # False when no receipt is needed, such as a pension fund's yearly statement.
    receipt_needed: Mapped[bool] = mapped_column(server_default=text("true"))
    note: Mapped[str | None] = mapped_column(Text)


class Receipt(Base):
    """A receipt file by its hash, what the reader read off it, and the booking it belongs to."""

    __tablename__ = "receipt"
    __table_args__ = (
        _one_of("media_type", MEDIA_TYPES, "receipt_media_type_check"),
        _one_of("source", RECEIPT_SOURCES, "receipt_source_check"),
        _one_of("read_line", FORM_LINES, "receipt_read_line_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # The same file sent twice is the one receipt.
    sha256: Mapped[str] = mapped_column(Text, unique=True)
    # Relative to `settings.receipts_path`.
    path: Mapped[str] = mapped_column(Text)
    media_type: Mapped[str] = mapped_column(Text)
    size: Mapped[int] = mapped_column(Integer)
    # The name it came with, for showing; never a path.
    name: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    received_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey(Transaction.id, ondelete="SET NULL"), index=True
    )
    # Out of the to-sort queue with no booking: not a receipt for tax.
    dismissed: Mapped[bool] = mapped_column(server_default=text("false"))
    # Deleted by the owner: the row stays, so the mail job's resend is not kept again.
    deleted: Mapped[bool] = mapped_column(server_default=text("false"))
    # What the receipt reader job found. `read_at` set means it is done with
    # this one, `read_error` saying why it found nothing.
    read_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    read_error: Mapped[str | None] = mapped_column(Text)
    read_date: Mapped[dt.date | None] = mapped_column(Date)
    read_amount: Mapped[Decimal | None] = mapped_column(Amount)
    read_payee: Mapped[str | None] = mapped_column(Text)
    read_labour: Mapped[Decimal | None] = mapped_column(Amount)
    read_line: Mapped[str | None] = mapped_column(Text)
