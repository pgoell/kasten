"""Push timers: a label pushed at a time, once or on repeat.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-09

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0017"
down_revision: str | Sequence[str] | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the table empty: a timer starts from the Today page."""
    op.create_table(
        "push_timers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("due", sa.DateTime(timezone=True), nullable=False),
        sa.Column("every", sa.Integer(), nullable=True),
        sa.Column("until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_push_timers_due", "push_timers", ["due"])


def downgrade() -> None:
    """Drop it: a running timer is lost and rings nowhere."""
    op.drop_index("ix_push_timers_due", table_name="push_timers")
    op.drop_table("push_timers")
