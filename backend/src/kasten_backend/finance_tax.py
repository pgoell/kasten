"""Tax marks and the tax year: which bookings count on which line of the return, and how much.

German employee taxes, by the year a booking was paid in (§11 EStG), which is
its booking date. A mark on money out adds its tax amount to its line; a mark
on money in, such as an employer paying a work cost back, takes it off, since
a cost paid back is no cost. The Tax tab, its exports and the agent's
`tax_year_summary` all read `year_summary`, so they agree by construction.
"""

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, exists, select
from sqlalchemy.orm import aliased, selectinload

from kasten_backend.finance_models import Account, Category, Transaction
from kasten_backend.finance_order_models import OrderCharge
from kasten_backend.finance_tax_models import FORM_LINES, LABOUR_LINES, Receipt, TaxMark

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

LINES: dict[str, str] = {
    "werbungskosten": "Werbungskosten (Anlage N)",
    "sonderausgaben": "Sonderausgaben",
    "haushaltsnahe_dienste": "§35a haushaltsnahe Dienstleistungen",
    "handwerker": "§35a Handwerkerleistungen",
    "aussergewoehnliche_belastungen": "Außergewöhnliche Belastungen",
}
"""Each line's name as the return has it, in the order the Tax tab lists them."""


def allowance(year: int) -> Decimal:
    """The Arbeitnehmer-Pauschbetrag of `year`: Werbungskosten count only above it.

    €1,230 from 2023, €1,200 for 2022, €1,000 before.
    """
    if year >= 2023:  # noqa: PLR2004  the year the law changed
        return Decimal("1230.00")
    return Decimal("1200.00") if year == 2022 else Decimal("1000.00")  # noqa: PLR2004


ZERO = Decimal("0.00")


class MarkRefusedError(ValueError):
    """A mark the money rules do not allow; the message says which rule."""


class NoBookingError(LookupError):
    """No booking has that id."""


async def booking(session: AsyncSession, transaction_id: int) -> tuple[Transaction, Account]:
    """The booking and its account, or `NoBookingError`."""
    found = await session.get(Transaction, transaction_id)
    if found is None:
        raise NoBookingError(transaction_id)
    account = await session.get(Account, found.account_id)
    assert account is not None  # noqa: S101  the foreign key holds it
    return found, account


async def mark_of(session: AsyncSession, transaction_id: int) -> TaxMark | None:
    """The booking's mark, or None."""
    return await session.scalar(select(TaxMark).where(TaxMark.transaction_id == transaction_id))


def check_mark(
    booking: Transaction, account: Account, line: str, tax_amount: Decimal | None
) -> Decimal:
    """The tax amount a mark of `line` on this booking takes, or why it may not have one.

    No amount means the whole booking, except on the shared account, where
    only the owner's share counts and only the owner knows it, and on a §35a
    line, where only the labour counts and the invoice says how much that is.
    """
    if booking.transfer_group is not None:
        msg = "A move between own accounts is no cost: mark the booking that paid the bill"
        raise MarkRefusedError(msg)
    if line in LABOUR_LINES and account.kind == "cash":
        msg = "§35a counts only what was paid by transfer, never cash"
        raise MarkRefusedError(msg)
    whole = abs(booking.amount)
    if tax_amount is None:
        if account.shared:
            msg = "A booking on the shared account needs its tax amount: your share of it"
            raise MarkRefusedError(msg)
        if line in LABOUR_LINES:
            msg = "§35a counts the labour only: give the labour share as the tax amount"
            raise MarkRefusedError(msg)
        return whole
    if tax_amount > whole:
        msg = f"The tax amount {tax_amount} is more than the booking's {whole}"
        raise MarkRefusedError(msg)
    return tax_amount


async def set_mark(  # noqa: PLR0913  each field of the mark is its own argument
    session: AsyncSession,
    transaction_id: int,
    line: str,
    tax_amount: Decimal | None,
    *,
    receipt_needed: bool = True,
    note: str | None = None,
) -> TaxMark:
    """Mark the booking, or change its mark, after the money rules in `check_mark`."""
    paid, account = await booking(session, transaction_id)
    amount = check_mark(paid, account, line, tax_amount)
    mark = await mark_of(session, transaction_id)
    if mark is None:
        mark = TaxMark(transaction_id=transaction_id)
        session.add(mark)
    mark.form_line = line
    mark.tax_amount = amount
    mark.receipt_needed = receipt_needed
    mark.note = note
    await session.flush()
    return mark


async def delete_mark(session: AsyncSession, transaction_id: int) -> bool:
    """Take the booking's mark away; False when it had none."""
    mark = await mark_of(session, transaction_id)
    if mark is None:
        return False
    await session.delete(mark)
    await session.flush()
    return True


def receipt_status(mark: TaxMark, receipts: int) -> str:
    """`attached` when a receipt names the booking, else `not_needed` or `missing`."""
    if receipts:
        return "attached"
    return "missing" if mark.receipt_needed else "not_needed"


@dataclass(frozen=True)
class Entry:
    """One marked booking of the year, as the lines, the lists and the exports show it."""

    transaction_id: int
    booking_date: dt.date
    payee: str
    purpose: str | None
    amount: Decimal
    tax_amount: Decimal
    counted: Decimal
    form_line: str
    receipt_status: str
    receipt_ids: list[int]
    shared: bool
    note: str | None


def _year(year: int) -> Any:
    return Transaction.booking_date.between(dt.date(year, 1, 1), dt.date(year, 12, 31))


def payee_of(booking: Transaction) -> str:
    """The name a booking shows: its payee, else the counterparty, else its purpose."""
    if booking.payee is not None:
        return booking.payee.name
    return booking.counterparty_name or booking.purpose or "Unknown"


async def entries(session: AsyncSession, year: int) -> list[Entry]:
    """Every marked booking paid in `year`, oldest first."""
    rows = (
        await session.execute(
            select(TaxMark, Transaction, Account)
            .join(Transaction, Transaction.id == TaxMark.transaction_id)
            .join(Account, Account.id == Transaction.account_id)
            .where(_year(year))
            .options(selectinload(Transaction.payee))
            .order_by(Transaction.booking_date, Transaction.id)
        )
    ).all()
    ids = [booking.id for _, booking, _ in rows]
    receipts: dict[int, list[int]] = {}
    for receipt_id, transaction_id in await session.execute(
        select(Receipt.id, Receipt.transaction_id)
        .where(Receipt.transaction_id.in_(ids))
        .order_by(Receipt.id)
    ):
        receipts.setdefault(transaction_id, []).append(receipt_id)
    return [
        Entry(
            transaction_id=booking.id,
            booking_date=booking.booking_date,
            payee=payee_of(booking),
            purpose=booking.purpose,
            amount=booking.amount,
            tax_amount=mark.tax_amount,
            counted=mark.tax_amount if booking.amount < 0 else -mark.tax_amount,
            form_line=mark.form_line,
            receipt_status=receipt_status(mark, len(receipts.get(booking.id, []))),
            receipt_ids=receipts.get(booking.id, []),
            shared=account.shared,
            note=mark.note,
        )
        for mark, booking, account in rows
    ]


async def money_back(session: AsyncSession, year: int) -> list[Transaction]:
    """Money in of the year with no mark that looks like a marked cost paid back.

    Either the refund of an order a marked booking paid, or money in sorted
    into an ignore category that also holds a marked cost of the year, the
    way a work hotel and its reimbursement share one. Shown, never counted:
    the owner marks it on the cost's line or leaves it.
    """
    marked = select(TaxMark.transaction_id)
    paid = aliased(OrderCharge)
    refunded = exists().where(
        OrderCharge.transaction_id == Transaction.id,
        OrderCharge.kind == "refund",
        exists().where(
            paid.order_id == OrderCharge.order_id,
            paid.transaction_id.in_(marked),
        ),
    )
    cost = aliased(Transaction)
    ignored = and_(
        Category.kind == "ignore",
        exists().where(
            cost.category_id == Transaction.category_id,
            cost.amount < 0,
            cost.id.in_(marked),
            cost.booking_date.between(dt.date(year, 1, 1), dt.date(year, 12, 31)),
        ),
    )
    found = await session.scalars(
        select(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(
            _year(year),
            Transaction.amount > 0,
            Transaction.transfer_group.is_(None),
            Transaction.id.not_in(marked),
            refunded | ignored,
        )
        .options(selectinload(Transaction.payee))
        .order_by(Transaction.booking_date, Transaction.id)
    )
    return list(found)


@dataclass(frozen=True)
class Line:
    """One line's year: what counts on it, how many bookings, how many receipts are missing."""

    form_line: str
    label: str
    total: Decimal
    bookings: int
    missing: int


@dataclass(frozen=True)
class Year:
    """The tax year: every line, the Werbungskosten over the allowance, and what to look at."""

    year: int
    lines: list[Line]
    allowance: Decimal
    werbungskosten_over: Decimal
    entries: list[Entry]
    money_back: list[Transaction]


async def year_summary(session: AsyncSession, year: int) -> Year:
    """Totals per line for bookings paid in `year`, and the lists the Tax tab shows."""
    found = await entries(session, year)
    lines = []
    for line in FORM_LINES:
        mine = [entry for entry in found if entry.form_line == line]
        lines.append(
            Line(
                form_line=line,
                label=LINES[line],
                total=sum((entry.counted for entry in mine), ZERO),
                bookings=len(mine),
                missing=sum(1 for entry in mine if entry.receipt_status == "missing"),
            )
        )
    werbungskosten = lines[FORM_LINES.index("werbungskosten")].total
    return Year(
        year=year,
        lines=lines,
        allowance=allowance(year),
        werbungskosten_over=max(ZERO, werbungskosten - allowance(year)),
        entries=found,
        money_back=await money_back(session, year),
    )
