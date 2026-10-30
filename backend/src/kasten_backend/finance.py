"""The finance routes' writes: upsert, ingest, transfer links and splits.

Every write here is safe to repeat. Nothing here commits: the route does, once per request.
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, exists, func, literal, or_, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased, selectinload

from kasten_backend.finance_models import (
    Account,
    BalanceSnapshot,
    Payee,
    Transaction,
    TransactionSplit,
)

if TYPE_CHECKING:
    from collections.abc import Iterable
    from datetime import date

    from sqlalchemy.ext.asyncio import AsyncSession

LINK_LOCK = 0x6B66696E
"""The advisory lock `link_transfers` holds until its transaction ends.

Two batches linking at once would each read the other's halves as unlinked
and pair them twice over, or wait on each other's row locks. With the lock
the second waits, then reads what the first committed.
"""

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


class KeyClashError(ValueError):
    """One batch sends two different bookings under the same account and source key."""

    def __init__(self, key: str) -> None:
        """Name the key, since one of the two would otherwise be dropped unseen."""
        super().__init__(f"Two different bookings carry the source key {key!r}")


class SplitSumError(ValueError):
    """The splits of a booking do not add up to its amount."""

    def __init__(self, total: Decimal, amount: Decimal) -> None:
        """Say both sums, which is what the sender needs to find its mistake."""
        super().__init__(f"The splits add up to {total}, the booking is {amount}")


class TransferSplitError(ValueError):
    """A move between own accounts cannot be split: its parts would count as spending."""

    def __init__(self) -> None:
        """Say why, in words the pane shows."""
        super().__init__(
            "A move between own accounts is no spending and cannot be split into categories"
        )


async def _check_accounts(session: AsyncSession, ids: set[int]) -> None:
    """Refuse a batch naming an account that is not there, before anything is written."""
    found = set(await session.scalars(select(Account.id).where(Account.id.in_(ids))))
    if missing := ids - found:
        raise UnknownAccountError(missing)


async def upsert_account(
    session: AsyncSession, fields: dict[str, Any], sent: dict[str, Any]
) -> Account:
    """Make or update the account by name, changing only the fields `sent` names.

    So a job posting an account by name alone keeps its IBAN and shared flag.
    """
    statement = (
        insert(Account)
        .values(**fields)
        .on_conflict_do_update(index_elements=[Account.name], set_=sent)
        .returning(Account)
    )
    try:
        return (await session.scalars(statement)).one()
    except IntegrityError as error:
        # The name is the conflict the upsert handles, so the other unique column is the only way.
        msg = f"Another account holds the IBAN {fields.get('iban')}"
        raise TakenIbanError(msg) from error


async def store_balances(session: AsyncSession, rows: list[dict[str, Any]]) -> int:
    """Keep each bank balance, the latest pull of a day winning.

    A later pull sees bookings an earlier one did not, so its balance is the truer one.
    """
    # One statement cannot update the same row twice, so two reports for one
    # day in a batch are folded first, the later one winning.
    rows = list({(row["account_id"], row["date"]): row for row in rows}.values())
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


async def insert_transactions(session: AsyncSession, rows: list[dict[str, Any]]) -> list[int]:
    """Insert the bookings not yet held, and return their ids.

    A booking already held by account and source key is left as it is, so a window
    that overlaps the last one costs nothing.
    """
    if not rows:
        return []
    seen: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        known = seen.setdefault((row["account_id"], row["source_key"]), row)
        if known != row:
            raise KeyClashError(row["source_key"])
    await _check_accounts(session, {row["account_id"] for row in rows})
    statement = (
        insert(Transaction)
        .values(rows)
        .on_conflict_do_nothing(constraint="transaction_account_source_key")
        .returning(Transaction.id)
    )
    return list((await session.scalars(statement)).all())


async def link_transfers(session: AsyncSession) -> int:
    """Give each move between two own accounts one shared transfer group, and count the pairs.

    Pairs are greedy, nearest first, so three equal moves in a week can leave one unlinked.
    That one then counts as spending until it is fixed by hand. The whole table is read,
    not one batch, since the two halves often come in different pulls.
    """
    await session.execute(select(func.pg_advisory_xact_lock(LINK_LOCK)))
    named, twin = aliased(Transaction), aliased(Transaction)
    source, target = aliased(Account), aliased(Account)
    gap = func.abs(named.booking_date - twin.booking_date)
    candidates = await session.execute(
        select(named.id, twin.id)
        .join(source, source.id == named.account_id)
        .join(target, target.iban == named.counterparty_iban)
        .join(
            twin,
            and_(
                twin.account_id == target.id,
                twin.account_id != named.account_id,
                twin.amount == -named.amount,
                twin.currency == named.currency,
                twin.transfer_group.is_(None),
                or_(twin.counterparty_iban.is_(None), twin.counterparty_iban == source.iban),
            ),
        )
        .where(named.transfer_group.is_(None), named.amount != 0, gap <= TRANSFER_WINDOW_DAYS)
        # Nearest first, so of two candidates the closer one wins, and the rest
        # by date and id so the same rows always pair the same way.
        .order_by(gap, named.booking_date, named.id, twin.id)
    )
    # When both halves name the other's IBAN the pair is found from each side,
    # and a booking may be a candidate for several; each is used once.
    used: set[int] = set()
    pairs = 0
    for first, second in candidates.tuples():
        if first in used or second in used:
            continue
        used.update((first, second))
        pair = (first, second)
        # Both halves or neither; the lock and the guard keep a half-linked pair out.
        other = aliased(Transaction)
        linked = await session.scalars(
            update(Transaction)
            .where(
                Transaction.id.in_(pair),
                ~exists().where(other.id.in_(pair), other.transfer_group.is_not(None)),
            )
            # A transfer takes no category, so one a half got before its
            # twin came in, by rule or by hand, goes.
            .values(transfer_group=uuid.uuid4(), category_id=None, category_set_by=None)
            .returning(Transaction.id)
        )
        if len(linked.all()) == len(pair):
            pairs += 1
    return pairs


async def list_accounts(session: AsyncSession) -> list[Account]:
    """Every account, by name."""
    return list(await session.scalars(select(Account).order_by(Account.name)))


@dataclass(frozen=True)
class Filters:
    """What a reader narrows the bookings to. Each left None matches every booking."""

    account: int | None = None
    first: date | None = None
    last: date | None = None
    category: int | None = None
    text: str | None = None
    payee: int | None = None
    accounts: tuple[int, ...] | None = None


def _matching(statement: Any, filters: Filters) -> Any:
    """The bookings that pass every filter.

    Text is matched plainly, ignoring case, in the purpose, counterparty and payee name.
    A booking is in a category when it or one of its splits is.
    """
    if filters.account is not None:
        statement = statement.where(Transaction.account_id == filters.account)
    if filters.accounts is not None:
        statement = statement.where(Transaction.account_id.in_(filters.accounts))
    if filters.payee is not None:
        statement = statement.where(Transaction.payee_id == filters.payee)
    if filters.first is not None:
        statement = statement.where(Transaction.booking_date >= filters.first)
    if filters.last is not None:
        statement = statement.where(Transaction.booking_date <= filters.last)
    if filters.category is not None:
        statement = statement.where(
            or_(
                Transaction.category_id == filters.category,
                exists().where(
                    TransactionSplit.transaction_id == Transaction.id,
                    TransactionSplit.category_id == filters.category,
                ),
            )
        )
    if filters.text:
        needle = filters.text.lower()
        payee = select(Payee.name).where(Payee.id == Transaction.payee_id).scalar_subquery()
        statement = statement.where(
            or_(
                *(
                    func.strpos(func.lower(func.coalesce(column, "")), needle) > 0
                    for column in (Transaction.purpose, Transaction.counterparty_name, payee)
                )
            )
        )
    return statement


async def list_transactions(
    session: AsyncSession,
    filters: Filters,
    *,
    after: int | None,
    limit: int,
    newest_first: bool = False,
) -> list[Transaction]:
    """At most `limit` matching bookings, oldest first or newest first, each with its splits.

    `after` is the last booking a reader has. Ids do not follow booking dates (an import
    fills in the past), so the cursor resumes at that booking's place in date order.
    """
    statement = _matching(select(Transaction).options(selectinload(Transaction.splits)), filters)
    key = tuple_(Transaction.booking_date, Transaction.id)
    if after is not None:
        place = select(Transaction.booking_date).where(Transaction.id == after).scalar_subquery()
        cursor = tuple_(place, literal(after))
        statement = statement.where(key < cursor if newest_first else key > cursor)
    order = (
        (Transaction.booking_date.desc(), Transaction.id.desc())
        if newest_first
        else (Transaction.booking_date, Transaction.id)
    )
    return list(await session.scalars(statement.order_by(*order).limit(limit)))


async def _is_move(session: AsyncSession, booking: Transaction) -> bool:
    """Whether a booking is a move between own accounts, with its other half in or not.

    The budget counts it as a move even before its twin comes, so splitting it would
    make it spending.
    """
    if booking.transfer_group is not None:
        return True
    if booking.counterparty_iban is None:
        return False
    other = await session.scalar(
        select(Account.id).where(
            Account.iban == booking.counterparty_iban, Account.id != booking.account_id
        )
    )
    return other is not None


async def replace_splits(
    session: AsyncSession, transaction_id: int, parts: list[dict[str, Any]]
) -> Transaction | None:
    """Put `parts` in place of the booking's splits; None when there is no such booking.

    The parts must add up to the booking's amount or nothing is written, since the budget
    counts the splits instead. An empty list removes them. Parts may differ in sign.
    """
    # Locked, so two writers of one booking's splits take turns: each would
    # otherwise delete the splits it read and add its own, leaving both sets.
    booking = await session.scalar(
        select(Transaction)
        .options(selectinload(Transaction.splits))
        .where(Transaction.id == transaction_id)
        .with_for_update()
    )
    if booking is None:
        return None
    if parts and await _is_move(session, booking):
        raise TransferSplitError
    total = sum((part["amount"] for part in parts), Decimal(0))
    if parts and total != booking.amount:
        raise SplitSumError(total, booking.amount)
    if parts:
        # With splits the category lives on them, so the booking's own goes,
        # even one set by hand.
        booking.category_id = None
        booking.category_set_by = None
    booking.splits = [TransactionSplit(**part) for part in parts]
    await session.flush()
    return booking
