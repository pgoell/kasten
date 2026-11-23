"""A description on each todo: free text under its words, holding the notes it links to.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-22

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the column, empty on every todo."""
    op.add_column("todo", sa.Column("description", sa.Text(), nullable=True), schema="todos")


def downgrade() -> None:
    """Drop it; the descriptions go with it."""
    op.drop_column("todo", "description", schema="todos")
