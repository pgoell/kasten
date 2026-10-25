"""Add the budget: category limits over time, the salary setting, ignore rules on both sides.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the limits and settings, mark Salary as salary, and let ignore rules sort both sides.

    The rules are not run here: `POST /api/finance/rules/run` after the deploy
    sorts the money in an ignore rule now reaches.
    """
    op.create_table(
        "category_limit",
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=True),
        sa.CheckConstraint("extract(day from month) = 1", name="category_limit_first_of_month"),
        sa.CheckConstraint("amount >= 0", name="category_limit_amount_check"),
        sa.ForeignKeyConstraint(["category_id"], ["finance.category.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("category_id", "month"),
        schema="finance",
    )
    op.create_table(
        "budget_settings",
        sa.Column("id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("salary_cutoff_day", sa.Integer(), server_default=sa.text("15"), nullable=False),
        sa.CheckConstraint("id = 1", name="budget_settings_one_row"),
        sa.CheckConstraint(
            "salary_cutoff_day BETWEEN 1 AND 31", name="budget_settings_cutoff_check"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )
    op.execute("INSERT INTO finance.budget_settings DEFAULT VALUES")
    op.create_index(
        "transaction_transfer_group",
        "transaction",
        ["transfer_group"],
        schema="finance",
        postgresql_where=sa.text("transfer_group IS NOT NULL"),
    )
    op.add_column(
        "category",
        sa.Column("salary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema="finance",
    )
    # The Firefly import made one income category for pay; it starts as the salary.
    op.execute(
        "UPDATE finance.category SET salary = true WHERE kind = 'income' AND name = 'Salary'"
    )
    op.drop_constraint("rule_side_check", "rule", schema="finance")
    op.create_check_constraint(
        "rule_side_check", "rule", "side IN ('in', 'out', 'both')", schema="finance"
    )
    op.execute(
        "UPDATE finance.rule r SET side = 'both' FROM finance.category c "
        "WHERE c.id = r.category_id AND c.kind = 'ignore'"
    )


def downgrade() -> None:
    """Back to rules on one side, ignore rules on money out; the limits and settings go.

    An ignore rule whose pattern a spending rule of its kind also holds fails here, on
    the unique kind, pattern and side.
    """
    op.execute("UPDATE finance.rule SET side = 'out' WHERE side = 'both'")
    op.drop_constraint("rule_side_check", "rule", schema="finance")
    op.create_check_constraint("rule_side_check", "rule", "side IN ('in', 'out')", schema="finance")
    op.drop_column("category", "salary", schema="finance")
    op.drop_index("transaction_transfer_group", "transaction", schema="finance")
    op.drop_table("budget_settings", schema="finance")
    op.drop_table("category_limit", schema="finance")
