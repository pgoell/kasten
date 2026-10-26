"""Add tax marks on bookings and the receipts kept beside the vault.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-26

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LINES = (
    "'werbungskosten', 'sonderausgaben', 'haushaltsnahe_dienste', 'handwerker',"
    " 'aussergewoehnliche_belastungen'"
)


def upgrade() -> None:
    """Make both tables empty: marks are set by hand, receipts come from the pane and the jobs."""
    op.create_table(
        "tax_mark",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("transaction_id", sa.BigInteger(), nullable=False),
        sa.Column("form_line", sa.Text(), nullable=False),
        sa.Column("tax_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("receipt_needed", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.CheckConstraint(f"form_line IN ({LINES})", name="tax_mark_form_line_check"),
        sa.CheckConstraint("tax_amount > 0", name="tax_mark_tax_amount_check"),
        sa.ForeignKeyConstraint(["transaction_id"], ["finance.transaction.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("transaction_id"),
        schema="finance",
    )
    op.create_table(
        "receipt",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("media_type", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column(
            "received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("transaction_id", sa.BigInteger(), nullable=True),
        sa.Column("dismissed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_error", sa.Text(), nullable=True),
        sa.Column("read_date", sa.Date(), nullable=True),
        sa.Column("read_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("read_payee", sa.Text(), nullable=True),
        sa.Column("read_labour", sa.Numeric(14, 2), nullable=True),
        sa.Column("read_line", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "media_type IN ('application/pdf', 'image/jpeg', 'image/png')",
            name="receipt_media_type_check",
        ),
        sa.CheckConstraint("source IN ('upload', 'capture', 'mail')", name="receipt_source_check"),
        sa.CheckConstraint(f"read_line IN ({LINES})", name="receipt_read_line_check"),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["finance.transaction.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sha256"),
        schema="finance",
    )
    op.create_index(
        "ix_finance_receipt_transaction_id", "receipt", ["transaction_id"], schema="finance"
    )


def downgrade() -> None:
    """Drop both tables. The files stay on disk."""
    op.drop_table("receipt", schema="finance")
    op.drop_table("tax_mark", schema="finance")
