"""Sorting bookings into categories: payees, rules, the hand's choice, and the to-sort list.

A booking's category comes from one place, in this order, the first that
gives one winning:

1. the hand: a category set by hand is never touched by a rule;
2. a `text_contains` rule whose pattern is in the purpose, casefolded;
3. the payee's default category;
4. a `payee` rule whose pattern, cleaned like a payee name, is in the payee's key.

Among rules of one kind the longest pattern wins, then the lowest id. Text
rules come first because they exist for the bookings whose payee says
nothing, PayPal and Amazon: an "always for this payee" on a PayPal booking
must not silence the rules that read past it. A payee's own default comes
before a payee rule because it names that one payee, and a rule names a part
of many.

A split is sorted the same way, its own text standing in for the purpose and
its booking's payee for its own. A booking with splits takes no category
itself; its splits do. A move between own accounts (`transfer_group`) takes
none either, being no spending.

Rules run over every booking whenever a rule, a payee's default or a category
changes, and over the new rows of every ingest. A run also clears a category
a rule gave that no rule gives any more. Nothing here commits.
"""

from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    ColumnElement,
    and_,
    case,
    exists,
    func,
    literal,
    null,
    or_,
    select,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased, selectinload

from kasten_backend.finance_models import (
    Category,
    Payee,
    Rule,
    Transaction,
    TransactionSplit,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession


class UnknownCategoryError(LookupError):
    """A write names a category id the table does not hold."""


class HasSplitsError(ValueError):
    """A category set on a booking whose category lives on its splits."""


def payee_key(name: Any) -> ColumnElement[str]:
    """The key a counterparty name is matched by, worked out in the database.

    Casefolded, every run of characters that are neither letters nor digits
    made one space, and trimmed, so `REWE Markt GmbH.` and `Rewe  markt gmbh`
    are one payee. Postgres's `[:alnum:]` takes umlauts as letters.
    """
    return func.btrim(func.regexp_replace(func.lower(name), "[^[:alnum:]]+", " ", "g"))


def _spelled(name: Any) -> ColumnElement[str]:
    """A counterparty name as shown: trimmed, and every run of spaces made one."""
    return func.btrim(func.regexp_replace(name, r"\s+", " ", "g"))


def _first_rule(kind: str, matches: ColumnElement[bool]) -> Any:
    """The category of the winning rule of one kind, as a subquery correlated to its booking."""
    return (
        select(Rule.category_id)
        .where(Rule.kind == kind, matches)
        .order_by(func.length(Rule.pattern).desc(), Rule.id)
        .limit(1)
        .scalar_subquery()
    )


def _chosen(text: Any, payee_id: Any) -> Any:
    """The category the rules give a row whose text and payee are these columns."""
    payee = aliased(Payee)
    by_text = _first_rule(
        "text_contains", func.strpos(func.lower(text), func.lower(Rule.pattern)) > 0
    )
    by_default = select(payee.category_id).where(payee.id == payee_id).scalar_subquery()
    by_payee = _first_rule(
        "payee",
        exists().where(payee.id == payee_id, func.strpos(payee.key, payee_key(Rule.pattern)) > 0),
    )
    return func.coalesce(by_text, by_default, by_payee)


async def _apply(session: AsyncSession, table: Any, rows: Any) -> int:
    """Write the rules' choice from `rows` (id, category) into `table`, where it changes."""
    choice = rows.subquery()
    written = await session.scalars(
        update(table)
        .where(table.id == choice.c.id, table.category_id.is_distinct_from(choice.c.category))
        .values(
            category_id=choice.c.category,
            category_set_by=case((choice.c.category.is_(None), null()), else_=literal("rule")),
        )
        .returning(table.id)
    )
    return len(written.all())


def _by_rule(row: Any) -> ColumnElement[bool]:
    """A row the rules may write: never one sorted by hand."""
    return or_(row.category_set_by.is_(None), row.category_set_by == "rule")


async def apply_rules(session: AsyncSession, ids: Sequence[int] | None = None) -> int:
    """Run the rules over the bookings `ids` and their splits, or all, and count the changes."""
    await session.flush()
    booking, split = aliased(Transaction), aliased(TransactionSplit)
    has_splits = exists().where(TransactionSplit.transaction_id == booking.id)
    bookings = select(
        booking.id,
        case(
            (or_(booking.transfer_group.is_not(None), has_splits), null()),
            else_=_chosen(booking.purpose, booking.payee_id),
        ).label("category"),
    ).where(_by_rule(booking))
    parent = aliased(Transaction)
    splits = (
        select(
            split.id,
            case(
                (parent.transfer_group.is_not(None), null()),
                else_=_chosen(split.text, parent.payee_id),
            ).label("category"),
        )
        .join(parent, parent.id == split.transaction_id)
        .where(_by_rule(split))
    )
    if ids is not None:
        bookings = bookings.where(booking.id.in_(ids))
        splits = splits.where(split.transaction_id.in_(ids))
    return await _apply(session, Transaction, bookings) + await _apply(
        session, TransactionSplit, splits
    )


async def assign_payees(session: AsyncSession, ids: Sequence[int] | None = None) -> None:
    """Give each booking with a counterparty and no payee the payee its cleaned name is.

    A payee is made the first time its key is seen, named as that booking
    spells it. A counterparty that cleans to nothing gets no payee.
    """
    key = payee_key(Transaction.counterparty_name)
    unassigned = and_(Transaction.payee_id.is_(None), key != "")
    if ids is not None:
        unassigned = and_(unassigned, Transaction.id.in_(ids))
    first_seen = (
        select(key.label("key"), _spelled(Transaction.counterparty_name).label("name"))
        .where(unassigned)
        .distinct(key)
        .order_by(key, Transaction.id)
    )
    await session.execute(
        insert(Payee).from_select(["key", "name"], first_seen).on_conflict_do_nothing()
    )
    await session.execute(
        update(Transaction).where(unassigned, Payee.key == key).values(payee_id=Payee.id)
    )


async def _check_category(session: AsyncSession, category_id: int | None) -> None:
    if category_id is not None and await session.get(Category, category_id) is None:
        msg = f"No category with id {category_id}"
        raise UnknownCategoryError(msg)


async def set_by_hand(
    session: AsyncSession,
    table: Any,
    row_id: int,
    category_id: int | None,
) -> Any | None:
    """Set a booking's or split's category by hand, or hand it back to the rules with None.

    Answers the row, or None when there is no such row.
    """
    await _check_category(session, category_id)
    row = await session.get(table, row_id, with_for_update=True)
    if row is None:
        return None
    if (
        table is Transaction
        and category_id is not None
        and await session.scalar(select(exists().where(TransactionSplit.transaction_id == row_id)))
    ):
        msg = "This booking has splits, and its category lives on them"
        raise HasSplitsError(msg)
    row.category_id = category_id
    row.category_set_by = None if category_id is None else "hand"
    if category_id is None:
        booking = row_id if table is Transaction else row.transaction_id
        await apply_rules(session, [booking])
    await session.flush()
    await session.refresh(row)
    return row


async def set_payee_category(
    session: AsyncSession, payee_id: int, category_id: int | None
) -> Payee | None:
    """Give a payee its default category, the "always for this payee", and run the rules."""
    await _check_category(session, category_id)
    payee = await session.get(Payee, payee_id)
    if payee is None:
        return None
    payee.category_id = category_id
    await apply_rules(session)
    return payee


async def delete_category(session: AsyncSession, category_id: int) -> bool:
    """Delete a category, its rules with it, and run the rules over what it held.

    The bookings it held, by hand or by rule, go back to the rules first, so a
    rule may sort them elsewhere and the rest come back to the to-sort list.
    """
    category = await session.get(Category, category_id)
    if category is None:
        return False
    for table in (Transaction, TransactionSplit):
        await session.execute(
            update(table)
            .where(table.category_id == category_id)
            .values(category_id=None, category_set_by=None)
        )
    await session.delete(category)
    await apply_rules(session)
    return True


async def reread(session: AsyncSession, transaction_id: int) -> Transaction:
    """A booking and its splits as the database holds them now.

    The rules write with plain updates, which leave the rows already in the
    session as they were, so a booking is read again before it is answered.
    """
    statement = (
        select(Transaction)
        .options(selectinload(Transaction.splits))
        .where(Transaction.id == transaction_id)
        .execution_options(populate_existing=True)
    )
    return (await session.scalars(statement)).one()


def rules_in_order() -> Any:
    """Every rule, in the order they fire: text rules, then payee rules, longest first."""
    return select(Rule).order_by(
        case((Rule.kind == "text_contains", 0), else_=1),
        func.length(Rule.pattern).desc(),
        Rule.id,
    )


async def to_sort(session: AsyncSession, *, after: int | None, limit: int) -> list[Transaction]:
    """At most `limit` bookings that hold something without a category, oldest first.

    A booking counts when it has no splits and no category, or when one of its
    splits has none; transfers never count. The caller shows a booking's
    uncategorised splits in its place. `after` is a cursor as in
    `finance.list_transactions`.
    """
    loose_split = exists().where(
        TransactionSplit.transaction_id == Transaction.id, TransactionSplit.category_id.is_(None)
    )
    any_split = exists().where(TransactionSplit.transaction_id == Transaction.id)
    statement = (
        select(Transaction)
        .options(selectinload(Transaction.splits), selectinload(Transaction.payee))
        .where(
            Transaction.transfer_group.is_(None),
            or_(and_(Transaction.category_id.is_(None), ~any_split), loose_split),
        )
    )
    if after is not None:
        place = select(Transaction.booking_date).where(Transaction.id == after).scalar_subquery()
        statement = statement.where(
            tuple_(Transaction.booking_date, Transaction.id) > tuple_(place, literal(after))
        )
    order = statement.order_by(Transaction.booking_date, Transaction.id).limit(limit)
    return list(await session.scalars(order))
