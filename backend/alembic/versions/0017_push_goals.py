"""Push goals: the time a push goes for each log goal not met yet today.

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
    """Add the column, empty: no goals push until a time is saved."""
    op.add_column("push_settings", sa.Column("goals", sa.Time(), nullable=True))


def downgrade() -> None:
    """Drop it: the goals push stops."""
    op.drop_column("push_settings", "goals")
