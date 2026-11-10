"""One writer at a time, so a check and the write it guards cannot be separated.

Every mutation runs inside `vault_write`, which locks before the checks; neither manager is
re-entrant. The lock is an `asyncio.Lock` here and an `flock` across backend processes (#1768);
a write from the shell takes neither, and the base hash on `PUT` catches it.
"""

import asyncio
import fcntl
import logging
import os
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

from kasten_backend.config import get_settings
from kasten_backend.vcs import begin_change, is_versioned, snapshot

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path

logger = logging.getLogger(__name__)

# ponytail: one lock for the whole vault, so every write serialises.
# Per-path locks are the upgrade when a slow write holds up a fast one.
_lock = asyncio.Lock()
"""Taken before the flock, so at most one thread per process waits on it."""

_held: ContextVar[bool] = ContextVar("_held", default=False)
"""Whether *this* task holds the lock, which `Lock.locked()` cannot say.

Another task holding it would otherwise pass the check. A contextvar is per task.
"""

_owed: ContextVar[list[Path] | None] = ContextVar("_owed", default=None)
"""The vaults whose snapshot the `vault_write` in hand takes after it answers."""

_snapshotting: asyncio.Task[None] | None = None
"""The snapshot a finished write left running, which holds the lock until it ends (#1827)."""


def _take_flock(path: Path) -> int:
    """Open the lock file, making its folder, and block until no other process holds it.

    Runs in a thread. A process that dies drops its flock with it, so a stale file wedges nothing.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
    except OSError:
        os.close(fd)
        raise
    return fd


def _close_taken(taking: asyncio.Future[int]) -> None:
    if not taking.cancelled() and taking.exception() is None:
        os.close(taking.result())


async def _hold() -> int:
    """Take both locks and hand back the open lock file, which closing releases."""
    await _lock.acquire()
    taking = asyncio.ensure_future(asyncio.to_thread(_take_flock, get_settings().vault_lock))
    try:
        return await asyncio.shield(taking)
    except BaseException:
        # A cancelled wait leaves the thread in `flock`; whatever it takes is closed, not orphaned.
        taking.add_done_callback(_close_taken)
        _lock.release()
        raise


def _release(fd: int) -> None:
    os.close(fd)
    _lock.release()


async def _snapshot_then_release(roots: list[Path], fd: int) -> None:
    try:
        for root in roots:
            await snapshot(root)
    finally:
        _release(fd)


def _snapshot_stopped(task: asyncio.Task[None]) -> None:
    """Log an error that ended a snapshot. The file is written; only its history waits."""
    if not task.cancelled() and (error := task.exception()) is not None:
        logger.error("jj snapshot failed; the next one records the write", exc_info=error)


async def settled() -> None:
    """Wait for the snapshot a finished write left running, so jj's history holds that write."""
    task = _snapshotting
    if task is not None and not task.done():
        # `wait`, not `await`: a reader that gives up leaves the snapshot running, and a failed
        # one is logged by `_snapshot_stopped` rather than raised into the reader.
        await asyncio.wait({task})


@asynccontextmanager
async def vault_write() -> AsyncGenerator[None]:
    """Hold the vault. Every mutation in this process runs inside one of these.

    The caller answers once the write is on disk. The jj snapshot runs after, still under the
    lock, so the next write waits for it while the save's own answer does not (#1827).
    """
    global _snapshotting  # noqa: PLW0603
    fd = await _hold()
    held = _held.set(True)
    owed: list[Path] = []
    owing = _owed.set(owed)
    try:
        yield
    finally:
        _owed.reset(owing)
        _held.reset(held)
        if owed:
            _snapshotting = asyncio.create_task(
                _snapshot_then_release(list(dict.fromkeys(owed)), fd)
            )
            _snapshotting.add_done_callback(_snapshot_stopped)
        else:
            _release(fd)


@asynccontextmanager
async def vault_change(root: Path, label: str) -> AsyncGenerator[None]:
    """Bracket one mutation in a jj change. Must run inside `vault_write`.

    Raised, not asserted, since ruff's `S101` bans `assert` outside tests. The jj calls stay
    inside the lock on purpose: they shell out, and those subprocesses are the transaction.
    The snapshot is owed to `vault_write`, which takes it once the caller has its answer.
    """
    owed = _owed.get()
    if not _held.get() or owed is None:
        raise RuntimeError("A vault change must run inside vault_write")

    await begin_change(root, label)
    yield
    if is_versioned(root):
        owed.append(root)
