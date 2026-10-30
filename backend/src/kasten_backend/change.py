"""One writer at a time, so a check and the write it guards cannot be separated.

`vcs.py` brackets a write in a jj change and serialises nothing, so two saves interleave.
Every vault mutation runs inside `vault_write`, which takes the lock before the checks,
not just before `begin_change`. Neither manager is re-entrant: re-entering in one task deadlocks.
"""

import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import TYPE_CHECKING

from kasten_backend.vcs import begin_change, snapshot

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

# ponytail: one lock for the whole vault, so every write in the process serialises.
# Per-path locks are the upgrade when a slow write holds up a fast one.
_lock = asyncio.Lock()

# ponytail: covers this process's writes only. The shell container edits the same vault,
# so a terminal save racing a browser save is still the old bug. A filesystem lock fixes it.
_held: ContextVar[bool] = ContextVar("_held", default=False)
"""Whether *this* task holds the lock, which `Lock.locked()` cannot say.

Another task holding it would otherwise pass the check. A contextvar is per task.
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

    Raised, not asserted, since ruff's `S101` bans `assert` outside tests. The jj calls stay
    inside the lock on purpose: they shell out, and those subprocesses are the transaction.
    """
    if not _held.get():
        raise RuntimeError("A vault change must run inside vault_write")

    await begin_change(root, label)
    yield
    await snapshot(root)
