"""The tax routes: a booking's mark, the tax year's totals, and its exports.

The year goes by booking date, the day the money was paid (§11 EStG). The
Tax tab, the exports and the agent's `tax_year_summary` all read
`finance_tax.year_summary`. docs/reference/http-api/finance-tax.md has the
shapes and the money rules.
"""

import datetime as dt  # noqa: TC003  pydantic reads the annotation at runtime
from decimal import Decimal  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from pydantic import BaseModel, ConfigDict, Field

from kasten_backend import finance_receipts, finance_tax, finance_tax_export
from kasten_backend.config import Settings, get_settings
from kasten_backend.finance_tax_models import FormLine  # noqa: TC001  pydantic reads it
from kasten_backend.routes.finance import Money, Session  # noqa: TC001  read at runtime
from kasten_backend.routes.finance_budget import Cents  # noqa: TC001  pydantic reads it
from kasten_backend.routes.finance_receipts import ReceiptOut

router = APIRouter(prefix="/api/finance")

YearPath = Annotated[int, Path(ge=2000, le=2100)]


class MarkIn(BaseModel):
    """A booking's line and the amount that counts there; none means the whole booking."""

    form_line: FormLine
    tax_amount: Annotated[Money, Field(gt=0)] | None = None
    receipt_needed: bool = True
    note: Annotated[str, Field(max_length=500)] | None = None


class MarkOut(BaseModel):
    """A mark as stored, and whether its receipt is attached, missing or not needed."""

    model_config = ConfigDict(from_attributes=True)

    transaction_id: int
    form_line: str
    tax_amount: Decimal
    receipt_needed: bool
    note: str | None
    receipt_status: str


class BookingTaxOut(BaseModel):
    """A booking's mark, or null, and its receipts."""

    mark: MarkOut | None
    receipts: list[ReceiptOut]


class LineOut(BaseModel):
    """One line of the return for the year: what counts, how many bookings, receipts missing."""

    form_line: str
    label: str
    total: Cents
    bookings: int
    missing: int


class EntryOut(BaseModel):
    """A marked booking of the year. `counted` is negative for money in: it comes off the line."""

    model_config = ConfigDict(from_attributes=True)

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


class MoneyBackOut(BaseModel):
    """Money in with no mark that looks like a marked cost paid back: mark it or leave it."""

    transaction_id: int
    booking_date: dt.date
    payee: str
    amount: Decimal


class YearOut(BaseModel):
    """The tax year: totals per line, Werbungskosten over the allowance, and what to look at."""

    year: int
    lines: list[LineOut]
    allowance: Cents
    werbungskosten_over: Cents
    missing: list[EntryOut]
    money_back: list[MoneyBackOut]
    entries: list[EntryOut]


def _not_found(error: finance_tax.NoBookingError) -> HTTPException:
    return HTTPException(status_code=404, detail=f"No transaction {error}")


async def _mark_out(session: Session, transaction_id: int) -> MarkOut | None:
    receipts = await finance_receipts.of_booking(session, transaction_id)
    mark = await finance_tax.mark_of(session, transaction_id)
    if mark is None:
        return None
    return MarkOut(
        transaction_id=mark.transaction_id,
        form_line=mark.form_line,
        tax_amount=mark.tax_amount,
        receipt_needed=mark.receipt_needed,
        note=mark.note,
        receipt_status=finance_tax.receipt_status(mark, len(receipts)),
    )


@router.get("/transactions/{transaction_id}/tax")
async def read_booking_tax(transaction_id: int, session: Session) -> BookingTaxOut:
    """The booking's mark and its receipts, for its drilldown."""
    try:
        await finance_tax.booking(session, transaction_id)
    except finance_tax.NoBookingError as missing:
        raise _not_found(missing) from missing
    receipts = await finance_receipts.of_booking(session, transaction_id)
    return BookingTaxOut(
        mark=await _mark_out(session, transaction_id),
        receipts=[ReceiptOut.model_validate(receipt) for receipt in receipts],
    )


@router.put("/transactions/{transaction_id}/tax-mark")
async def write_mark(transaction_id: int, mark: MarkIn, session: Session) -> MarkOut:
    """Mark the booking, or change its mark. A 422 says which money rule refused it."""
    try:
        await finance_tax.set_mark(
            session,
            transaction_id,
            mark.form_line,
            mark.tax_amount,
            receipt_needed=mark.receipt_needed,
            note=mark.note,
        )
    except finance_tax.NoBookingError as missing:
        raise _not_found(missing) from missing
    except finance_tax.MarkRefusedError as refused:
        raise HTTPException(status_code=422, detail=str(refused)) from refused
    await session.commit()
    stored = await _mark_out(session, transaction_id)
    assert stored is not None  # noqa: S101  set above
    return stored


@router.delete("/transactions/{transaction_id}/tax-mark", status_code=204)
async def delete_mark(transaction_id: int, session: Session) -> Response:
    """Take the booking's mark away. Its receipts stay on it."""
    if not await finance_tax.delete_mark(session, transaction_id):
        raise HTTPException(status_code=404, detail="The booking has no tax mark")
    await session.commit()
    return Response(status_code=204)


def _entry(entry: finance_tax.Entry) -> EntryOut:
    return EntryOut.model_validate(entry)


@router.get("/tax/{year}")
async def read_year(session: Session, year: YearPath) -> YearOut:
    """Totals per line for the bookings paid in `year`, the receipts missing and money back."""
    found = await finance_tax.year_summary(session, year)
    return YearOut(
        year=found.year,
        lines=[LineOut.model_validate(line, from_attributes=True) for line in found.lines],
        allowance=found.allowance,
        werbungskosten_over=found.werbungskosten_over,
        missing=[_entry(e) for e in found.entries if e.receipt_status == "missing"],
        money_back=[
            MoneyBackOut(
                transaction_id=booking.id,
                booking_date=booking.booking_date,
                payee=finance_tax.payee_of(booking),
                amount=booking.amount,
            )
            for booking in found.money_back
        ],
        entries=[_entry(e) for e in found.entries],
    )


@router.get("/tax/{year}/lines/{form_line}.csv")
async def read_line_csv(session: Session, year: YearPath, form_line: FormLine) -> Response:
    """One line's bookings of the year as CSV, naming each receipt as the ZIP does."""
    entries = await finance_tax.entries(session, year)
    body = await finance_tax_export.line_csv(session, entries, form_line)
    return Response(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{year}_{form_line}.csv"'},
    )


@router.get("/tax/{year}/receipts.zip")
async def read_receipts_zip(
    session: Session, year: YearPath, settings: Annotated[Settings, Depends(get_settings)]
) -> Response:
    """Every receipt of the year's marked bookings, named `YYYY-MM-DD_payee_amount`."""
    entries = await finance_tax.entries(session, year)
    body = await finance_tax_export.receipts_zip(session, settings.receipts_path, entries)
    return Response(
        body,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{year}_receipts.zip"'},
    )
