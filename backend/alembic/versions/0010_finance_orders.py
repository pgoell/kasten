"""Add PayPal and Amazon orders, their charges and refunds, and the items each charge holds.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-26

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the three tables empty: orders come from the order mail job."""
    op.create_table(
        "shop_order",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("order_key", sa.Text(), nullable=False),
        sa.Column("ordered_on", sa.Date(), nullable=False),
        sa.Column("merchant", sa.Text(), nullable=False),
        sa.Column("total", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency", sa.String(3), server_default="EUR", nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("source IN ('amazon', 'paypal')", name="shop_order_source_check"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "order_key", name="shop_order_source_key"),
        schema="finance",
    )
    op.create_table(
        "order_charge",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("charged_on", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("transaction_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.Text(), server_default="waiting", nullable=False),
        sa.CheckConstraint("kind IN ('charge', 'refund')", name="order_charge_kind_check"),
        sa.CheckConstraint(
            "status IN ('waiting', 'ambiguous', 'items_off', 'split', 'kept', 'unsplit', 'linked')",
            name="order_charge_status_check",
        ),
        sa.CheckConstraint("amount > 0", name="order_charge_amount_check"),
        sa.ForeignKeyConstraint(["order_id"], ["finance.shop_order.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["finance.transaction.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_id", "kind", "key", name="order_charge_order_kind_key"),
        sa.UniqueConstraint("transaction_id", name="order_charge_transaction"),
        schema="finance",
    )
    op.create_index(
        "ix_finance_order_charge_order_id", "order_charge", ["order_id"], schema="finance"
    )
    op.create_table(
        "order_item",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("charge_id", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.ForeignKeyConstraint(["charge_id"], ["finance.order_charge.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )
    op.create_index(
        "ix_finance_order_item_charge_id", "order_item", ["charge_id"], schema="finance"
    )


def downgrade() -> None:
    """Drop the three tables, the items first."""
    op.drop_table("order_item", schema="finance")
    op.drop_table("order_charge", schema="finance")
    op.drop_table("shop_order", schema="finance")
