"""The sync tables: what "pull now" asks for, and what each run of the bank job did.

Kasten never talks to a bank. The job on the host does, and these rows are how
the two meet: a request waits here until a run claims it, and a run records
its outcome and, per account, the window it fetched. The status route reads
the last good window of each account back, which is where the job starts its
next one. See docs/how-to/run-the-bank-sync.md.
"""

import datetime as dt  # noqa: TC003  SQLAlchemy reads the annotation at runtime
from typing import Literal, get_args

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Identity, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base
from kasten_backend.finance_models import SCHEMA, Account

Trigger = Literal["request", "scheduled"]
"""What started a run: a "pull now" request, or the job's own timer."""

Outcome = Literal["ok", "failed"]
"""How a run, or one account's fetch in it, ended."""


def _one_of(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    return CheckConstraint(f"{column} IN ({', '.join(f"'{v}'" for v in values)})", name=name)


class SyncRun(Base):
    """One run of the bank job. `finished_at` and `outcome` stay empty while it runs."""

    __tablename__ = "sync_run"
    __table_args__ = (
        _one_of("trigger", get_args(Trigger), "sync_run_trigger_check"),
        _one_of("outcome", get_args(Outcome), "sync_run_outcome_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    trigger: Mapped[str] = mapped_column(Text)
    started_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)


class SyncRequest(Base):
    """A "pull now". Open while `run_id` is empty; the run that claims it fills it in."""

    __tablename__ = "sync_request"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    requested_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    run_id: Mapped[int | None] = mapped_column(ForeignKey(SyncRun.id))


class SyncRunAccount(Base):
    """What one run fetched for one account: the window, and what the ingest did with it."""

    __tablename__ = "sync_run_account"
    __table_args__ = (
        _one_of("outcome", get_args(Outcome), "sync_run_account_outcome_check"),
        {"schema": SCHEMA},
    )

    run_id: Mapped[int] = mapped_column(
        ForeignKey(SyncRun.id, ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[int] = mapped_column(ForeignKey(Account.id), primary_key=True)
    fetched_from: Mapped[dt.date] = mapped_column(Date)
    # The last day the window covered, whole: the next window starts a few days
    # before it, so a booking the bank posts late still comes in.
    fetched_through: Mapped[dt.date] = mapped_column(Date)
    outcome: Mapped[str] = mapped_column(Text)
    created: Mapped[int] = mapped_column(server_default=text("0"))
    skipped: Mapped[int] = mapped_column(server_default=text("0"))
    error: Mapped[str | None] = mapped_column(Text)
