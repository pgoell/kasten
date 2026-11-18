"""Todo rounds: a finished round of a repeating todo names the todo it was a round of.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-18

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the column, empty: the import knows no rounds, only lines."""
    op.add_column("todo", sa.Column("round_of", sa.Text(), nullable=True), schema="todos")
    op.create_index("ix_todos_todo_round_of", "todo", ["round_of"], schema="todos")


def downgrade() -> None:
    """Drop it: each finished round stays a done todo, no longer tied to its series."""
    op.drop_index("ix_todos_todo_round_of", table_name="todo", schema="todos")
    op.drop_column("todo", "round_of", schema="todos")
