"""Give each rule the side of the bookings it sorts, and let a pattern repeat once per side.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add `side` from each rule's category kind, and make it part of the rule's key."""
    op.add_column(
        "rule", sa.Column("side", sa.Text(), server_default="out", nullable=False), schema="finance"
    )
    op.execute(
        "UPDATE finance.rule r SET side = 'in' FROM finance.category c "
        "WHERE c.id = r.category_id AND c.kind = 'income'"
    )
    op.alter_column("rule", "side", server_default=None, schema="finance")
    op.create_check_constraint("rule_side_check", "rule", "side IN ('in', 'out')", schema="finance")
    op.drop_constraint("rule_kind_pattern", "rule", schema="finance")
    op.create_unique_constraint(
        "rule_kind_pattern_side", "rule", ["kind", "pattern", "side"], schema="finance"
    )


def downgrade() -> None:
    """Back to one rule per kind and pattern; a pattern kept on both sides fails here."""
    op.drop_constraint("rule_kind_pattern_side", "rule", schema="finance")
    op.create_unique_constraint("rule_kind_pattern", "rule", ["kind", "pattern"], schema="finance")
    op.drop_constraint("rule_side_check", "rule", schema="finance")
    op.drop_column("rule", "side", schema="finance")
