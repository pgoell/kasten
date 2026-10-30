"""The pieces index outlives a vault watcher that fails, and catches the saves it missed (#1390).

`watch_vault` is swapped for one that fails a set number of times, and an
injected wait records each pause, so the backoff is counted, not timed.
"""

import asyncio
import logging
from typing import TYPE_CHECKING

import pytest

from backend.tests.pieces.indexer.test_indexer import (
    FakeModel,
    _drain,
    _make,
    _rows,
    _settled,
    _until,
    _write,
)
from kasten_backend.events import watch_vault
from kasten_backend.pieces import indexer
from kasten_backend.pieces.embed import model_thread
from kasten_backend.pieces.indexer import Indexer

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _failing(monkeypatch: pytest.MonkeyPatch, failures: int, error: Exception) -> None:
    """Make the indexer's `watch_vault` raise `error` on its first `failures` starts."""
    left = [failures]

    async def watch(root: Path):
        if left[0]:
            left[0] -= 1
            raise error
        async for events in watch_vault(root):
            yield events

    monkeypatch.setattr(indexer, "watch_vault", watch)


async def _true(value: bool) -> bool:
    return value


async def test_a_failing_watcher_says_so_restarts_and_catches_the_saves_it_missed(
    tmp_path: Path,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _failing(monkeypatch, 1, OSError(28, "inotify watch limit reached"))
    up = asyncio.Event()
    waits: list[float] = []

    async def wait(seconds: float) -> None:
        waits.append(seconds)
        await up.wait()

    made = Indexer(tmp_path, sessions, FakeModel, model_thread())
    made._wait = wait
    with caplog.at_level(logging.WARNING):
        running = asyncio.create_task(made.run())
        try:
            await _until(lambda: _true(bool(waits)))
            await _until(lambda: _settled(made))
            assert (
                "restarts its watcher, which fails: [Errno 28] inotify watch limit reached"
                in caplog.text
            )
            # Written once, while no watcher runs: only the sweep after the restart finds it.
            _write(tmp_path, "missed.md", "words no watcher saw")
            up.set()

            async def landed(path: str) -> bool:
                return path in {row[0] for row in await _rows(sessions)}

            await _until(lambda: landed("missed.md"))

            async def saved() -> bool:
                _write(tmp_path, "after.md", f"words at {asyncio.get_running_loop().time()}")
                return await landed("after.md")

            await _until(saved)
            assert "follows saves again after 1 tries" in caplog.text
            assert waits == [1]
            assert not running.done()
        finally:
            running.cancel()


@pytest.mark.parametrize("gone", [False, True])
async def test_a_lasting_watcher_fault_backs_off_to_the_cap_and_logs_once(
    tmp_path: Path,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    gone: bool,
) -> None:
    root = tmp_path / "vault"
    _write(root, "kept.md", "kept words")
    made = Indexer(root, sessions, FakeModel, model_thread())
    await _drain(made)
    if gone:
        # The real watcher, which yields nothing for a vault that is not there.
        root.rename(tmp_path / "away")
    else:
        _failing(monkeypatch, 10**6, OSError(28, "inotify watch limit reached"))
    waits: list[float] = []
    enough = asyncio.Event()

    async def wait(seconds: float) -> None:
        waits.append(seconds)
        if len(waits) == 12:
            enough.set()
            await asyncio.Event().wait()
        await asyncio.sleep(0)

    made._wait = wait
    with caplog.at_level(logging.WARNING):
        running = asyncio.create_task(made.run())
        try:
            await asyncio.wait_for(enough.wait(), 10)
            await _until(lambda: _settled(made))
        finally:
            running.cancel()
            await asyncio.gather(running, return_exceptions=True)
    assert waits == [1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60, 60]
    assert caplog.text.count("restarts its watcher, which fails") == 1
    assert ("the vault folder is gone" in caplog.text) is gone
    assert {row[0] for row in await _rows(sessions)} == {"kept.md"}


async def test_a_watcher_fault_of_another_kind_ends_the_indexer(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    _failing(monkeypatch, 1, ValueError("a bug in the watcher"))
    made = Indexer(tmp_path, sessions, FakeModel, model_thread())
    with pytest.raises(ValueError, match="a bug in the watcher"):
        await asyncio.wait_for(made.run(), 10)
    assert made._thread._shutdown


async def test_shutdown_ends_while_the_watcher_waits_to_restart(
    tmp_path: Path,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _failing(monkeypatch, 1, OSError(28, "inotify watch limit reached"))
    waiting = asyncio.Event()

    async def wait(_seconds: float) -> None:
        waiting.set()
        await asyncio.Event().wait()

    made = _make(FakeModel(), tmp_path, sessions)
    made._wait = wait
    running = asyncio.create_task(made.run())
    await asyncio.wait_for(waiting.wait(), 10)
    caplog.clear()
    with caplog.at_level(logging.INFO):
        running.cancel()
        await asyncio.wait_for(asyncio.gather(running, return_exceptions=True), 5)
    assert running.cancelled()
    assert made._thread._shutdown
    assert caplog.text == ""
