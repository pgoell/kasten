"""Note pieces: a row a chunk of a note, with its bge-m3 vector and two BM25 indexes.

The tables are derived from the vault, so they can be dropped and rebuilt
from it at any time.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-29

"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

if TYPE_CHECKING:
    from collections.abc import Sequence

revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Make the tables empty: the indexer fills them from the vault."""
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_textsearch")
    op.create_table(
        "piece_notes",
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("path"),
    )
    op.create_table(
        "pieces",
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("n", sa.Integer(), nullable=False),
        sa.Column("heading", sa.Text(), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(1024), nullable=False),
        sa.ForeignKeyConstraint(
            ["path"], ["piece_notes.path"], ondelete="CASCADE", onupdate="CASCADE"
        ),
        sa.PrimaryKeyConstraint("path", "n"),
    )
    op.create_index("pieces_digest", "pieces", ["digest"])
    # Two indexes, one per stemmer: a German note and an English one each match
    # their own word forms. pg_textsearch takes the language at index time.
    op.execute(
        "CREATE INDEX pieces_text_german ON pieces USING bm25 (text) WITH (text_config = 'german')"
    )
    op.execute(
        "CREATE INDEX pieces_text_english ON pieces USING bm25 (text) "
        "WITH (text_config = 'english')"
    )


def downgrade() -> None:
    """Drop the tables, then the extensions they needed."""
    op.drop_table("pieces")
    op.drop_table("piece_notes")
    op.execute("DROP EXTENSION IF EXISTS pg_textsearch")
    op.execute("DROP EXTENSION IF EXISTS vector")
