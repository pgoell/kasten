"""The receipt routes: keep a file, share one from the phone, read it, sort it, serve it back.

Receipts live in `settings.receipts_path`, never in the vault. Kasten links or marks
nothing until `confirm`.
"""

import datetime as dt
from decimal import Decimal  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field

from kasten_backend import db, finance, finance_tax
from kasten_backend import finance_receipts as receipts
from kasten_backend.config import Settings, get_settings
from kasten_backend.finance_tax_models import (
    FormLine,
    Receipt,
    ReceiptSource,
)
from kasten_backend.routes.finance import Money, Session  # noqa: TC001  read at runtime

router = APIRouter(prefix="/api/finance/receipts")

SettingsDep = Annotated[Settings, Depends(get_settings)]


class ReceiptOut(BaseModel):
    """A receipt as kept: its file, where it came from, its booking and what the reader read."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    sha256: str
    media_type: str
    size: int
    name: str | None
    source: str
    received_at: dt.datetime
    transaction_id: int | None
    dismissed: bool
    read_at: dt.datetime | None
    read_error: str | None
    read_date: dt.date | None
    read_amount: Decimal | None
    read_payee: str | None
    read_labour: Decimal | None
    read_line: str | None


class StoredOut(BaseModel):
    """The receipt, and whether this send made it (false: the same file was already kept)."""

    receipt: ReceiptOut
    created: bool


class CandidateOut(BaseModel):
    """A booking the receipt may have paid, and the tax amount a mark on it would take."""

    transaction_id: int
    booking_date: dt.date
    amount: Decimal
    payee: str
    purpose: str | None
    tax_amount: Decimal | None
    # On the shared account `tax_amount` is null: only the owner knows their share.
    shared: bool


class ToSortOut(BaseModel):
    """A receipt on no booking, the bookings it may have paid, best first, and the line read."""

    receipt: ReceiptOut
    candidates: list[CandidateOut]
    form_line: str | None


class ReadingIn(BaseModel):
    """What the receipt reader found, or why it found nothing."""

    date: dt.date | None = None
    amount: Annotated[Money, Field(gt=0)] | None = None
    payee: Annotated[str, Field(max_length=200)] | None = None
    labour: Annotated[Money, Field(ge=0)] | None = None
    form_line: FormLine | None = None
    error: Annotated[str, Field(max_length=500)] | None = None


class ReceiptPatch(BaseModel):
    """Link the receipt to a booking, take it off one with null, or put it aside."""

    transaction_id: int | None = None
    dismissed: bool | None = None


class ConfirmIn(BaseModel):
    """The booking the receipt paid and, with a line, the mark to set on it."""

    transaction_id: int
    form_line: FormLine | None = None
    tax_amount: Annotated[Money, Field(gt=0)] | None = None
    receipt_needed: bool = True
    note: Annotated[str, Field(max_length=500)] | None = None
    # True to replace a mark the booking already has; else that is a 409.
    replace: bool = False


def conflict(code: str, message: str) -> HTTPException:
    """A 409 whose `detail` names the conflict, so the pane can tell them apart.

    `receipt_linked`: the receipt is on another booking. `mark_exists`: a confirm would
    replace the booking's mark.
    """
    return HTTPException(status_code=409, detail={"code": code, "message": message})


async def _get(session: Session, receipt_id: int) -> Receipt:
    receipt = await session.get(Receipt, receipt_id)
    if receipt is None or receipt.deleted:
        raise HTTPException(status_code=404, detail="No such receipt")
    return receipt


async def _keep(
    session: Session,
    settings: Settings,
    file: UploadFile,
    source: str,
    transaction_id: int | None = None,
) -> receipts.Stored:
    # One byte over the cap is enough to refuse it, without reading the rest.
    data = await file.read(receipts.MAX_BYTES + 1)
    try:
        return await receipts.store(
            session,
            settings.receipts_path,
            data,
            name=file.filename,
            source=source,
            transaction_id=transaction_id,
        )
    except receipts.ReceiptRefusedError as refused:
        raise HTTPException(status_code=422, detail=str(refused)) from refused
    except receipts.ReceiptTakenError as taken:
        raise conflict("receipt_linked", str(taken)) from taken


@router.post("")
async def write_receipt(
    session: Session,
    settings: SettingsDep,
    file: Annotated[UploadFile, File()],
    transaction_id: Annotated[int | None, Form()] = None,
    source: Annotated[ReceiptSource, Form()] = "upload",
) -> StoredOut:
    """Keep a PDF, JPEG or PNG of up to 20 MB, on the booking named or on none.

    The same file again answers the receipt already kept, `created` false,
    and links it when it was on no booking; on another booking it is a 409.
    """
    stored = await _keep(session, settings, file, source, transaction_id)
    await session.commit()
    return StoredOut(receipt=ReceiptOut.model_validate(stored.receipt), created=stored.created)


@router.post("/share")
async def share(
    settings: SettingsDep,
    title: Annotated[str | None, Form()] = None,
    text: Annotated[str | None, Form()] = None,
    url: Annotated[str | None, Form()] = None,
    files: Annotated[list[UploadFile], File(alias="receipts")] = [],  # noqa: B006  FastAPI copies it
) -> RedirectResponse:
    """What the phone's share sheet posts: keep the files as receipts, then open `/capture`.

    The manifest's `share_target` sends here. The files go to the receipt
    queue, on no booking; the title, text and address go on to `/capture` as
    a plain share would, with how many receipts were kept and refused. A
    share of text alone opens no database, so it works on a backend with none.
    """
    kept = refused = 0
    if files:
        try:
            # A dependency would open a session for a share of text alone too.
            async with db.session() as session:
                for file in files[: receipts.MAX_SHARED]:
                    try:
                        await _keep(session, settings, file, "capture")
                    except HTTPException as refusal:
                        if refusal.status_code == 503:  # noqa: PLR2004  no database
                            raise
                        refused += 1
                        continue
                    kept += 1
                await session.commit()
        except HTTPException:
            kept, refused = 0, len(files)
        refused += max(0, len(files) - receipts.MAX_SHARED)
    fields = (("title", title), ("text", text), ("url", url))
    params = {key: value for key, value in fields if value}
    if files:
        params |= {"receipts": str(kept), "refused": str(refused)}
    # 303, so the browser opens the page with a GET.
    return RedirectResponse(f"/capture?{urlencode(params)}", status_code=303)


@router.get("")
async def read_receipts(
    session: Session,
    state: Annotated[str, Query(pattern="^unread$")] = "unread",
    after: int | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ReceiptOut]:
    """The receipts the reader has not done yet, oldest first, past the id `after`.

    `unread` is the one `state` there is. A receipt the reader could not get
    an answer for stays unread, so `after` lets it page on past one.
    """
    del state
    found = await receipts.unread(session, after, limit)
    return [ReceiptOut.model_validate(receipt) for receipt in found]


@router.delete("/{receipt_id}/reading", status_code=204)
async def delete_reading(receipt_id: int, session: Session) -> Response:
    """Forget what the reader found, so it reads the receipt again on its next run."""
    receipt = await _get(session, receipt_id)
    receipt.read_at = receipt.read_error = receipt.read_date = receipt.read_payee = None
    receipt.read_amount = receipt.read_labour = None
    receipt.read_line = None
    await session.commit()
    return Response(status_code=204)


@router.get("/to-sort")
async def read_to_sort(session: Session) -> list[ToSortOut]:
    """Every receipt on no booking and not put aside, with the bookings it may have paid."""
    found = []
    shared = {account.id: account.shared for account in await finance.list_accounts(session)}
    for receipt in await receipts.to_sort(session):
        candidates = await receipts.candidates(session, receipt)
        found.append(
            ToSortOut(
                receipt=ReceiptOut.model_validate(receipt),
                form_line=receipt.read_line,
                candidates=[
                    CandidateOut(
                        transaction_id=booking.id,
                        booking_date=booking.booking_date,
                        amount=booking.amount,
                        payee=finance_tax.payee_of(booking),
                        purpose=booking.purpose,
                        tax_amount=receipts.proposed_amount(
                            receipt, booking, shared=shared[booking.account_id]
                        ),
                        shared=shared[booking.account_id],
                    )
                    for booking in candidates
                ],
            )
        )
    return found


@router.get("/{receipt_id}/file")
async def read_file(receipt_id: int, session: Session, settings: SettingsDep) -> FileResponse:
    """The receipt's file, as its type, to show in the browser."""
    receipt = await _get(session, receipt_id)
    path = settings.receipts_path / receipt.path
    if receipt.deleted or not path.is_file():
        raise HTTPException(status_code=404, detail="The receipt's file is gone")
    return FileResponse(
        path,
        media_type=receipt.media_type,
        content_disposition_type="inline",
        filename=receipt.name or path.name,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.put("/{receipt_id}/reading")
async def write_reading(receipt_id: int, reading: ReadingIn, session: Session) -> ReceiptOut:
    """Store what the reader found. It replaces an earlier reading; it links and marks nothing."""
    receipt = await _get(session, receipt_id)
    receipt.read_at = dt.datetime.now(dt.UTC)
    receipt.read_error = reading.error
    receipt.read_date = reading.date
    receipt.read_amount = reading.amount
    receipt.read_payee = reading.payee
    receipt.read_labour = reading.labour
    receipt.read_line = reading.form_line
    await session.commit()
    return ReceiptOut.model_validate(receipt)


@router.patch("/{receipt_id}")
async def write_receipt_fields(
    receipt_id: int, patch: ReceiptPatch, session: Session
) -> ReceiptOut:
    """Link the receipt to a booking, take it off with `transaction_id` null, or put it aside."""
    receipt = await _get(session, receipt_id)
    sent = patch.model_dump(exclude_unset=True)
    if "transaction_id" in sent:
        if patch.transaction_id is None:
            receipt.transaction_id = None
        else:
            await _link(session, receipt, patch.transaction_id)
    if patch.dismissed is not None:
        receipt.dismissed = patch.dismissed
    await session.commit()
    return ReceiptOut.model_validate(receipt)


async def _link(session: Session, receipt: Receipt, transaction_id: int) -> None:
    try:
        await finance_tax.booking(session, transaction_id)
        await receipts.link(session, receipt, transaction_id)
    except finance_tax.NoBookingError as missing:
        raise HTTPException(status_code=404, detail="No such transaction") from missing
    except receipts.ReceiptTakenError as taken:
        raise conflict("receipt_linked", str(taken)) from taken


@router.post("/{receipt_id}/confirm")
async def confirm(receipt_id: int, body: ConfirmIn, session: Session) -> ReceiptOut:
    """Put the receipt on the booking and, with a line, mark the booking; all or nothing.

    Every rule is checked before anything is written, so a refusal leaves the
    receipt in the queue as it was.
    """
    receipt = await _get(session, receipt_id)
    try:
        paid, account = await finance_tax.booking(session, body.transaction_id)
        if body.form_line is not None:
            finance_tax.check_mark(paid, account, body.form_line, body.tax_amount)
            held = await finance_tax.mark_of(session, body.transaction_id)
            if held is not None and not body.replace:
                raise conflict(
                    "mark_exists",
                    f"The booking is already marked {held.tax_amount} on {held.form_line};"
                    " confirm again to replace that mark",
                )
        await receipts.link(session, receipt, body.transaction_id)
        if body.form_line is not None:
            await finance_tax.set_mark(
                session,
                body.transaction_id,
                body.form_line,
                body.tax_amount,
                receipt_needed=body.receipt_needed,
                note=body.note,
            )
    except finance_tax.NoBookingError as missing:
        raise HTTPException(status_code=404, detail="No such transaction") from missing
    except receipts.ReceiptTakenError as taken:
        raise conflict("receipt_linked", str(taken)) from taken
    except finance_tax.MarkRefusedError as refused:
        raise HTTPException(status_code=422, detail=str(refused)) from refused
    await session.commit()
    return ReceiptOut.model_validate(receipt)


@router.delete("/{receipt_id}", status_code=204)
async def delete_receipt(receipt_id: int, session: Session, settings: SettingsDep) -> Response:
    """Delete the receipt's file; its hash stays, so the mail job does not bring it back."""
    path = await receipts.remove(session, await _get(session, receipt_id))
    # After the commit, so a delete that fails to commit leaves the file.
    await session.commit()
    (settings.receipts_path / path).unlink(missing_ok=True)
    return Response(status_code=204)
