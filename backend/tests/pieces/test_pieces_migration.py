"""Migration 0013 makes the pieces tables, their cascade and their BM25 indexes.

Runs against the migrated database at `KASTEN_DATABASE_URL`, each test in a
transaction rolled back after it, so nothing a test writes remains. A box with
no database, or one never migrated to 0013, skips rather than fails.
"""

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from kasten_backend.config import get_settings
from kasten_backend.pieces.models import Piece, PieceNote

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.engine import Connection

ZERO = [0.0] * 1024


@pytest.fixture
def connection() -> Iterator[Connection]:
    engine = create_engine(get_settings().database_url)
    try:
        connection = engine.connect()
    except OperationalError:
        engine.dispose()
        pytest.skip("No database answers at KASTEN_DATABASE_URL")
    if connection.scalar(text("SELECT to_regclass('public.pieces')")) is None:
        connection.close()
        engine.dispose()
        pytest.skip("No pieces table in the database: run `mise run db:migrate`")
    yield connection
    connection.rollback()
    connection.close()
    engine.dispose()


def add_note(connection: Connection, path: str, texts: list[str]) -> None:
    """A note row with one piece per text, written inside the test's transaction."""
    with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
        session.add(PieceNote(path=path, digest="0" * 64))
        # No relationship links the two models, so the unit of work would not
        # order the inserts: the note row goes first.
        session.flush()
        for n, body in enumerate(texts):
            session.add(
                Piece(
                    path=path,
                    n=n,
                    heading="",
                    digest="0" * 64,
                    text=body,
                    embedding=ZERO,
                )
            )
        # Commit releases the savepoint the session opened; leaving the block
        # without it would roll the rows back before the test reads them.
        session.commit()


def test_pieces_table_has_vector_and_bm25_indexes(connection: Connection) -> None:
    rows = connection.execute(
        text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pieces'")
    ).all()
    indexes = {row.indexname: row.indexdef for row in rows}
    assert "USING bm25" in indexes["pieces_text_german"]
    assert "USING bm25" in indexes["pieces_text_english"]

    embedding = connection.scalar(
        text(
            "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
            "WHERE attrelid = 'pieces'::regclass AND attname = 'embedding'"
        )
    )
    assert embedding == "vector(1024)"


def test_deleting_a_note_row_drops_its_pieces(connection: Connection) -> None:
    add_note(connection, "a.md", ["one", "two"])
    assert connection.scalar(text("SELECT count(*) FROM pieces WHERE path = 'a.md'")) == 2

    connection.execute(text("DELETE FROM piece_notes WHERE path = 'a.md'"))

    assert connection.scalar(text("SELECT count(*) FROM pieces WHERE path = 'a.md'")) == 0


def test_renaming_a_note_row_moves_its_pieces(connection: Connection) -> None:
    add_note(connection, "old.md", ["one", "two"])
    assert connection.scalar(text("SELECT count(*) FROM pieces WHERE path = 'old.md'")) == 2

    connection.execute(text("UPDATE piece_notes SET path = 'new.md' WHERE path = 'old.md'"))

    assert connection.scalar(text("SELECT count(*) FROM pieces WHERE path = 'new.md'")) == 2
    assert connection.scalar(text("SELECT count(*) FROM pieces WHERE path = 'old.md'")) == 0


def test_bm25_finds_a_german_stem(connection: Connection) -> None:
    add_note(connection, "de.md", ["Die Häuser sind teuer"])
    add_note(connection, "en.md", ["the houses are cheap"])

    german = connection.execute(
        text(
            "SELECT path, text <@> to_bm25query('Haus', 'pieces_text_german') AS score "
            "FROM pieces WHERE path IN ('de.md', 'en.md') ORDER BY score LIMIT 1"
        )
    ).one()
    assert german.path == "de.md"
    assert german.score < 0

    english = connection.execute(
        text(
            "SELECT path, text <@> to_bm25query('house', 'pieces_text_english') AS score "
            "FROM pieces WHERE path IN ('de.md', 'en.md') ORDER BY score LIMIT 1"
        )
    ).one()
    assert english.path == "en.md"
    assert english.score < 0
