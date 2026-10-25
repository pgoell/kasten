"""The finance routes: what the host jobs write through, and what the browser and agents read.

Under `/api/finance/`, behind the same gate as every other `/api/` route and
with no lock of their own. Agents read everything (decided 2026-10-25), and a
job on the host reaches the backend over the docker network, inside the trust
zone docs/explanation/security-model.md describes. The routes connect to
Postgres when they are asked, never at startup, so a backend without a
database runs everything else and answers these with a 503 (`db.get_session`).
"""

import uuid  # noqa: TC003  pydantic reads the annotation at runtime
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import finance, finance_sorting
from kasten_backend.db import get_session
from kasten_backend.finance_models import Kind  # noqa: TC001  pydantic reads it at runtime
from kasten_backend.log import DATE_PATTERN

router = APIRouter(prefix="/api/finance")

Session = Annotated[AsyncSession, Depends(get_session)]

Money = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
"""Euros and cents, signed, as `numeric(14,2)` holds them. JSON sends it as a string."""


def _spelled_as_stored(iban: str | None) -> str | None:
    """An IBAN without its spaces and in capitals, or None for an empty one.

    Banks print it in groups of four and jobs pass it on as they got it, and
    transfer linking compares IBANs as text.
    """
    if iban is None:
        return None
    return "".join(iban.split()).upper() or None


Iban = Annotated[str | None, AfterValidator(_spelled_as_stored)]

MAX_BATCH = 1000
"""The most bookings or balances one post may carry.

One insert binds thirteen values a booking, and Postgres takes 65,535 binds a
statement, so this keeps a batch well inside one statement. A first import
sends its history in several posts.
"""

PAGE = 500
"""How many bookings a read answers with when it names no `limit`."""

MAX_PAGE = 5000
"""The most bookings one read answers with."""


class AccountOut(BaseModel):
    """An account as stored, with the id bookings and balances name it by."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    bank: str | None
    iban: str | None
    kind: str
    shared: bool


class AccountIn(BaseModel):
    """An account as a job sends it. The name is the key it is upserted by."""

    name: Annotated[str, Field(min_length=1)]
    bank: str | None = None
    iban: Iban = None
    kind: Kind
    shared: bool = False


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
    counterparty_iban: Iban = None
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


class SplitOut(BaseModel):
    """One part of a booking as stored."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: Decimal
    text: str | None
    category_id: int | None
    category_set_by: str | None


class TransactionOut(BaseModel):
    """A booking as stored, with when it came in, its transfer group and its splits.

    Its own model rather than the input's: a stored row is answered as it is,
    and the rules a job's post is held to are no reason to fail a read.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    purpose: str | None
    posting_text: str | None
    counterparty_name: str | None
    counterparty_iban: str | None
    bank_ref: str | None
    raw: dict[str, Any] | None
    source_key: str
    imported_at: datetime
    transfer_group: uuid.UUID | None
    payee_id: int | None
    category_id: int | None
    category_set_by: str | None
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
    """Make the account by its name, or update the fields the post names on the one with that name.

    A 200 either way, and the row with its id, so a job can upsert its
    accounts on every run and post bookings by the ids it gets back.
    """
    try:
        stored = await finance.upsert_account(
            session, account.model_dump(), account.model_dump(exclude_unset=True)
        )
    except finance.TakenIbanError as taken:
        raise HTTPException(status_code=409, detail=str(taken)) from taken
    await session.commit()
    return AccountOut.model_validate(stored)


@router.post("/balances")
async def write_balances(
    balances: Annotated[list[BalanceIn], Body(max_length=MAX_BATCH)], session: Session
) -> Stored:
    """Store balances as the bank reported them, the latest for a day replacing an earlier one."""
    try:
        stored = await finance.store_balances(session, [b.model_dump() for b in balances])
    except finance.UnknownAccountError as unknown:
        raise HTTPException(status_code=422, detail=str(unknown)) from unknown
    await session.commit()
    return Stored(stored=stored)


def _month_range(month: str) -> tuple[date, date]:
    """The first and last day of a `YYYY-MM` month."""
    try:
        first = date.fromisoformat(f"{month}-01")
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`month` must be a real month") from error
    return first, date(first.year, first.month, monthrange(first.year, first.month)[1])


@router.get("/transactions")
async def read_transactions(  # noqa: PLR0913  each query parameter is its own argument
    session: Session,
    *,
    account: int | None = None,
    start: Annotated[str | None, Query(alias="from", pattern=DATE_PATTERN)] = None,
    end: Annotated[str | None, Query(alias="to", pattern=DATE_PATTERN)] = None,
    month: Annotated[str | None, Query(pattern=r"^[0-9]{4}-[0-9]{2}$")] = None,
    category: int | None = None,
    text: str | None = None,
    order: Literal["asc", "desc"] = "asc",
    after: int | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = PAGE,
) -> list[TransactionOut]:
    """A page of the bookings that pass the filters, oldest first unless `order` is `desc`.

    `month` stands for a `from` and `to` around one month, so the two cannot
    come together. `after` is the id of the last booking of the page before.
    A page shorter than `limit` is the last.
    """
    if month is not None and (start is not None or end is not None):
        raise HTTPException(status_code=400, detail="`month` comes without `from` and `to`")
    first, last = _month_range(month) if month is not None else (_day(start), _day(end))
    if first is not None and last is not None and first > last:
        raise HTTPException(status_code=400, detail="`from` is after `to`")
    filters = finance.Filters(account, first, last, category, text)
    found = await finance.list_transactions(
        session, filters, after=after, limit=limit, newest_first=order == "desc"
    )
    return [TransactionOut.model_validate(booking) for booking in found]


@router.post("/transactions")
async def write_transactions(
    bookings: Annotated[list[TransactionIn], Body(max_length=MAX_BATCH)], session: Session
) -> Ingested:
    """Insert the bookings not already stored, pair the transfers, then sort the new ones.

    A booking already there by account and source key is skipped and left as
    it was, so a job may send an overlapping window every run. The new
    bookings get their payees and the rules' categories after the transfers
    are paired, since a transfer takes no category.
    """
    # First, so the sorting after the insert and a run of the rules beside it
    # take turns rather than wait on each other's rows.
    await finance_sorting.lock(session)
    try:
        created = await finance.insert_transactions(session, [b.model_dump() for b in bookings])
    except (finance.UnknownAccountError, finance.KeyClashError) as refused:
        raise HTTPException(status_code=422, detail=str(refused)) from refused
    linked = await finance.link_transfers(session)
    await finance_sorting.assign_payees(session, created)
    await finance_sorting.apply_rules(session, created)
    await session.commit()
    return Ingested(created=len(created), skipped=len(bookings) - len(created), linked=linked)


@router.put("/transactions/{transaction_id}/splits")
async def write_splits(
    transaction_id: int, parts: list[SplitIn], session: Session
) -> TransactionOut:
    """Replace the booking's splits, refusing a set that does not add up to its amount."""
    await finance_sorting.lock(session)
    try:
        booking = await finance.replace_splits(
            session, transaction_id, [part.model_dump() for part in parts]
        )
    except finance.SplitSumError as uneven:
        raise HTTPException(status_code=422, detail=str(uneven)) from uneven
    if booking is None:
        raise HTTPException(status_code=404, detail="No such transaction")
    # The new splits are sorted at once, and the booking itself gives up a
    # category a rule gave it, since its category now lives on them.
    await finance_sorting.apply_rules(session, [transaction_id])
    await session.commit()
    return TransactionOut.model_validate(await finance_sorting.reread(session, transaction_id))
