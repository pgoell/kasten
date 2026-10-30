"""What the sync routes do: record "pull now", start and finish runs, and report the status.

The bank job polls every minute, so a poll that finds no request must stay cheap. A request
starts a run, which claims every open request at once. Nothing here commits.
"""

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select, update

from kasten_backend.finance_models import Account, Transaction
from kasten_backend.finance_sync_models import SyncRequest, SyncRun, SyncRunAccount

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

SYNC_LOCK = 0x6B73796E
"""The advisory lock a run start holds until its transaction ends.

Two pollers starting at once would both see the request open and both pull,
each sending its own push TAN. With the lock the second is turned away at
once rather than queued behind the first.
"""

RUN_TIMEOUT = timedelta(minutes=30)
"""How long an unfinished run blocks the next one.

A run waits up to four minutes for each push TAN, a few times over, and the
systemd units stop the job at 25 minutes (`TimeoutStartSec=25min` in
docs/how-to/run-the-bank-sync.md). So a run older than this is surely dead,
killed without finishing, and the next one may start. Kept above the unit's
limit: below it, a slow live run could be joined by a second.
"""


class RunBusyError(RuntimeError):
    """Another run is starting or has not finished."""


class NothingRequestedError(LookupError):
    """A run for a request found none open: another poller claimed it first."""


class RunFinishedError(ValueError):
    """The run was finished already. Its record stays as the first finish wrote it."""


async def request_sync(session: AsyncSession) -> SyncRequest:
    """Record a "pull now", or hand back the one still open, so pressing twice asks once."""
    waiting = await open_request(session)
    if waiting is not None:
        return waiting
    created = SyncRequest()
    session.add(created)
    await session.flush()
    await session.refresh(created)
    return created


async def open_request(session: AsyncSession) -> SyncRequest | None:
    """The oldest "pull now" no run has claimed, or None."""
    return await session.scalar(
        select(SyncRequest).where(SyncRequest.run_id.is_(None)).order_by(SyncRequest.id).limit(1)
    )


async def start_run(session: AsyncSession, trigger: str) -> tuple[SyncRun, int]:
    """Start a run and claim every open request, answering the run and how many it claimed.

    A run is refused when no request is open or another run is going. A scheduled run claims
    open requests too, since it pulls what they asked for.
    """
    if not await session.scalar(select(func.pg_try_advisory_xact_lock(SYNC_LOCK))):
        msg = "Another run is starting"
        raise RunBusyError(msg)
    running = await session.scalar(
        select(SyncRun.id).where(
            SyncRun.finished_at.is_(None), SyncRun.started_at > func.now() - RUN_TIMEOUT
        )
    )
    if running is not None:
        msg = f"Run {running} has not finished"
        raise RunBusyError(msg)
    if trigger == "request":
        waiting = await session.scalar(select(SyncRequest.id).where(SyncRequest.run_id.is_(None)))
        if waiting is None:
            msg = "No sync request is open"
            raise NothingRequestedError(msg)
    run = SyncRun(trigger=trigger)
    session.add(run)
    await session.flush()
    await session.refresh(run)
    claimed = await session.scalars(
        update(SyncRequest)
        .where(SyncRequest.run_id.is_(None))
        .values(run_id=run.id)
        .returning(SyncRequest.id)
    )
    return run, len(claimed.all())


async def finish_run(
    session: AsyncSession,
    run_id: int,
    *,
    outcome: str,
    error: str | None,
    accounts: list[dict[str, Any]],
) -> SyncRun | None:
    """Write how the run ended and what it fetched per account, or None for no such run."""
    run = await session.scalar(select(SyncRun).where(SyncRun.id == run_id).with_for_update())
    if run is None:
        return None
    if run.finished_at is not None:
        msg = f"Run {run_id} finished at {run.finished_at.isoformat()}"
        raise RunFinishedError(msg)
    run.finished_at = datetime.now(UTC)
    run.outcome = outcome
    run.error = error
    session.add_all(SyncRunAccount(run_id=run_id, **row) for row in accounts)
    await session.flush()
    return run


def _days_since(moment: datetime | None, now: datetime) -> int | None:
    return None if moment is None else (now - moment).days


async def sync_status(session: AsyncSession) -> dict[str, Any]:
    """The open request, the last run and the last success, and where each account starts next.

    Per account: the last window fetched without error, and the newest booking stored.
    """
    now = datetime.now(UTC)
    requested_at = await session.scalar(
        select(func.min(SyncRequest.requested_at)).where(SyncRequest.run_id.is_(None))
    )
    last_run = await session.scalar(select(SyncRun).order_by(SyncRun.id.desc()).limit(1))
    last_success = await session.scalar(
        select(func.max(SyncRun.finished_at)).where(SyncRun.outcome == "ok")
    )
    good = (
        select(
            SyncRunAccount.account_id,
            SyncRunAccount.fetched_through,
            SyncRun.finished_at,
        )
        .join(SyncRun, SyncRun.id == SyncRunAccount.run_id)
        .where(SyncRunAccount.outcome == "ok")
        .distinct(SyncRunAccount.account_id)
        .order_by(SyncRunAccount.account_id, SyncRun.id.desc())
        .subquery()
    )
    newest = (
        select(Transaction.account_id, func.max(Transaction.booking_date).label("newest"))
        .group_by(Transaction.account_id)
        .subquery()
    )
    rows = await session.execute(
        select(
            Account.id,
            Account.name,
            Account.iban,
            good.c.fetched_through,
            good.c.finished_at,
            newest.c.newest,
        )
        .outerjoin(good, good.c.account_id == Account.id)
        .outerjoin(newest, newest.c.account_id == Account.id)
        .order_by(Account.name)
    )
    return {
        "requested_at": requested_at,
        "last_run": last_run,
        # A run past the timeout was killed without saying so, as `start_run` reads it too.
        "running": last_run is not None
        and last_run.finished_at is None
        and now - last_run.started_at < RUN_TIMEOUT,
        "last_success_at": last_success,
        "days_since_success": _days_since(last_success, now),
        "accounts": [
            {
                "account_id": account_id,
                "name": name,
                "iban": iban,
                "last_good_through": through,
                "last_good_at": at,
                "days_since_success": _days_since(at, now),
                "newest_booking": newest_day,
            }
            for account_id, name, iban, through, at, newest_day in rows.tuples()
        ],
    }


async def missing_accounts(session: AsyncSession, ids: set[int]) -> set[int]:
    """The ids among `ids` that name no account."""
    found = set(await session.scalars(select(Account.id).where(Account.id.in_(ids))))
    return ids - found
