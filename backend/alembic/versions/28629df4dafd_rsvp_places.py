"""Add rsvp_places, the reading place of each file an RSVP run stopped in.

Revision ID: 28629df4dafd
Revises:
Create Date: 2026-10-25 17:55:53.769918

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "28629df4dafd"
down_revision: str | Sequence[str] | None = None
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
