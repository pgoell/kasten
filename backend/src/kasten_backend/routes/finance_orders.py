"""The order routes: what the order mail job sends, and the orders no booking holds yet.

The job on the host reads the PayPal and Amazon order mails and posts each
order it found; kasten stores it by its id and matches its charges to the bank
bookings (`finance_orders`). Same gate and same 503 as `routes/finance.py`.
"""

from datetime import date  # noqa: TC003  pydantic reads the annotation at runtime
from decimal import Decimal  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated, Self

from fastapi import APIRouter, Body, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import finance_orders
from kasten_backend.db import get_session
from kasten_backend.finance_order_models import (  # noqa: TC001  pydantic reads them at runtime
    ChargeKind,
    Source,
)
from kasten_backend.routes.finance import Money  # noqa: TC001  pydantic reads it at runtime

router = APIRouter(prefix="/api/finance/orders")

Session = Annotated[AsyncSession, Depends(get_session)]

MAX_BATCH = 200
"""The most orders one post may carry. A first run over months of mail sends several."""

Text = Annotated[str, Field(min_length=1)]


class ItemIn(BaseModel):
    """One line of a charge at its line price, or shipping, tax or a discount."""

    text: Text
    amount: Money


class ChargeIn(BaseModel):
    """One payment for the order, with the items it paid for, or one refund, which has none."""

    kind: ChargeKind = "charge"
    key: Text
    charged_on: date
    amount: Annotated[Money, Field(gt=0)]
    items: list[ItemIn] = []

    @model_validator(mode="after")
    def _items_fit_the_kind(self) -> Self:
        if self.kind == "charge" and not self.items:
            msg = "A charge lists the items it paid for"
            raise ValueError(msg)
        if self.kind == "refund" and self.items:
            msg = "A refund lists no items"
            raise ValueError(msg)
        return self


class OrderIn(BaseModel):
    """An order as the job sends it, keyed by its source and the shop's order id."""

    source: Source
    order_key: Text
    ordered_on: date
    merchant: Text
    total: Money | None = None
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] = "EUR"
    charges: Annotated[list[ChargeIn], Field(max_length=50)] = []

    @model_validator(mode="after")
    def _keys_differ(self) -> Self:
        keys = [(c.kind, c.key) for c in self.charges]
        if len(keys) != len(set(keys)):
            msg = "Two charges of one kind share a key"
            raise ValueError(msg)
        return self


class OrdersStored(BaseModel):
    """What a post did: orders new, changed and as they were, and charges matched to a booking."""

    created: int
    updated: int
    unchanged: int
    matched: int


class ItemOut(BaseModel):
    """One line of a charge."""

    model_config = ConfigDict(from_attributes=True)

    text: str
    amount: Decimal


class ChargeOut(BaseModel):
    """A charge or refund as stored, the booking it matched and where it stands."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    key: str
    charged_on: date
    amount: Decimal
    transaction_id: int | None
    status: str
    items: list[ItemOut]


class OrderOut(BaseModel):
    """An order as stored, with its charges and refunds."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    order_key: str
    ordered_on: date
    merchant: str
    total: Decimal | None
    currency: str
    charges: list[ChargeOut]


@router.post("")
async def write_orders(
    orders: Annotated[list[OrderIn], Body(max_length=MAX_BATCH)], session: Session
) -> OrdersStored:
    """Store the orders by their ids and match every charge that waits to its booking.

    An order sent again with nothing new changes nothing. A charge no longer
    sent stays, and one already matched is never rewritten.
    """
    stored = await finance_orders.store_orders(session, [o.model_dump() for o in orders])
    await session.commit()
    return OrdersStored(
        created=stored.created,
        updated=stored.updated,
        unchanged=stored.unchanged,
        matched=stored.matched,
    )


@router.get("/unmatched")
async def read_unmatched(
    session: Session, limit: Annotated[int, Query(ge=1, le=500)] = 50
) -> list[OrderOut]:
    """The newest orders with a charge no booking holds yet, or with no charge yet, newest first."""
    found = await finance_orders.unmatched(session, limit)
    return [OrderOut.model_validate(order) for order in found]
