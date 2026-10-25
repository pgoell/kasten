"""Add plans, the bookings that matched them, saving goals and the leftovers moved into them.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the four tables empty: plans come from the owner confirming proposals."""
    op.create_table(
        "plan",
        sa.Column("id", sa.Integer(), sa.Identity(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("payee_id", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("tolerance", sa.Numeric(14, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("every_months", sa.Integer(), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("confirmed", sa.Date(), nullable=False),
        sa.CheckConstraint(
            "payee_id IS NOT NULL OR text IS NOT NULL", name="plan_matches_something"
        ),
        sa.CheckConstraint("every_months IS NULL OR every_months >= 1", name="plan_every_check"),
        sa.CheckConstraint("tolerance >= 0", name="plan_tolerance_check"),
        sa.CheckConstraint("end_date IS NULL OR end_date >= start_date", name="plan_end_check"),
        sa.ForeignKeyConstraint(["account_id"], ["finance.account.id"]),
        sa.ForeignKeyConstraint(["payee_id"], ["finance.payee.id"]),
        sa.ForeignKeyConstraint(["category_id"], ["finance.category.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )
    op.create_table(
        "plan_match",
        sa.Column("plan_id", sa.Integer(), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("transaction_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["plan_id"], ["finance.plan.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transaction.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("plan_id", "period"),
        sa.UniqueConstraint("transaction_id"),
        schema="finance",
    )
    op.create_table(
        "goal",
        sa.Column("id", sa.Integer(), sa.Identity(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("target", sa.Numeric(14, 2), nullable=False),
        sa.Column("due", sa.Date(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("reserved", sa.Numeric(14, 2), server_default=sa.text("0"), nullable=False),
        sa.Column("monthly", sa.Numeric(14, 2), nullable=True),
        sa.Column("assigned_month", sa.Date(), nullable=True),
        sa.Column("assigned_amount", sa.Numeric(14, 2), nullable=True),
        sa.CheckConstraint("target > 0", name="goal_target_check"),
        sa.CheckConstraint("reserved >= 0", name="goal_reserved_check"),
        sa.CheckConstraint("monthly IS NULL OR monthly >= 0", name="goal_monthly_check"),
        sa.ForeignKeyConstraint(["account_id"], ["finance.account.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )
    op.create_table(
        "goal_leftover",
        sa.Column("id", sa.Integer(), sa.Identity(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.CheckConstraint("amount > 0", name="goal_leftover_amount_check"),
        sa.CheckConstraint("extract(day from month) = 1", name="goal_leftover_first_of_month"),
        sa.ForeignKeyConstraint(["goal_id"], ["finance.goal.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )


def downgrade() -> None:
    """Drop the four tables, and every plan, match, goal and leftover moved with them."""
    op.drop_table("goal_leftover", schema="finance")
    op.drop_table("goal", schema="finance")
    op.drop_table("plan_match", schema="finance")
    op.drop_table("plan", schema="finance")
