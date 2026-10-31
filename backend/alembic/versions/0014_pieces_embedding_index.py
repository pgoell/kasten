"""An HNSW index on the pieces' vectors, so the nearest pieces need no scan of every row.

Derived like the table it indexes: dropping it loses nothing. Measured in
the-pieces-index.md: the build takes 1.3 s and 51 MB on 6,562 pieces.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-31

"""

from typing import TYPE_CHECKING

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Build the index; the indexer's writes wait for it, reads do not."""
    # pgvector's defaults, written out so a change to them shows in a diff.
    op.execute(
        "CREATE INDEX pieces_embedding ON pieces "
        "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"
    )


def downgrade() -> None:
    """Drop the index; the vector query falls back to scanning every row."""
    op.drop_index("pieces_embedding", table_name="pieces")
