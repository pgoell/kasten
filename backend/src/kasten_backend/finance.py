"""What the finance routes do to the tables: upsert, ingest, link transfers, split.

Kasten stores and shows; jobs on the host gather (the bank sync, the order
mails, the receipt reader) and write through the routes in `routes/finance.py`.
So every write here is safe to repeat: a job that runs twice changes nothing.
Nothing here commits. The route that calls it does, once per request.
"""

import uuid
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, selectinload

from kasten_backend.finance_models import Account, BalanceSnapshot, Transaction, TransactionSplit

if TYPE_CHECKING:
    from collections.abc import Iterable
    from datetime import date

    from sqlalchemy.ext.asyncio import AsyncSession

TRANSFER_WINDOW_DAYS = 5
"""How far apart the two halves of a move between own accounts may be booked.

An instant transfer lands the same day; an ordinary one sent on a Friday is
booked on the other side on Monday or Tuesday. Wider than that and two
unrelated bookings of a round amount start to pair.
"""


class UnknownAccountError(LookupError):
    """A row names an account id the table does not hold."""

    def __init__(self, ids: Iterable[int]) -> None:
        """Name every missing id, so a job can fix its whole batch at once."""
        super().__init__(f"No account with id {', '.join(str(i) for i in sorted(ids))}")


class TakenIbanError(ValueError):
    """An upsert gives an account an IBAN another account already holds."""


class SplitSumError(ValueError):
    """The splits of a booking do not add up to its amount."""

    def __init__(self, total: Decimal, amount: Decimal) -> None:
        """Say both sums, which is what the sender needs to find its mistake."""
        super().__init__(f"The splits add up to {total}, the booking is {amount}")


async def _check_accounts(session: AsyncSession, ids: set[int]) -> None:
    """Refuse a batch naming an account that is not there, before anything is written."""
    found = set(await session.scalars(select(Account.id).where(Account.id.in_(ids))))
    if missing := ids - found:
        raise UnknownAccountError(missing)


async def upsert_account(session: AsyncSession, fields: dict[str, Any]) -> Account:
    """Make the account by its name, or bring the one with that name up to date."""
    statement = (
        insert(Account)
        .values(**fields)
        .on_conflict_do_update(index_elements=[Account.name], set_=fields)
        .returning(Account)
    )
    try:
        return (await session.scalars(statement)).one()
    except IntegrityError as error:
        # The name is the conflict the upsert handles, so the other unique
        # column is the only way here.
        msg = f"Another account holds the IBAN {fields.get('iban')}"
        raise TakenIbanError(msg) from error


async def store_balances(session: AsyncSession, rows: list[dict[str, Any]]) -> int:
    """Keep each balance the bank reported, the latest report for a day winning.

    A second pull on the same day sees bookings the first did not, so its
    balance is the truer one, and the earlier figure is replaced.
    """
    if not rows:
        return 0
    await _check_accounts(session, {row["account_id"] for row in rows})
    statement = insert(BalanceSnapshot).values(rows)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=[BalanceSnapshot.account_id, BalanceSnapshot.date],
            set_={"amount": statement.excluded.amount},
        )
    )
    return len(rows)


async def insert_transactions(session: AsyncSession, rows: list[dict[str, Any]]) -> int:
    """Insert the bookings the table does not hold yet, and say how many that was.

    A booking already there by its account and source key is left exactly as
    it is, so a window that overlaps the last one costs nothing.
    """
    if not rows:
        return 0
    await _check_accounts(session, {row["account_id"] for row in rows})
    statement = (
        insert(Transaction)
        .values(rows)
        .on_conflict_do_nothing(constraint="transaction_account_source_key")
        .returning(Transaction.id)
    )
    return len((await session.scalars(statement)).all())


async def link_transfers(session: AsyncSession) -> int:
    """Give each move between two own accounts one shared transfer group, and count the pairs.

    A booking pairs with one on the account whose IBAN is its counterparty
    IBAN, of the opposite amount, booked within `TRANSFER_WINDOW_DAYS`. Only
    the bookings not yet linked are read, the whole table and not one batch,
    since the two halves often arrive in different pulls. Run twice, the second
    run finds nothing to do.
    """
    out, into, target = aliased(Transaction), aliased(Transaction), aliased(Account)
    gap = func.abs(out.booking_date - into.booking_date)
    candidates = await session.execute(
        select(out.id, into.id)
        .join(target, target.iban == out.counterparty_iban)
        .join(
            into,
            and_(
                into.account_id == target.id,
                into.account_id != out.account_id,
                into.amount == -out.amount,
                into.transfer_group.is_(None),
            ),
        )
        .where(out.transfer_group.is_(None), out.amount != 0, gap <= TRANSFER_WINDOW_DAYS)
        # Nearest first, so of two candidates the closer one wins, and the rest
        # by date and id so the same rows always pair the same way.
        .order_by(gap, out.booking_date, out.id, into.id)
    )
    # When both halves name the other's IBAN the pair is found from each side,
    # and a booking may be a candidate for several; each is used once.
    used: set[int] = set()
    pairs = 0
    for first, second in candidates.tuples():
        if first in used or second in used:
            continue
        used.update((first, second))
        await session.execute(
            update(Transaction)
            .where(Transaction.id.in_((first, second)))
            .values(transfer_group=uuid.uuid4())
        )
        pairs += 1
    return pairs


async def list_accounts(session: AsyncSession) -> list[Account]:
    """Every account, by name."""
    return list(await session.scalars(select(Account).order_by(Account.name)))


async def list_transactions(
    session: AsyncSession, account: int | None, first: date | None, last: date | None
) -> list[Transaction]:
    """The bookings that match, oldest first, each with its splits."""
    statement = select(Transaction).options(selectinload(Transaction.splits))
    if account is not None:
        statement = statement.where(Transaction.account_id == account)
    if first is not None:
        statement = statement.where(Transaction.booking_date >= first)
    if last is not None:
        statement = statement.where(Transaction.booking_date <= last)
    return list(await session.scalars(statement.order_by(Transaction.booking_date, Transaction.id)))


async def replace_splits(
    session: AsyncSession, transaction_id: int, parts: list[dict[str, Any]]
) -> Transaction | None:
    """Put `parts` in place of the booking's splits, or None for no such booking.

    The parts must add up to the booking's amount, or nothing is written: the
    splits are what a budget counts in place of the booking, and a set that
    does not add up would count money twice or not at all. An empty list
    removes the splits, and the booking counts whole again.
    """
    booking = await session.scalar(
        select(Transaction)
        .options(selectinload(Transaction.splits))
        .where(Transaction.id == transaction_id)
    )
    if booking is None:
        return None
    total = sum((part["amount"] for part in parts), Decimal(0))
    if parts and total != booking.amount:
        raise SplitSumError(total, booking.amount)
    booking.splits = [TransactionSplit(**part) for part in parts]
    await session.flush()
    return booking
