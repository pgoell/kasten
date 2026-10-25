"""The budget's settings: each category's monthly limit over time, and the salary cutoff.

Settings, not code, so the budget can change without a release. A limit is a
row per month it takes effect from, so a new limit leaves the months before
reading as they did. See docs/reference/budget-model.md.
"""

import datetime as dt  # noqa: TC003  SQLAlchemy reads the annotation at runtime
from decimal import Decimal  # noqa: TC003  SQLAlchemy reads the annotation at runtime

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, text
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base
from kasten_backend.finance_models import SCHEMA, Amount, Category

CUTOFF_DAY = 15
"""The cutoff a new database starts with: a salary after the 15th counts for the next month."""


class CategoryLimit(Base):
    """A category's monthly limit from `month` on, until a later row. No amount: no limit."""

    __tablename__ = "category_limit"
    __table_args__ = (
        CheckConstraint("extract(day from month) = 1", name="category_limit_first_of_month"),
        CheckConstraint("amount >= 0", name="category_limit_amount_check"),
        {"schema": SCHEMA},
    )

    category_id: Mapped[int] = mapped_column(
        ForeignKey(Category.id, ondelete="CASCADE"), primary_key=True
    )
    # The first of the month the limit takes effect from.
    month: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    amount: Mapped[Decimal | None] = mapped_column(Amount)


class BudgetSettings(Base):
    """The one row of budget settings. Which income counts as salary is on each category."""

    __tablename__ = "budget_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="budget_settings_one_row"),
        CheckConstraint("salary_cutoff_day BETWEEN 1 AND 31", name="budget_settings_cutoff_check"),
        {"schema": SCHEMA},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, server_default=text("1"))
    salary_cutoff_day: Mapped[int] = mapped_column(server_default=text(str(CUTOFF_DAY)))
