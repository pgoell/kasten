"""The finance routes: what the host jobs write through, and what the browser and agents read.

Under `/api/finance/`, behind the same gate as every other `/api/` route and
with no lock of their own. Agents read everything (decided 2026-10-25), and a
job on the host reaches the backend over the docker network, inside the trust
zone docs/explanation/security-model.md describes. The routes connect to
Postgres when they are asked, never at startup, so a backend without a
database runs everything else and answers these with a 503.
"""

import logging
import uuid  # noqa: TC003  pydantic reads the annotation at runtime
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import finance
from kasten_backend.db import get_session
from kasten_backend.finance_models import Kind  # noqa: TC001  pydantic reads it at runtime
from kasten_backend.log import DATE_PATTERN

if TYPE_CHECKING:
    from fastapi import Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/finance")

Session = Annotated[AsyncSession, Depends(get_session)]

Money = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
"""Euros and cents, signed, as `numeric(14,2)` holds them. JSON sends it as a string."""

MAX_BATCH = 1000
"""The most bookings one post may carry.

One insert binds thirteen values a booking, and Postgres takes 65,535 binds a
statement, so this keeps a batch well inside one statement. A first import
sends its history in several posts.
"""


async def no_database(_request: Request, error: Exception) -> JSONResponse:
    """Answer 503 when Postgres cannot be reached, with the setting that names it.

    The only routes that touch the database are these, so a self-host stack
    with no Postgres sees this here and nowhere else.
    """
    # The driver's own words name the host and port, never the password.
    logger.warning("No database for finance: %s", error)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "No database answers at KASTEN_DATABASE_URL, and finance keeps its "
            "records there. See docs/reference/configuration.md."
        },
    )


class AccountIn(BaseModel):
    """An account as a job sends it. The name is the key it is upserted by."""

    name: Annotated[str, Field(min_length=1)]
    bank: str | None = None
    iban: str | None = None
    kind: Kind
    shared: bool = False


class AccountOut(AccountIn):
    """An account as stored, with the id bookings and balances name it by."""

    model_config = ConfigDict(from_attributes=True)

    id: int


class BalanceIn(BaseModel):
    """The balance the bank reported for one account on one day."""

    account_id: int
    date: date
    amount: Money


class Stored(BaseModel):
    """How many balances a post stored, new or replacing a figure for the same day."""

    stored: int


class TransactionIn(BaseModel):
    """One booking as a job sends it.

    `source_key` is the job's own name for the booking, unique per account. It
    carries an occurrence index, so two identical bookings on one day are two
    keys.
    """

    account_id: int
    booking_date: date
    value_date: date | None = None
    amount: Money
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] = "EUR"
    purpose: str | None = None
    posting_text: str | None = None
    counterparty_name: str | None = None
    counterparty_iban: str | None = None
    bank_ref: str | None = None
    raw: dict[str, Any] | None = None
    source_key: Annotated[str, Field(min_length=1)]


class Ingested(BaseModel):
    """What a batch of bookings did: new rows, rows already there, and transfers paired."""

    created: int
    skipped: int
    linked: int


class SplitIn(BaseModel):
    """One part of a booking."""

    amount: Money
    text: str | None = None


class SplitOut(SplitIn):
    """One part of a booking as stored."""

    model_config = ConfigDict(from_attributes=True)

    id: int


class TransactionOut(TransactionIn):
    """A booking as stored, with when it came in, its transfer group and its splits."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    imported_at: datetime
    transfer_group: uuid.UUID | None
    splits: list[SplitOut]


def _day(text: str | None) -> date | None:
    """A `from` or `to` read as a day, refusing a shape that names none."""
    if text is None:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`from` and `to` must be real dates") from error


@router.get("/accounts")
async def read_accounts(session: Session) -> list[AccountOut]:
    """Every account, by name."""
    return [AccountOut.model_validate(account) for account in await finance.list_accounts(session)]


@router.post("/accounts")
async def write_account(account: AccountIn, session: Session) -> AccountOut:
    """Make the account by its name, or update the one with that name.

    A 200 either way, and the row with its id, so a job can upsert its
    accounts on every run and post bookings by the ids it gets back.
    """
    try:
        stored = await finance.upsert_account(session, account.model_dump())
    except finance.TakenIbanError as taken:
        raise HTTPException(status_code=409, detail=str(taken)) from taken
    await session.commit()
    return AccountOut.model_validate(stored)


@router.post("/balances")
async def write_balances(balances: list[BalanceIn], session: Session) -> Stored:
    """Store balances as the bank reported them, the latest for a day replacing an earlier one."""
    try:
        stored = await finance.store_balances(session, [b.model_dump() for b in balances])
    except finance.UnknownAccountError as unknown:
        raise HTTPException(status_code=422, detail=str(unknown)) from unknown
    await session.commit()
    return Stored(stored=stored)


@router.get("/transactions")
async def read_transactions(
    session: Session,
    account: int | None = None,
    start: Annotated[str | None, Query(alias="from", pattern=DATE_PATTERN)] = None,
    end: Annotated[str | None, Query(alias="to", pattern=DATE_PATTERN)] = None,
) -> list[TransactionOut]:
    """The bookings on one account or all of them, from `from` to `to` by booking date."""
    first, last = _day(start), _day(end)
    if first is not None and last is not None and first > last:
        raise HTTPException(status_code=400, detail="`from` is after `to`")
    found = await finance.list_transactions(session, account, first, last)
    return [TransactionOut.model_validate(booking) for booking in found]


@router.post("/transactions")
async def write_transactions(
    bookings: Annotated[list[TransactionIn], Body(max_length=MAX_BATCH)], session: Session
) -> Ingested:
    """Insert the bookings not already stored, then pair the transfers between own accounts.

    A booking already there by account and source key is skipped and left as
    it was, so a job may send an overlapping window every run.
    """
    try:
        created = await finance.insert_transactions(session, [b.model_dump() for b in bookings])
    except finance.UnknownAccountError as unknown:
        raise HTTPException(status_code=422, detail=str(unknown)) from unknown
    linked = await finance.link_transfers(session)
    await session.commit()
    return Ingested(created=created, skipped=len(bookings) - created, linked=linked)


@router.put("/transactions/{transaction_id}/splits")
async def write_splits(
    transaction_id: int, parts: list[SplitIn], session: Session
) -> TransactionOut:
    """Replace the booking's splits, refusing a set that does not add up to its amount."""
    try:
        booking = await finance.replace_splits(
            session, transaction_id, [part.model_dump() for part in parts]
        )
    except finance.SplitSumError as uneven:
        raise HTTPException(status_code=422, detail=str(uneven)) from uneven
    if booking is None:
        raise HTTPException(status_code=404, detail="No such transaction")
    await session.commit()
    return TransactionOut.model_validate(booking)
