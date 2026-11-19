"""The todo store in Postgres: one row per todo, its timer sessions and every change (#2191).

Why todos left the vault: docs/explanation/todos-in-postgres.md.
"""

from datetime import date, datetime  # noqa: TC003  SQLAlchemy reads `Mapped[...]` at runtime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base

SCHEMA = "todos"
"""A schema of its own, so `pg_dump -n todos` backs it up as `-n finance` backs up money."""

STATES = ("open", "doing", "review", "done", "blocked", "waiting", "rejected")
PRIORITIES = ("highest", "high", "medium", "low", "lowest")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class Todo(Base):
    """One todo. Words keep their tags where they were typed; `tags` is read off them on save."""

    __tablename__ = "todo"
    __table_args__ = (
        CheckConstraint(_one_of("state", STATES), name="todo_state"),
        CheckConstraint(
            f"priority IS NULL OR {_one_of('priority', PRIORITIES)}", name="todo_priority"
        ),
        CheckConstraint("NOT due_hard OR due IS NOT NULL", name="todo_hard_has_a_day"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    words: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )
    note: Mapped[str | None] = mapped_column(Text, index=True)
    shared_list: Mapped[str | None] = mapped_column(Text)
    project: Mapped[str | None] = mapped_column(Text)
    parent_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey(f"{SCHEMA}.todo.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    round_of: Mapped[str | None] = mapped_column(Text, index=True)
    """On a finished round of a repeating todo, the todo, which keeps its id and moves on."""
    epic: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    epic_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey(f"{SCHEMA}.todo.id", ondelete="SET NULL"), index=True
    )
    """The epic this todo counts toward, across projects; its parts count with it."""
    blocked_by: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )
    repeat: Mapped[str | None] = mapped_column(Text)
    on_completion: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(Text)
    planned: Mapped[date | None] = mapped_column(Date)
    """The day the owner means to do it; passing it makes nothing overdue."""
    hold_until: Mapped[date | None] = mapped_column(Date)
    """No list shows the todo before this day."""
    due: Mapped[date | None] = mapped_column(Date)
    due_hard: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    assignee: Mapped[str | None] = mapped_column(Text)
    waiting_on: Mapped[str | None] = mapped_column(Text)
    waiting_since: Mapped[date | None] = mapped_column(Date)
    look_again: Mapped[date | None] = mapped_column(Date)
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimate: Mapped[int | None] = mapped_column(Integer)
    worked: Mapped[int | None] = mapped_column(Integer)
    created: Mapped[date] = mapped_column(Date, nullable=False)
    done: Mapped[date | None] = mapped_column(Date)
    cancelled: Mapped[date | None] = mapped_column(Date)
    updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))


class TodoSession(Base):
    """One stretch of work on a todo; `ended` is None while the timer runs."""

    __tablename__ = "session"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    todo_id: Mapped[str] = mapped_column(
        Text, ForeignKey(f"{SCHEMA}.todo.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TodoChange(Base):
    """One write to a todo, the row before and after: the history the vault's jj repo kept.

    No foreign key, so a deleted todo keeps its history.
    """

    __tablename__ = "change"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    todo_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    by: Mapped[str] = mapped_column(Text, nullable=False)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
