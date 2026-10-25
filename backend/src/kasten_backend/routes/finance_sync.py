"""The sync routes: "pull now", the runs the bank job records, and the status they add up to.

Kasten never talks to a bank (decided 2026-10-25). The job on the host polls
`GET /api/finance/sync` every minute, starts a run when a request is open, and
finishes it with what it fetched. The status is what the finance pane and
agents show: the last good pull per account, the last run's outcome, and the
days since a run last succeeded. Same gate and same 503 as `routes/finance.py`.
"""

from datetime import date, datetime  # noqa: TC003  pydantic reads the annotations at runtime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from kasten_backend import finance_sync
from kasten_backend.db import get_session
from kasten_backend.finance_sync_models import (  # noqa: TC001  pydantic reads them at runtime
    Outcome,
    Trigger,
)

router = APIRouter(prefix="/api/finance/sync")

Session = Annotated[AsyncSession, Depends(get_session)]

Count = Annotated[int, Field(ge=0)]


class RequestOut(BaseModel):
    """A "pull now": open while `run_id` is null."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    requested_at: datetime
    run_id: int | None


class RunOut(BaseModel):
    """A run as stored. `finished_at` and `outcome` are null while it runs."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    trigger: str
    started_at: datetime
    finished_at: datetime | None
    outcome: str | None
    error: str | None


class RunIn(BaseModel):
    """What starts a run: a request the job found open, or its own daily timer."""

    trigger: Trigger


class RunStarted(BaseModel):
    """The run, and how many open requests it claimed."""

    run: RunOut
    claimed: int


class AccountFetch(BaseModel):
    """What a run fetched for one account, and what the ingest made of it."""

    account_id: int
    fetched_from: date
    fetched_through: date
    outcome: Outcome
    created: Count = 0
    skipped: Count = 0
    error: str | None = None


class RunFinish(BaseModel):
    """How a run ended, with a line per account it reached."""

    outcome: Outcome
    error: str | None = None
    accounts: Annotated[list[AccountFetch], Field(max_length=100)] = []


class AccountStatus(BaseModel):
    """Where an account stands: its last good window, and the newest booking stored."""

    account_id: int
    name: str
    iban: str | None
    last_good_through: date | None
    last_good_at: datetime | None
    days_since_success: int | None
    newest_booking: date | None


class SyncStatus(BaseModel):
    """The open request, the last run, the last success, and every account."""

    requested_at: datetime | None
    last_run: RunOut | None
    last_success_at: datetime | None
    days_since_success: int | None
    accounts: list[AccountStatus]


@router.get("")
async def read_status(session: Session) -> SyncStatus:
    """The sync status, and whether a "pull now" waits, which is all a minute's poll reads."""
    return SyncStatus.model_validate(await finance_sync.sync_status(session), from_attributes=True)


@router.post("/requests")
async def write_request(session: Session) -> RequestOut:
    """Ask for a pull. A request already open is answered instead of a second one."""
    request = await finance_sync.request_sync(session)
    await session.commit()
    return RequestOut.model_validate(request)


@router.post("/runs")
async def start_run(run: RunIn, session: Session) -> RunStarted:
    """Start a run and claim every open request, or 409 when another run has it."""
    try:
        started, claimed = await finance_sync.start_run(session, run.trigger)
    except (finance_sync.RunBusyError, finance_sync.NothingRequestedError) as refused:
        raise HTTPException(status_code=409, detail=str(refused)) from refused
    await session.commit()
    return RunStarted(run=RunOut.model_validate(started), claimed=claimed)


@router.patch("/runs/{run_id}")
async def finish_run(run_id: int, finish: RunFinish, session: Session) -> RunOut:
    """Record how the run ended, once, with what it fetched per account."""
    if missing := await finance_sync.missing_accounts(
        session, {row.account_id for row in finish.accounts}
    ):
        detail = f"No account with id {', '.join(str(i) for i in sorted(missing))}"
        raise HTTPException(status_code=422, detail=detail)
    try:
        run = await finance_sync.finish_run(
            session,
            run_id,
            outcome=finish.outcome,
            error=finish.error,
            accounts=[row.model_dump() for row in finish.accounts],
        )
    except finance_sync.RunFinishedError as finished:
        raise HTTPException(status_code=409, detail=str(finished)) from finished
    if run is None:
        raise HTTPException(status_code=404, detail="No such run")
    await session.commit()
    return RunOut.model_validate(run)
