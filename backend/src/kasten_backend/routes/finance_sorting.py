"""The finance routes that sort bookings: categories, payees, rules, the hand, the to-sort list.

Beside `routes/finance.py` under the same prefix and the same gate, in a file
of their own for size. The order rules fire in is in `finance_sorting`. Every
write that could change what a rule gives runs the rules over every booking
before it commits, so nothing shown is stale.
"""

from datetime import date  # noqa: TC003  pydantic reads the annotation at runtime
from decimal import Decimal  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from kasten_backend import finance_sorting as sorting
from kasten_backend.finance_models import (
    SIDES,
    Category,
    CategoryKind,
    Payee,
    Rule,
    RuleKind,
    Transaction,
    TransactionSplit,
    side_of,
)
from kasten_backend.routes.finance import MAX_PAGE, PAGE, Session, SplitOut, TransactionOut

router = APIRouter(prefix="/api/finance")

Name = Annotated[str, Field(min_length=1)]


class CategoryIn(BaseModel):
    """A category as the browser sends it."""

    name: Name
    kind: CategoryKind


class CategoryOut(CategoryIn):
    """A category as stored."""

    model_config = ConfigDict(from_attributes=True)

    id: int


class PayeeOut(BaseModel):
    """A payee: its cleaned key, the name shown, and its default category."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    name: str
    category_id: int | None


class Choice(BaseModel):
    """A category to set, or null to hand the row back to the rules."""

    category_id: int | None


class RuleIn(BaseModel):
    """A rule as the browser sends it. The pattern is stored as `sorting.clean_pattern` makes it."""

    kind: RuleKind
    pattern: str
    category_id: int

    @model_validator(mode="after")
    def _cleaned(self) -> RuleIn:
        """Clean the pattern, refusing one with no letter or digit, which would match every booking.

        A payee pattern such as `-` cleans to nothing, and nothing is in every
        key; a text pattern of spaces is in nearly every purpose.
        """
        self.pattern = sorting.clean_pattern(self.kind, self.pattern)
        if not any(char.isalnum() for char in self.pattern):
            msg = "A pattern needs a letter or a digit"
            raise ValueError(msg)
        return self


class RuleOut(RuleIn):
    """A rule as stored."""

    model_config = ConfigDict(from_attributes=True)

    id: int


class Ran(BaseModel):
    """How many bookings and splits a run of the rules gave another category."""

    changed: int


class LooseSplit(BaseModel):
    """A split still without a category."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    amount: Decimal
    text: str | None


class ToSortPage(BaseModel):
    """A page of bookings to sort, and how many things are to sort in all."""

    total: int
    bookings: list[ToSort]


class ToSort(BaseModel):
    """A booking that holds something to sort: itself, or the splits listed."""

    id: int
    account_id: int
    booking_date: date
    amount: Decimal
    currency: str
    purpose: str | None
    counterparty_name: str | None
    payee_id: int | None
    payee_name: str | None
    splits: list[LooseSplit]


def _refused(error: IntegrityError, what: str) -> HTTPException | None:
    """The answer to a write the database refused: a 409 for a repeat, a 422 for no category.

    None for any other cause, which the caller lets through as the error it is.
    """
    cause = str(error.orig).lower()
    if "unique" in cause:
        return HTTPException(status_code=409, detail=f"{what} is already there")
    if "foreign key" in cause:
        return HTTPException(status_code=422, detail="No such category")
    return None


async def _commit(session: Session, what: str, *, run: bool = False) -> None:
    """Commit, after a run of the rules when `run`, answering a refused write as `_refused` says."""
    try:
        if run:
            # The run flushes first, which is where a repeated pattern or an
            # unknown category meets the database.
            await sorting.apply_rules(session)
        await session.commit()
    except IntegrityError as error:
        # The session cannot be used again until it rolls the failed flush back.
        await session.rollback()
        answer = _refused(error, what)
        if answer is None:
            raise
        raise answer from error


@router.get("/categories")
async def read_categories(session: Session) -> list[CategoryOut]:
    """Every category, by name."""
    found = await session.scalars(select(Category).order_by(Category.name))
    return [CategoryOut.model_validate(category) for category in found]


@router.post("/categories")
async def write_category(category: CategoryIn, session: Session) -> CategoryOut:
    """Make a category. A name already taken is a 409."""
    made = Category(**category.model_dump())
    session.add(made)
    await _commit(session, f"A category named {category.name!r}")
    return CategoryOut.model_validate(made)


@router.put("/categories/{category_id}")
async def rewrite_category(category_id: int, category: CategoryIn, session: Session) -> CategoryOut:
    """Rename a category or change its kind, running the rules when the kind changes.

    The kind says which side of a booking the category's rules sort, income
    money in and the rest money out, so a new kind can move bookings.
    """
    found = await session.get(Category, category_id)
    if found is None:
        raise HTTPException(status_code=404, detail="No such category")
    run = found.kind != category.kind
    if run:
        mine = list(await session.scalars(select(Rule).where(Rule.category_id == category_id)))
        side = side_of(category.kind)
        await _refuse_overlap(
            session, [(rule.kind, rule.pattern, side) for rule in mine], {r.id for r in mine}
        )
    found.name, found.kind = category.name, category.kind
    if run:
        await session.execute(
            update(Rule).where(Rule.category_id == category_id).values(side=side_of(category.kind))
        )
    await _commit(
        session, f"A category named {category.name!r}, or a rule of its pattern and side", run=run
    )
    return CategoryOut.model_validate(found)


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(category_id: int, session: Session) -> Response:
    """Delete a category and its rules, and run the rules over what it held."""
    if not await sorting.delete_category(session, category_id):
        raise HTTPException(status_code=404, detail="No such category")
    await _commit(session, "A category")
    return Response(status_code=204)


@router.get("/payees")
async def read_payees(session: Session) -> list[PayeeOut]:
    """Every payee, by key."""
    found = await session.scalars(select(Payee).order_by(Payee.key))
    return [PayeeOut.model_validate(payee) for payee in found]


@router.put("/payees/{payee_id}")
async def write_payee(payee_id: int, choice: Choice, session: Session) -> PayeeOut:
    """Set a payee's default category, "always for this payee", and run the rules."""
    try:
        payee = await sorting.set_payee_category(session, payee_id, choice.category_id)
    except sorting.UnknownCategoryError as unknown:
        raise HTTPException(status_code=422, detail=str(unknown)) from unknown
    if payee is None:
        raise HTTPException(status_code=404, detail="No such payee")
    await _commit(session, "A payee")
    return PayeeOut.model_validate(payee)


@router.get("/rules")
async def read_rules(session: Session) -> list[RuleOut]:
    """Every rule, in the order they fire."""
    found = await session.scalars(sorting.rules_in_order())
    return [RuleOut.model_validate(rule) for rule in found]


def _overlapping(side: str) -> tuple[str, ...]:
    """The sides a rule of `side` shares bookings with: both shares with every side."""
    return SIDES if side == "both" else (side, "both")


async def _refuse_overlap(
    session: Session, rules: list[tuple[str, str, str]], leaving: set[int]
) -> None:
    """A 409 when another rule of a kind and pattern sorts the same side as one of `rules`.

    The unique constraint holds kind, pattern and side apart, and `both` is a
    side of its own there; an ignore rule `hotel` beside a spending rule
    `hotel` would sort the same money out two ways, so it is refused here.
    `leaving` names the rules the write changes, which do not clash with
    themselves.
    """
    for kind, pattern, side in rules:
        clash = await session.scalar(
            select(Rule.id).where(
                Rule.kind == kind,
                Rule.pattern == pattern,
                Rule.side.in_(_overlapping(side)),
                Rule.id.not_in(leaving or {0}),
            )
        )
        if clash is not None:
            raise HTTPException(
                status_code=409, detail="A rule of that kind and pattern sorts the same side"
            )


async def _side(session: Session, category_id: int) -> str:
    """The side a rule for this category sorts; a category that does not exist is a 422."""
    category = await session.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=422, detail="No such category")
    return side_of(category.kind)


async def _store_rule(session: Session, rule: Rule) -> RuleOut:
    """Run the rules with `rule` in place, commit, and answer it."""
    await _commit(session, "A rule of that kind, pattern and side", run=True)
    return RuleOut.model_validate(rule)


@router.post("/rules")
async def write_rule(rule: RuleIn, session: Session) -> RuleOut:
    """Make a rule and run the rules over every booking."""
    made = Rule(**rule.model_dump(), side=await _side(session, rule.category_id))
    await _refuse_overlap(session, [(made.kind, made.pattern, made.side)], set())
    session.add(made)
    return await _store_rule(session, made)


@router.put("/rules/{rule_id}")
async def rewrite_rule(rule_id: int, rule: RuleIn, session: Session) -> RuleOut:
    """Change a rule and run the rules over every booking."""
    found = await session.get(Rule, rule_id)
    if found is None:
        raise HTTPException(status_code=404, detail="No such rule")
    side = await _side(session, rule.category_id)
    await _refuse_overlap(session, [(rule.kind, rule.pattern, side)], {rule_id})
    found.kind, found.pattern, found.category_id = rule.kind, rule.pattern, rule.category_id
    found.side = side
    return await _store_rule(session, found)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, session: Session) -> Response:
    """Delete a rule and run the rules over every booking, so what it sorted is sorted again."""
    found = await session.get(Rule, rule_id)
    if found is None:
        raise HTTPException(status_code=404, detail="No such rule")
    await session.delete(found)
    await _commit(session, "A rule", run=True)
    return Response(status_code=204)


@router.post("/rules/run")
async def run_rules(session: Session) -> Ran:
    """Give every booking a payee, run the rules over every booking, and count the changes."""
    await sorting.assign_payees(session)
    changed = await sorting.apply_rules(session)
    await session.commit()
    return Ran(changed=changed)


async def _by_hand(session: Session, table: type, row_id: int, choice: Choice) -> object:
    try:
        row = await sorting.set_by_hand(session, table, row_id, choice.category_id)
    except sorting.UnknownCategoryError as unknown:
        raise HTTPException(status_code=422, detail=str(unknown)) from unknown
    except sorting.TakesNoCategoryError as none:
        raise HTTPException(status_code=409, detail=str(none)) from none
    if row is None:
        raise HTTPException(status_code=404, detail="No such row")
    await session.commit()
    return row


@router.put("/transactions/{transaction_id}/category")
async def write_transaction_category(
    transaction_id: int, choice: Choice, session: Session
) -> TransactionOut:
    """Set a booking's category by hand, or with null hand it back to the rules."""
    await _by_hand(session, Transaction, transaction_id, choice)
    return TransactionOut.model_validate(await sorting.reread(session, transaction_id))


@router.put("/splits/{split_id}/category")
async def write_split_category(split_id: int, choice: Choice, session: Session) -> SplitOut:
    """Set a split's category by hand, or with null hand it back to the rules."""
    return SplitOut.model_validate(await _by_hand(session, TransactionSplit, split_id, choice))


@router.get("/to-sort")
async def read_to_sort(
    session: Session,
    *,
    after: int | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = PAGE,
) -> ToSortPage:
    """A page of the bookings that hold something without a category, oldest first, and a count.

    `total` counts the bookings without splits and the loose splits, every
    page alike, so a reader of the first page knows how many wait.
    """
    found = await sorting.to_sort(session, after=after, limit=limit)
    bookings = [
        ToSort(
            id=booking.id,
            account_id=booking.account_id,
            booking_date=booking.booking_date,
            amount=booking.amount,
            currency=booking.currency,
            purpose=booking.purpose,
            counterparty_name=booking.counterparty_name,
            payee_id=booking.payee_id,
            payee_name=None if booking.payee is None else booking.payee.name,
            splits=[
                LooseSplit.model_validate(part)
                for part in booking.splits
                if part.category_id is None
            ],
        )
        for booking in found
    ]
    return ToSortPage(total=await sorting.to_sort_total(session), bookings=bookings)
