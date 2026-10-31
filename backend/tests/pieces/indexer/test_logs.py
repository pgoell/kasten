"""The pieces index logs a database fault without the statement, its values or the failing row.

Those carry a note's text and vectors, which stay out of the backend log (#1388).
"""

import logging
from typing import TYPE_CHECKING

import psycopg.errors
import pytest
from sqlalchemy.exc import DataError, IntegrityError, StatementError

from backend.tests.pieces.indexer.test_indexer import FakeModel, _make, _rows, _write
from kasten_backend.pieces.indexer import Indexer

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

INSERT = "INSERT INTO pieces (path, n, heading, digest, text, embedding) VALUES (%(text)s)"


@pytest.mark.parametrize(
    "error",
    [
        DataError(INSERT, {"text": "private words"}, psycopg.errors.DataError("bad")),
        IntegrityError(
            INSERT,
            {"text": "private words"},
            psycopg.errors.NotNullViolation(
                'null value in column "heading" violates not-null constraint\n'
                "DETAIL:  Failing row contains (a.md, 0, null, private words)."
            ),
        ),
        StatementError("bind failed", INSERT, {"text": "private words"}, ValueError("bad")),
    ],
)
async def test_a_note_skipped_on_a_database_error_logs_only_the_drivers_first_line(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    error: Exception,
) -> None:
    async def fails(_self: Indexer, _path: str) -> None:
        raise error

    monkeypatch.setattr(Indexer, "_index", fails)
    made = Indexer(tmp_path, None, FakeModel, None)  # ty: ignore[invalid-argument-type]
    with caplog.at_level(logging.WARNING):
        await made.index("a.md")
    assert "skips a.md" in caplog.text
    assert "private words" not in caplog.text
    assert "INSERT" not in caplog.text


async def test_a_note_postgres_refuses_is_skipped_without_its_text_in_the_log(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    # Postgres text takes no NUL byte, so the insert of the pieces fails in the driver.
    _write(tmp_path, "a.md", "private\x00words")
    made = _make(FakeModel(), tmp_path, sessions)
    with caplog.at_level(logging.WARNING):
        await made.index("a.md")
    assert "skips a.md" in caplog.text
    assert "private" not in caplog.text
    assert await _rows(sessions) == []
