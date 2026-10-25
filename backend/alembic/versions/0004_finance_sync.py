"""Create the sync requests and runs the bank job records.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the three tables behind "pull now" and the sync status."""
    op.create_table(
        "sync_run",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column("trigger", sa.Text(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.CheckConstraint("trigger IN ('request', 'scheduled')", name="sync_run_trigger_check"),
        sa.CheckConstraint("outcome IN ('ok', 'failed')", name="sync_run_outcome_check"),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )
    op.create_table(
        "sync_request",
        sa.Column("id", sa.Integer(), sa.Identity(always=False), nullable=False),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["finance.sync_run.id"]),
        sa.PrimaryKeyConstraint("id"),
        schema="finance",
    )
    op.create_table(
        "sync_run_account",
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("fetched_from", sa.Date(), nullable=False),
        sa.Column("fetched_through", sa.Date(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("created", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("skipped", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.CheckConstraint("outcome IN ('ok', 'failed')", name="sync_run_account_outcome_check"),
        sa.ForeignKeyConstraint(["account_id"], ["finance.account.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["finance.sync_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id", "account_id"),
        schema="finance",
    )


def downgrade() -> None:
    """Drop the three tables and the sync history with them."""
    op.drop_table("sync_run_account", schema="finance")
    op.drop_table("sync_request", schema="finance")
    op.drop_table("sync_run", schema="finance")
