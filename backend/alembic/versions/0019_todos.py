"""Todos: the store that replaces todo lines in the vault, its sessions and its history.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-18

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "todos"


def upgrade() -> None:
    """Make the schema empty: the import fills it from the vault's lines."""
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    op.create_table(
        "todo",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("words", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("tags", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("shared_list", sa.Text(), nullable=True),
        sa.Column("project", sa.Text(), nullable=True),
        sa.Column(
            "parent_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.todo.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blocked_by", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("repeat", sa.Text(), nullable=True),
        sa.Column("on_completion", sa.Text(), nullable=True),
        sa.Column("priority", sa.Text(), nullable=True),
        sa.Column("from_day", sa.Date(), nullable=True),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("deadline_hard", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("assignee", sa.Text(), nullable=True),
        sa.Column("waiting_on", sa.Text(), nullable=True),
        sa.Column("waiting_since", sa.Date(), nullable=True),
        sa.Column("look_again", sa.Date(), nullable=True),
        sa.Column("remind_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("estimate", sa.Integer(), nullable=True),
        sa.Column("worked", sa.Integer(), nullable=True),
        sa.Column("created", sa.Date(), nullable=False),
        sa.Column("done", sa.Date(), nullable=True),
        sa.Column("cancelled", sa.Date(), nullable=True),
        sa.Column(
            "updated", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint(
            "state IN ('open', 'doing', 'review', 'done', 'blocked', 'waiting', 'rejected')",
            name="todo_state",
        ),
        sa.CheckConstraint(
            "priority IS NULL OR priority IN ('highest', 'high', 'medium', 'low', 'lowest')",
            name="todo_priority",
        ),
        sa.CheckConstraint("NOT deadline_hard OR deadline IS NOT NULL", name="todo_hard_has_a_day"),
        schema=SCHEMA,
    )
    op.create_index("ix_todos_todo_note", "todo", ["note"], schema=SCHEMA)
    op.create_index("ix_todos_todo_parent_id", "todo", ["parent_id"], schema=SCHEMA)
    op.create_table(
        "session",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "todo_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.todo.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("started", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.create_index("ix_todos_session_todo_id", "session", ["todo_id"], schema=SCHEMA)
    op.create_table(
        "change",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("todo_id", sa.Text(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("by", sa.Text(), nullable=False),
        sa.Column("before", postgresql.JSONB(), nullable=True),
        sa.Column("after", postgresql.JSONB(), nullable=True),
        schema=SCHEMA,
    )
    op.create_index("ix_todos_change_todo_id", "change", ["todo_id"], schema=SCHEMA)


def downgrade() -> None:
    """Drop the schema: every todo, session and change in it is lost, so dump it first."""
    op.execute(f"DROP SCHEMA {SCHEMA} CASCADE")
