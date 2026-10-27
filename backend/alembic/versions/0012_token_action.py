"""Record what each agent token does, one row a request.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-27

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the table empty: rows come from the requests the agents make."""
    op.create_table(
        "token_action",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("client", sa.Text(), nullable=True),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("tool", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "outcome IN ('ok', 'error', 'revoked')", name="token_action_outcome_check"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_token_action_token_at", "token_action", ["token", "at"])
    op.create_index("ix_token_action_at", "token_action", ["at"])


def downgrade() -> None:
    """Drop the table, and every row the agents' activity left in it."""
    op.drop_table("token_action")
