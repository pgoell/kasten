"""Create the finance schema.

Revision ID: 0001
Revises:
Create Date: 2026-10-25

"""

from typing import TYPE_CHECKING

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the schema the finance tables will live in.

    Autogenerate never writes CREATE SCHEMA, so the schema is made by hand
    before the first table names it.
    """
    op.execute("CREATE SCHEMA IF NOT EXISTS finance")


def downgrade() -> None:
    """Drop the schema, which must be empty by then.

    No CASCADE: a downgrade that would take finance rows with it should fail
    loudly rather than empty the schema.
    """
    op.execute("DROP SCHEMA finance")
