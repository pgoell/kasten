"""The day plan and the week's outcomes (#2191): blocks of a day, the todos picked for each.

A pick sets the todo's planned date and nothing else; the rows stay, so "picked n times,
never done" is a count over them.
"""

from datetime import date, datetime, time  # noqa: TC003  SQLAlchemy reads `Mapped[...]` at runtime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base
from kasten_backend.todos.store.models import SCHEMA

KINDS = ("focus", "batch")


class DayPlan(Base):
    """One day's plan; saving it again replaces its blocks."""

    __tablename__ = "plan"
    __table_args__ = ({"schema": SCHEMA},)

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    saved: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    by: Mapped[str] = mapped_column(Text, nullable=False)


class PlanBlock(Base):
    """A stretch of the day, focus or batch, in order."""

    __tablename__ = "block"
    __table_args__ = (
        CheckConstraint("kind IN ('focus', 'batch')", name="block_kind"),
        CheckConstraint("ends > starts", name="block_ends_after_it_starts"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day: Mapped[date] = mapped_column(
        Date, ForeignKey(f"{SCHEMA}.plan.day", ondelete="CASCADE"), nullable=False, index=True
    )
    starts: Mapped[time] = mapped_column(Time, nullable=False)
    ends: Mapped[time] = mapped_column(Time, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)


class PlanPick(Base):
    """A todo picked for a block, in order. No key to the todo, so a deleted todo's picks stay."""

    __tablename__ = "pick"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    block_id: Mapped[int] = mapped_column(
        Integer, ForeignKey(f"{SCHEMA}.block.id", ondelete="CASCADE"), nullable=False, index=True
    )
    todo_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class Outcome(Base):
    """One of a week's outcomes, five at most, and the todo that carries it, if any."""

    __tablename__ = "outcome"
    __table_args__ = ({"schema": SCHEMA},)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    """The Monday the week starts on."""
    words: Mapped[str] = mapped_column(Text, nullable=False)
    todo_id: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
