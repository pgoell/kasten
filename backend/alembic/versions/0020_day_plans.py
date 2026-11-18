"""Day plans: a day's blocks and the todos picked for them, and the week's outcomes (#2191).

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

SCHEMA = "todos"


def upgrade() -> None:
    """Make the tables, empty: no plan was saved before them."""
    op.create_table(
        "plan",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column(
            "saved", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("by", sa.Text(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "block",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "day",
            sa.Date(),
            sa.ForeignKey(f"{SCHEMA}.plan.day", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("starts", sa.Time(), nullable=False),
        sa.Column("ends", sa.Time(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.CheckConstraint("kind IN ('focus', 'batch')", name="block_kind"),
        sa.CheckConstraint("ends > starts", name="block_ends_after_it_starts"),
        schema=SCHEMA,
    )
    op.create_index("ix_todos_block_day", "block", ["day"], schema=SCHEMA)
    op.create_table(
        "pick",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "block_id",
            sa.Integer(),
            sa.ForeignKey(f"{SCHEMA}.block.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("todo_id", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        schema=SCHEMA,
    )
    op.create_index("ix_todos_pick_block_id", "pick", ["block_id"], schema=SCHEMA)
    op.create_index("ix_todos_pick_todo_id", "pick", ["todo_id"], schema=SCHEMA)
    op.create_table(
        "outcome",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("week", sa.Date(), nullable=False),
        sa.Column("words", sa.Text(), nullable=False),
        sa.Column("todo_id", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        schema=SCHEMA,
    )
    op.create_index("ix_todos_outcome_week", "outcome", ["week"], schema=SCHEMA)


def downgrade() -> None:
    """Drop them: every saved plan and outcome is lost, so dump the schema first."""
    for table in ("outcome", "pick", "block", "plan"):
        op.drop_table(table, schema=SCHEMA)
