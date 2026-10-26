"""Index bookings by payee, which the payee drilldown filters on.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-26

"""

from typing import TYPE_CHECKING

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the index; it holds no data of its own."""
    op.create_index("transaction_payee", "transaction", ["payee_id"], schema="finance")


def downgrade() -> None:
    """Drop the index."""
    op.drop_index("transaction_payee", table_name="transaction", schema="finance")
