"""The `/agent/finance/` routes: the pane's finance reads, behind the token check.

The pane's route functions mounted again, so a token holder gets the browser's answer.
Nothing writes to finance; the one POST writes cancel-by todos into contract notes.
`agent/route.py` includes this router, which is how the token check reaches it.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from kasten_backend.agent.finance import reads as agent_finance
from kasten_backend.finance.records.ledger import Scope  # noqa: TC001  FastAPI reads it at runtime
from kasten_backend.finance.routes.budget import budget as finance_budget
from kasten_backend.finance.routes.budget import drill as finance_drill
from kasten_backend.finance.routes.budget.budget import MONTH_PATTERN
from kasten_backend.finance.routes.feeds import sync
from kasten_backend.finance.routes.plans import goals as finance_goals
from kasten_backend.finance.routes.plans import plans as finance_plans
from kasten_backend.finance.routes.records.records import Session  # noqa: TC001  FastAPI reads it at runtime
from kasten_backend.finance.routes.tax import tax as finance_tax
from kasten_backend.periodic import DATE_PATTERN

router = APIRouter(prefix="/finance")

for path, read in [
    ("/budget", finance_budget.read_budget),
    ("/budget/free", finance_budget.read_free_to_spend),
    ("/contracts", finance_plans.read_contracts),
    ("/goals", finance_goals.read_goals),
    ("/plans/forecast", finance_plans.read_forecast),
    ("/plans/upcoming", finance_plans.read_upcoming),
    ("/sync", sync.read_status),
    ("/tax/{year}", finance_tax.read_year),
    ("/transactions/{transaction_id}", finance_drill.read_booking),
]:
    router.add_api_route(path, read, methods=["GET"])
router.add_api_route("/contracts/reminders", finance_plans.write_reminders, methods=["POST"])


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
