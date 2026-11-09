"""Push settings: the morning push's time and the quiet hours, one row.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-09

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the table empty: no row means no morning push and no quiet hours."""
    op.create_table(
        "push_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("morning", sa.Time(), nullable=True),
        sa.Column("quiet_start", sa.Time(), nullable=True),
        sa.Column("quiet_end", sa.Time(), nullable=True),
        sa.CheckConstraint("id = 1", name="push_settings_one_row"),
    )


def downgrade() -> None:
    """Drop it: the morning push stops and a reminder goes at its time again."""
    op.drop_table("push_settings")
