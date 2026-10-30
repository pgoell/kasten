"""The pieces index rides out a database that goes away and comes back.

A `Flaky` factory stands in for a database that fails a set number of times,
and an injected wait records each pause, so the backoff is counted, not timed.
"""

import asyncio
import logging
import time
from typing import TYPE_CHECKING

import psycopg
import psycopg.errors
from sqlalchemy.exc import OperationalError

from .test_indexer import FakeModel, _make, _rows, _settled, _until, _write  # noqa: TID252

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


class Flaky:
    """Sessions from `real`, except that the next `failures` calls raise `error`."""

    def __init__(self, real: async_sessionmaker[AsyncSession]) -> None:
        self.real = real
        self.failures = 0
        self.error: Exception = OperationalError(
            "SELECT 1", {}, psycopg.OperationalError("connection refused")
        )

    def __call__(self) -> AsyncSession:
        if self.failures:
            self.failures -= 1
            raise self.error
        return self.real()


async def test_a_save_after_the_database_comes_back_lands_in_the_index(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    flaky = Flaky(sessions)
    made = _make(FakeModel(), tmp_path, flaky)  # ty: ignore[invalid-argument-type]
    waits: list[float] = []

    async def wait(seconds: float) -> None:
        waits.append(seconds)
        await asyncio.sleep(0)

    made._wait = wait  # ty: ignore[unresolved-attribute]
    running = asyncio.create_task(made.run())

    async def paths() -> list[str]:
        return sorted({row[0] for row in await _rows(sessions)})

    def saved(path: str):
        async def check() -> bool:
            # Written again on each look: the watcher may not be up for the first.
            _write(tmp_path, path, f"words at {time.monotonic()}")
            return path in await paths()

        return check

    try:
        await _until(lambda: _settled(made))
        with caplog.at_level(logging.INFO):
            flaky.failures = 3
            await _until(saved("during.md"))
            assert flaky.failures == 0
            await _until(saved("after.md"))
        assert waits == [1, 2, 4]
        assert await paths() == ["after.md", "during.md"]
        assert not running.done()
    finally:
        running.cancel()
