"""Create the accounts, balances, transactions and splits.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AMOUNT = sa.Numeric(precision=14, scale=2)


def upgrade() -> None:
    """Make the four tables the ingest API writes."""
    op.create_table(
        "account",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("bank", sa.Text(), nullable=True),
        sa.Column("iban", sa.Text(), nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("shared", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.CheckConstraint("kind IN ('giro', 'saving', 'card', 'cash')", name="account_kind_check"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("iban"),
        sa.UniqueConstraint("name"),
        schema="finance",
    )
    op.create_table(
        "balance_snapshot",
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", AMOUNT, nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["finance.account.id"]),
        sa.PrimaryKeyConstraint("account_id", "date"),
        schema="finance",
    )
    op.create_table(
        "transaction",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("booking_date", sa.Date(), nullable=False),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("amount", AMOUNT, nullable=False),
        sa.Column("currency", sa.String(length=3), server_default="EUR", nullable=False),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("posting_text", sa.Text(), nullable=True),
        sa.Column("counterparty_name", sa.Text(), nullable=True),
        sa.Column("counterparty_iban", sa.Text(), nullable=True),
        sa.Column("bank_ref", sa.Text(), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("source_key", sa.Text(), nullable=False),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("transfer_group", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["finance.account.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "source_key", name="transaction_account_source_key"),
        schema="finance",
    )
    op.create_index(
        "transaction_account_booking_date",
        "transaction",
        ["account_id", "booking_date"],
        schema="finance",
    )
    op.create_table(
        "transaction_split",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("transaction_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", AMOUNT, nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transaction.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )
    op.create_index(
        "ix_finance_transaction_split_transaction_id",
        "transaction_split",
        ["transaction_id"],
        schema="finance",
    )


def downgrade() -> None:
    """Drop the four tables, and every finance row with them.

    Meant for a dev database. On prod these rows are the only copy, so restore
    from the dump rather than downgrade there.
    """
    op.drop_table("transaction_split", schema="finance")
    op.drop_table("transaction", schema="finance")
    op.drop_table("balance_snapshot", schema="finance")
    op.drop_table("account", schema="finance")
