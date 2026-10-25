"""Create categories, payees and rules, and give bookings and splits a category.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SET_BY = "category_set_by IN ('rule', 'hand')"
TOGETHER = "(category_id IS NULL) = (category_set_by IS NULL)"


def upgrade() -> None:
    """Make the three sorting tables and the category columns on bookings and splits."""
    op.create_table(
        "category",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('fixed', 'flexible', 'non_monthly', 'income', 'saving', 'ignore')",
            name="category_kind_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
        schema="finance",
    )
    op.create_table(
        "payee",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["category_id"], ["finance.category.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
        schema="finance",
    )
    op.create_table(
        "rule",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("pattern", sa.Text(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.CheckConstraint("kind IN ('text_contains', 'payee')", name="rule_kind_check"),
        sa.ForeignKeyConstraint(["category_id"], ["finance.category.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "pattern", name="rule_kind_pattern"),
        schema="finance",
    )
    for table, payee in (("transaction", True), ("transaction_split", False)):
        if payee:
            op.add_column(table, sa.Column("payee_id", sa.Integer()), schema="finance")
            op.create_foreign_key(
                f"{table}_payee_id_fkey",
                table,
                "payee",
                ["payee_id"],
                ["id"],
                source_schema="finance",
                referent_schema="finance",
            )
        op.add_column(table, sa.Column("category_id", sa.Integer()), schema="finance")
        op.add_column(table, sa.Column("category_set_by", sa.Text()), schema="finance")
        op.create_foreign_key(
            f"{table}_category_id_fkey",
            table,
            "category",
            ["category_id"],
            ["id"],
            source_schema="finance",
            referent_schema="finance",
        )
        op.create_check_constraint(f"{table}_set_by_check", table, SET_BY, schema="finance")
        op.create_check_constraint(f"{table}_category_set_by", table, TOGETHER, schema="finance")


def downgrade() -> None:
    """Drop the sorting tables and columns, and every category with them."""
    for table in ("transaction_split", "transaction"):
        op.drop_constraint(f"{table}_category_set_by", table, schema="finance", type_="check")
        op.drop_constraint(f"{table}_set_by_check", table, schema="finance", type_="check")
        op.drop_constraint(f"{table}_category_id_fkey", table, schema="finance", type_="foreignkey")
        op.drop_column(table, "category_set_by", schema="finance")
        op.drop_column(table, "category_id", schema="finance")
    op.drop_constraint(
        "transaction_payee_id_fkey", "transaction", schema="finance", type_="foreignkey"
    )
    op.drop_column("transaction", "payee_id", schema="finance")
    op.drop_table("rule", schema="finance")
    op.drop_table("payee", schema="finance")
    op.drop_table("category", schema="finance")
