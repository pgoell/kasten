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
import pytest
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from backend.tests.pieces.test_indexer import FakeModel, _make, _rows, _settled, _until, _write
from kasten_backend.pieces.embed import model_thread
from kasten_backend.pieces.indexer import Indexer

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession


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

    made._wait = wait
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


def _failing(orig: Exception) -> OperationalError:
    return OperationalError("SELECT 1", {}, orig)


async def _warm(made: Indexer, root: Path, sessions: async_sessionmaker[AsyncSession]) -> None:
    """Settle the first sweep, then index one save, so the watcher is surely up."""
    await _until(lambda: _settled(made))
    await _until(_saving(root, sessions, "warm.md"))


def _saving(root: Path, sessions: async_sessionmaker[AsyncSession], path: str):
    async def check() -> bool:
        # Written again on each look: the watcher may not be up for the first.
        _write(root, path, f"words at {time.monotonic()}")
        return path in {row[0] for row in await _rows(sessions)}

    return check


async def test_saves_during_the_outage_stay_queued_and_the_failed_note_comes_back_by_the_sweep(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    flaky = Flaky(sessions)
    up = asyncio.Event()
    waits: list[float] = []

    async def wait(seconds: float) -> None:
        waits.append(seconds)
        await up.wait()

    made = Indexer(tmp_path, flaky, FakeModel, model_thread())  # ty: ignore[invalid-argument-type]
    made._wait = wait
    running = asyncio.create_task(made.run())
    try:
        await _warm(made, tmp_path, sessions)
        flaky.failures = 10**6
        _write(tmp_path, "failed.md", "the failed words")
        await _until(lambda: _true(bool(waits)))
        _write(tmp_path, "queued.md", "the queued words")
        await _until(lambda: _true("queued.md" in made._changed))
        # The watcher may report one write twice; drop the second so only the sweep can help.
        made._changed.pop("failed.md", None)
        flaky.failures = 0
        up.set()

        async def landed() -> bool:
            texts = {row[0]: row[4] for row in await _rows(sessions)}
            return "the failed words" in texts.get("failed.md", "") and "queued.md" in texts

        await _until(landed)
    finally:
        running.cancel()


async def _true(value: bool) -> bool:
    return value


async def test_the_wait_doubles_to_a_cap_starts_over_after_a_recovery_and_logs_two_lines(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    flaky = Flaky(sessions)
    waits: list[float] = []
    busy = most = 0

    async def wait(seconds: float) -> None:
        assert busy == 0
        waits.append(seconds)
        await asyncio.sleep(0)

    made = Indexer(tmp_path, flaky, FakeModel, model_thread())  # ty: ignore[invalid-argument-type]

    made._wait = wait

    def alone(step):
        async def counted(*args: str) -> None:
            nonlocal busy, most
            busy += 1
            most = max(most, busy)
            try:
                await step(*args)
            finally:
                busy -= 1

        return counted

    made._stale = alone(made._stale)
    made.index = alone(made.index)
    running = asyncio.create_task(made.run())
    try:
        await _warm(made, tmp_path, sessions)
        with caplog.at_level(logging.WARNING):
            flaky.failures = 9
            await _until(_saving(tmp_path, sessions, "first.md"))
            assert waits == [1, 2, 4, 8, 16, 32, 60, 60, 60]
            flaky.failures = 1
            await _until(_saving(tmp_path, sessions, "second.md"))
            assert waits[9:] == [1]
        assert caplog.text.count("waits for its database") == 2
        assert caplog.text.count("resumes after") == 2
        assert most == 1
    finally:
        running.cancel()


async def test_shutdown_ends_while_waiting_to_retry(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    flaky = Flaky(sessions)
    flaky.failures = 10**6
    waiting = asyncio.Event()

    async def wait(_seconds: float) -> None:
        waiting.set()
        await asyncio.Event().wait()

    made = Indexer(tmp_path, flaky, FakeModel, model_thread())  # ty: ignore[invalid-argument-type]
    made._wait = wait
    running = asyncio.create_task(made.run())
    await asyncio.wait_for(waiting.wait(), 10)
    running.cancel()
    await asyncio.wait_for(asyncio.gather(running, return_exceptions=True), 5)
    assert running.cancelled()
    assert made._thread._shutdown


@pytest.mark.parametrize(
    "error",
    [
        ProgrammingError("SELECT 1", {}, psycopg.errors.UndefinedTable("no table pieces")),
        _failing(psycopg.errors.DatabaseDropped("the database is gone")),
    ],
)
async def test_a_fault_that_is_not_a_lost_connection_stops_without_retry(
    tmp_path: Path,
    sessions: async_sessionmaker[AsyncSession],
    caplog: pytest.LogCaptureFixture,
    error: Exception,
) -> None:
    flaky = Flaky(sessions)
    flaky.failures = 1
    flaky.error = error
    waits: list[float] = []

    async def wait(seconds: float) -> None:
        waits.append(seconds)

    made = Indexer(tmp_path, flaky, FakeModel, model_thread())  # ty: ignore[invalid-argument-type]
    made._wait = wait
    with caplog.at_level(logging.WARNING):
        await asyncio.wait_for(made.run(), 10)
    assert "its database fails" in caplog.text
    assert waits == []


async def test_a_note_whose_query_fails_is_skipped_and_the_next_goes_on(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    _write(tmp_path, "slow.md", "slow words")
    _write(tmp_path, "fine.md", "fine words")
    flaky = Flaky(sessions)
    made = _make(FakeModel(), tmp_path, flaky)  # ty: ignore[invalid-argument-type]
    await made._model_loaded()
    flaky.failures = 1
    flaky.error = _failing(psycopg.errors.QueryCanceled("canceling statement due to timeout"))
    with caplog.at_level(logging.WARNING):
        await made.index("slow.md")
    await made.index("fine.md")
    assert "skips slow.md" in caplog.text
    assert [row[0] for row in await _rows(sessions)] == ["fine.md"]


async def test_no_database_at_startup_is_retried(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    _write(tmp_path, "a.md", "words")
    engine = create_async_engine(
        "postgresql+psycopg://nobody:nothing@127.0.0.1:1/none", poolclass=NullPool
    )
    waits: list[float] = []
    third = asyncio.Event()

    async def wait(seconds: float) -> None:
        waits.append(seconds)
        if len(waits) == 3:
            third.set()
            await asyncio.Event().wait()

    made = Indexer(tmp_path, async_sessionmaker(engine), FakeModel, model_thread())
    made._wait = wait
    with caplog.at_level(logging.WARNING):
        running = asyncio.create_task(made.run())
        await asyncio.wait_for(third.wait(), 10)
    running.cancel()
    await asyncio.gather(running, return_exceptions=True)
    assert waits == [1, 2, 4]
    assert caplog.text.count("waits for its database") == 1
    await engine.dispose()


async def test_a_day_long_outage_keeps_the_wait_at_the_cap(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    flaky = Flaky(sessions)
    flaky.failures = 1500
    waits: list[float] = []

    async def wait(seconds: float) -> None:
        waits.append(seconds)

    made = Indexer(tmp_path, flaky, FakeModel, model_thread())  # ty: ignore[invalid-argument-type]
    made._wait = wait
    running = asyncio.create_task(made.run())
    try:
        await _until(lambda: _true(flaky.failures == 0 and len(waits) == 1500), 60)
        await _until(lambda: _settled(made))
        assert not running.done()
        assert set(waits[6:]) == {60}
    finally:
        running.cancel()
