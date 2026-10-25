"""The plan and goal tables: expected bookings, which real booking each one met, and saving goals.

docs/reference/budget-model.md says how the budget reads them. A plan's
matches are stored, so a read never re-decides which booking paid a bill.
"""

import datetime as dt  # noqa: TC003  SQLAlchemy reads the annotation at runtime
from decimal import Decimal  # noqa: TC003  SQLAlchemy reads the annotation at runtime

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Identity, Text, literal_column
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base
from kasten_backend.finance_models import SCHEMA, Account, Amount, Category, Payee, Transaction


class Plan(Base):
    """An expected booking: rent on the 1st, insurance once a year, a known trip in March.

    `every_months` is the months between two dates it falls due, 1 for
    monthly and 12 for yearly; none for a plan that falls due once, on
    `start_date`. Every later date keeps the day of `start_date`, or the last
    day of a shorter month.
    """

    __tablename__ = "plan"
    __table_args__ = (
        CheckConstraint("payee_id IS NOT NULL OR text IS NOT NULL", name="plan_matches_something"),
        CheckConstraint("every_months IS NULL OR every_months >= 1", name="plan_every_check"),
        CheckConstraint("tolerance >= 0", name="plan_tolerance_check"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="plan_end_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    # The account it is paid from or into, which gives the plan its scope.
    account_id: Mapped[int] = mapped_column(ForeignKey(Account.id))
    payee_id: Mapped[int | None] = mapped_column(ForeignKey(Payee.id))
    # Matched case-insensitively inside the booking's purpose or counterparty name.
    text: Mapped[str | None] = mapped_column(Text)
    # Signed like a booking: a cost is negative.
    amount: Mapped[Decimal] = mapped_column(Amount)
    tolerance: Mapped[Decimal] = mapped_column(Amount, server_default=literal_column("0"))
    every_months: Mapped[int | None]
    category_id: Mapped[int | None] = mapped_column(ForeignKey(Category.id, ondelete="SET NULL"))
    start_date: Mapped[dt.date] = mapped_column(Date)
    end_date: Mapped[dt.date | None] = mapped_column(Date)


class PlanMatch(Base):
    """The booking that met a plan in one period, the first of the month it fell due in."""

    __tablename__ = "plan_match"
    __table_args__ = ({"schema": SCHEMA},)

    plan_id: Mapped[int] = mapped_column(ForeignKey(Plan.id, ondelete="CASCADE"), primary_key=True)
    period: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    # Unique: one booking pays one plan once.
    transaction_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(Transaction.id, ondelete="CASCADE"), unique=True
    )


class Goal(Base):
    """An amount by a date, held as a reserved share of one own saving account's balance.

    `reserved` is what the owner assigned of the balance; `monthly` the
    contribution they plan, which comes off free to spend while the month runs.
    """

    __tablename__ = "goal"
    __table_args__ = (
        CheckConstraint("target > 0", name="goal_target_check"),
        CheckConstraint("reserved >= 0", name="goal_reserved_check"),
        CheckConstraint("monthly IS NULL OR monthly >= 0", name="goal_monthly_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    target: Mapped[Decimal] = mapped_column(Amount)
    due: Mapped[dt.date] = mapped_column(Date)
    account_id: Mapped[int] = mapped_column(ForeignKey(Account.id))
    reserved: Mapped[Decimal] = mapped_column(Amount, server_default=literal_column("0"))
    monthly: Mapped[Decimal | None] = mapped_column(Amount)
