"""One writer at a time, so a check and the write it guards cannot be separated.

`vcs.py` brackets a write in a jj change and serialises nothing, so two saves interleave.
Every vault mutation runs inside `vault_write`, which takes the lock before the checks,
not just before `begin_change`. Neither manager is re-entrant: re-entering in one task deadlocks.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

from kasten_backend.vcs import begin_change, is_versioned, snapshot

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path

logger = logging.getLogger(__name__)

# ponytail: one lock for the whole vault, so every write in the process serialises.
# Per-path locks are the upgrade when a slow write holds up a fast one.
_lock = asyncio.Lock()

# ponytail: covers this process's writes only. The shell container edits the same vault,
# so a terminal save racing a browser save is still the old bug. A filesystem lock fixes it.
_held: ContextVar[bool] = ContextVar("_held", default=False)
"""Whether *this* task holds the lock, which `Lock.locked()` cannot say.

Another task holding it would otherwise pass the check. A contextvar is per task.
"""

_owed: ContextVar[list[Path] | None] = ContextVar("_owed", default=None)
"""The vaults whose snapshot the `vault_write` in hand takes after it answers."""

_snapshotting: asyncio.Task[None] | None = None
"""The snapshot a finished write left running, which holds the lock until it ends (#1827)."""


async def _snapshot_then_release(roots: list[Path]) -> None:
    try:
        for root in roots:
            await snapshot(root)
    finally:
        _lock.release()


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
    await _lock.acquire()
    held = _held.set(True)
    owed: list[Path] = []
    owing = _owed.set(owed)
    try:
        yield
    finally:
        _owed.reset(owing)
        _held.reset(held)
        if owed:
            _snapshotting = asyncio.create_task(_snapshot_then_release(list(dict.fromkeys(owed))))
            _snapshotting.add_done_callback(_snapshot_stopped)
        else:
            _lock.release()


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
