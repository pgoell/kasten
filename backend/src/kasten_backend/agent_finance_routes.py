"""The `/agent/finance/` routes: the pane's finance reads, behind the token check.

The summaries are the pane's own route functions mounted a second time, so a
token holder gets the browser's answer to the same question, in the same
shape, and `docs/reference/http-api/finance-*.md` describes both. Every route
here is a GET; an agent writes nothing to finance. `agent_routes.py` includes
this router into its own, so the token check in front of the rest of
`/agent/` is in front of these too, and `/agent/openapi.json` names them.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kasten_backend import agent_finance
from kasten_backend.finance_ledger import Scope  # noqa: TC001  FastAPI reads it at runtime
from kasten_backend.log import DATE_PATTERN
from kasten_backend.routes import (
    finance_budget,
    finance_drill,
    finance_goals,
    finance_plans,
    finance_tax,
)
from kasten_backend.routes import finance_sync as sync
from kasten_backend.routes.finance import Session  # noqa: TC001  FastAPI reads it at runtime
from kasten_backend.routes.finance_budget import MONTH_PATTERN

router = APIRouter(prefix="/finance")

for path, read in [
    ("/budget", finance_budget.read_budget),
    ("/budget/free", finance_budget.read_free_to_spend),
    ("/goals", finance_goals.read_goals),
    ("/plans/forecast", finance_plans.read_forecast),
    ("/plans/upcoming", finance_plans.read_upcoming),
    ("/sync", sync.read_status),
    ("/tax/{year}", finance_tax.read_year),
    ("/transactions/{transaction_id}", finance_drill.read_booking),
]:
    router.add_api_route(path, read, methods=["GET"])


@router.get("/lookup")
async def lookup(session: Session) -> agent_finance.Lookup:
    """Every account, category and payee, for the ids the other routes name."""
    return await agent_finance.lookup(session)


@router.get("/transactions")
async def bookings(  # noqa: PLR0913  each query parameter is its own argument
    session: Session,
    *,
    month: Annotated[str | None, Query(pattern=MONTH_PATTERN)] = None,
    start: Annotated[str | None, Query(alias="from", pattern=DATE_PATTERN)] = None,
    end: Annotated[str | None, Query(alias="to", pattern=DATE_PATTERN)] = None,
    scope: Scope | None = None,
    account: int | None = None,
    category: int | None = None,
    payee: int | None = None,
    text: str | None = None,
    order: Literal["asc", "desc"] = "desc",
    after: int | None = None,
    limit: Annotated[int, Query(ge=1, le=agent_finance.MAX_PAGE)] = agent_finance.PAGE,
) -> agent_finance.BookingPage:
    """A page of the bookings that pass the filters, newest first; `next` asks for the next."""
    return await agent_finance.bookings(
        session,
        month=month,
        start=start,
        end=end,
        scope=scope,
        account=account,
        category=category,
        payee=payee,
        text=text,
        newest_first=order == "desc",
        after=after,
        limit=limit,
    )
