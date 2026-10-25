"""Add rsvp_places, the reading place of each file an RSVP run stopped in.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the table."""
    op.create_table(
        "rsvp_places",
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("word", sa.Integer(), nullable=False),
        sa.Column("words", sa.Integer(), nullable=False),
        sa.Column("anchor", sa.Text(), nullable=False),
        sa.Column(
            "updated",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("path"),
    )


def downgrade() -> None:
    """Drop the table, and every reading place with it."""
    op.drop_table("rsvp_places")
