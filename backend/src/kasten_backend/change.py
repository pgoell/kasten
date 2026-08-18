"""One writer at a time, so a check and the write it guards cannot be separated.

`vcs.py` brackets a write in a jj change and serialises nothing. Two saves
therefore interleave: A opens its change, B opens its change, A writes, A
snapshots, and A's edit is recorded under B's description. That is reachable by
racing yourself today, and ordinary the moment a second writer that is not the
browser exists.

So every vault mutation in this process runs inside `vault_write`, and the lock
is taken before the collision check or the digest comparison rather than merely
before `begin_change`: a check that is not inside the write's own lock is a check
another request can invalidate before the write lands.

Neither manager is re-entrant. Exactly one function per call chain takes the
lock, and re-entering it in one task deadlocks.
"""

import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

from kasten_backend.vcs import begin_change, snapshot

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

# ponytail: one lock for the whole vault, so every write in the process
# serialises. For one user that is free. Per-path locks are the upgrade when a
# slow write measurably holds up a fast one.
_lock = asyncio.Lock()

# ponytail: this reaches the writes this process makes and no others. The shell
# container edits the same bind-mounted vault with no process in common, so a
# terminal save racing a browser save is still the old bug. Closing that means a
# lock on the filesystem, which is a different feature.
_held: ContextVar[bool] = ContextVar("_held", default=False)
"""Whether *this* task holds the lock.

`asyncio.Lock.locked()` would not answer that. It says only that some task holds
the lock, so a task that never acquired it would pass the check below while
another task's transaction was open. A contextvar is per task.
"""


@asynccontextmanager
async def vault_write() -> AsyncIterator[None]:
    """Hold the vault. Every mutation in this process runs inside one of these."""
    async with _lock:
        token = _held.set(True)
        try:
            yield
        finally:
            _held.reset(token)


@asynccontextmanager
async def vault_change(root: Path, label: str) -> AsyncIterator[None]:
    """Bracket one mutation in a jj change. Must run inside `vault_write`.

    Raised rather than asserted: ruff's `S101` bans `assert` outside the tests,
    and this is the check that keeps a new write site from quietly inheriting
    the bug the lock exists to fix.

    The jj calls are awaited inside the lock on purpose. They shell out, and
    those subprocesses are the transaction rather than an unrelated wait.
    """
    if not _held.get():
        raise RuntimeError("A vault change must run inside vault_write")

    await begin_change(root, label)
    yield
    await snapshot(root)
