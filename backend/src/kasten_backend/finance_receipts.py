"""The receipt store: files kept by their hash beside the vault, and the booking each belongs to.

A receipt arrives from the pane, from `/capture` or from the mail job, as
bytes. Its type is read off its first bytes, never the name or the header it
came with. The same bytes sent again are the one receipt, so a job may send
every mail it sees on every run. The receipt reader job reads it later; kasten
then proposes the booking it paid and a tax mark, and nothing is linked or
marked until the owner confirms.
"""

import asyncio
import datetime as dt
import hashlib
import os
import tempfile
from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import selectinload

from kasten_backend.finance_models import Transaction
from kasten_backend.finance_tax_models import LABOUR_LINES, Receipt

if TYPE_CHECKING:
    from decimal import Decimal
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

MAX_BYTES = 20 * 1024 * 1024
"""The largest receipt kept. A scanned invoice of a few pages fits; a video does not."""

SUFFIXES = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}


class ReceiptRefusedError(ValueError):
    """A file that is no receipt kasten keeps: wrong type, empty or too big."""


class ReceiptTakenError(ValueError):
    """The receipt already belongs to another booking."""


def sniff(data: bytes) -> str | None:
    """The media type the first bytes say, or None for anything but PDF, JPEG and PNG."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


def _write(root: Path, relative: str, data: bytes) -> None:
    """Write the file whole or not at all: a reader never sees half a receipt."""
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=".part-")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        os.replace(temporary, target)  # noqa: PTH105  the fd-based temp file has no Path
    except BaseException:
        os.unlink(temporary)  # noqa: PTH108  as above
        raise


@dataclass(frozen=True)
class Stored:
    """The receipt, and whether this send made it or found it already kept."""

    receipt: Receipt
    created: bool


async def store(  # noqa: PLR0913  each fact about the file is its own argument
    session: AsyncSession,
    root: Path,
    data: bytes,
    *,
    name: str | None,
    source: str,
    transaction_id: int | None = None,
) -> Stored:
    """Keep the file by its hash, and link it to the booking when one is named.

    A file already kept is answered as it is, and linked when it belongs to no
    booking yet; one that belongs to another booking is refused.
    """
    if not data:
        msg = "The file is empty"
        raise ReceiptRefusedError(msg)
    if len(data) > MAX_BYTES:
        msg = f"A receipt is at most {MAX_BYTES // (1024 * 1024)} MB"
        raise ReceiptRefusedError(msg)
    media_type = sniff(data)
    if media_type is None:
        msg = "A receipt is a PDF, JPEG or PNG"
        raise ReceiptRefusedError(msg)
    if transaction_id is not None and await session.get(Transaction, transaction_id) is None:
        msg = f"No booking {transaction_id}"
        raise ReceiptRefusedError(msg)
    digest = hashlib.sha256(data).hexdigest()
    relative = f"{digest[:2]}/{digest}{SUFFIXES[media_type]}"
    # Before the row, so a row never names a file that is not there. The same
    # bytes written twice are the same file.
    await asyncio.to_thread(_write, root, relative, data)
    # ON CONFLICT, so two sends of one file at once make one row, not an error.
    made = await session.scalar(
        insert(Receipt)
        .values(
            sha256=digest,
            path=relative,
            media_type=media_type,
            size=len(data),
            name=None if name is None else name[:200],
            source=source,
            transaction_id=transaction_id,
        )
        .on_conflict_do_nothing(index_elements=["sha256"])
        .returning(Receipt.id)
    )
    receipt = await session.scalar(
        select(Receipt).where(Receipt.sha256 == digest).execution_options(populate_existing=True)
    )
    assert receipt is not None  # noqa: S101  made above, or there before
    if made is None and transaction_id is not None:
        await link(session, receipt, transaction_id)
    return Stored(receipt, made is not None)


async def link(session: AsyncSession, receipt: Receipt, transaction_id: int) -> None:
    """Make the receipt the booking's, unless it is another booking's."""
    if receipt.transaction_id not in (None, transaction_id):
        msg = f"This receipt is already on booking {receipt.transaction_id}"
        raise ReceiptTakenError(msg)
    receipt.transaction_id = transaction_id
    receipt.dismissed = False
    await session.flush()


async def remove(session: AsyncSession, receipt: Receipt) -> str:
    """Forget the receipt, and answer its file's path for the caller to delete once committed."""
    await session.delete(receipt)
    await session.flush()
    return receipt.path


async def unread(session: AsyncSession, after: int | None, limit: int) -> list[Receipt]:
    """Receipts the reader has not done yet, oldest first, from past the id `after`."""
    query = select(Receipt).where(Receipt.read_at.is_(None))
    if after is not None:
        query = query.where(Receipt.id > after)
    found = await session.scalars(query.order_by(Receipt.id).limit(limit))
    return list(found)


async def to_sort(session: AsyncSession) -> list[Receipt]:
    """Receipts on no booking that nobody put aside, oldest first."""
    found = await session.scalars(
        select(Receipt)
        .where(Receipt.transaction_id.is_(None), Receipt.dismissed.is_(False))
        .order_by(Receipt.id)
    )
    return list(found)


EARLY = dt.timedelta(days=7)
"""How long before the receipt's date a booking may be: paid in advance, or a card's date."""

LATE = dt.timedelta(days=60)
"""How long after it: an invoice paid at its due date, or a transfer done late."""

CANDIDATES = 3


def _words(text: str) -> list[str]:
    return "".join(c if c.isalnum() else " " for c in text.lower()).split()


def _names(payee: str | None, booking: Transaction) -> bool:
    """Whether a word of four letters or more of the read payee is in the booking's names."""
    if not payee:
        return False
    names = " ".join(
        part or ""
        for part in (
            booking.counterparty_name,
            booking.purpose,
            None if booking.payee is None else booking.payee.name,
        )
    ).lower()
    return any(len(word) >= 4 and word in names for word in _words(payee))  # noqa: PLR2004


async def candidates(session: AsyncSession, receipt: Receipt) -> list[Transaction]:
    """The bookings this receipt may have paid, best first: money out of its amount, near its date.

    A booking that names the receipt's payee comes first, then the nearest in
    date. Moves between own accounts never match.
    """
    if receipt.read_amount is None:
        return []
    query = (
        select(Transaction)
        .where(
            Transaction.amount == -abs(receipt.read_amount),
            Transaction.transfer_group.is_(None),
        )
        .options(selectinload(Transaction.payee))
    )
    if receipt.read_date is not None:
        query = query.where(
            Transaction.booking_date.between(receipt.read_date - EARLY, receipt.read_date + LATE)
        )
    found = list(await session.scalars(query.order_by(Transaction.booking_date).limit(50)))
    day = receipt.read_date

    def rank(booking: Transaction) -> tuple[bool, int]:
        distance = 0 if day is None else abs((booking.booking_date - day).days)
        return (not _names(receipt.read_payee, booking), distance)

    return sorted(found, key=rank)[:CANDIDATES]


def proposed_amount(receipt: Receipt, booking: Transaction) -> Decimal | None:
    """The tax amount to propose: the labour share on a §35a line, else the whole, capped."""
    if receipt.read_line is None:
        return None
    amount = receipt.read_amount
    if receipt.read_line in LABOUR_LINES:
        amount = receipt.read_labour
    if amount is None or amount <= 0:
        return None
    return min(amount, abs(booking.amount))


async def of_booking(session: AsyncSession, transaction_id: int) -> list[Receipt]:
    """The booking's receipts, oldest first."""
    found = await session.scalars(
        select(Receipt).where(Receipt.transaction_id == transaction_id).order_by(Receipt.id)
    )
    return list(found)
