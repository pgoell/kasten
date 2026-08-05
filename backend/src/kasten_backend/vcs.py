"""Recording vault writes in jujutsu, so a bad edit can be walked back.

Nothing else keeps a copy of the vault. A save overwrites what was there, and
without a history the paragraph you deleted by accident is gone. That is why
this sits on the write path rather than on a timer somebody has to remember.

One change per note, not one per save. Saving the same note again amends the
change already in hand, and moving to another note seals it and starts the
next, so `jj log` reads as the list of notes you worked on. Every single save
still lands in `jj op log`, so `jj op restore` reaches a finer grain when the
changes are too coarse.

A vault that is not a jj repo is left alone, and so is a box with no jj on it.
None of this may ever stop a note being saved.
"""

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

DESCRIPTION = "vault: {path}"
"""How a change is named. The path is how one note's change is told from another's."""


def is_versioned(root: Path) -> bool:
    """Report whether the vault is a jj repo."""
    return (root / ".jj").is_dir()


async def _run(root: Path, *args: str) -> str | None:
    """Run one jj command against the vault, or return None when it will not run.

    Every failure is swallowed on purpose. The note is already saved, or is
    about to be, and losing the history of a write is worth less than losing
    the write.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            "jj",
            "--repository",
            str(root),
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError:
        logger.warning("Could not run jj, so the vault is being left unversioned")
        return None

    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        logger.warning("jj %s failed: %s", args[0], stderr.decode(errors="replace").strip())
        return None

    return stdout.decode()


async def begin_change(root: Path, relative: str) -> None:
    """Start a fresh jj change unless the note being saved is the one in hand.

    Runs before the write, so the first edit to a note lands in that note's own
    change rather than in the previous note's.
    """
    if not is_versioned(root):
        return

    # Reading the description snapshots the working copy on the way past, so an
    # edit made outside kasten lands in the change it belongs to.
    description = await _run(root, "log", "-r", "@", "--no-graph", "-T", "description")
    if description is None:
        return

    wanted = DESCRIPTION.format(path=relative)
    if description.strip() == wanted:
        return

    await _run(root, "new", "-m", wanted)


async def snapshot(root: Path) -> None:
    """Record the write, both in the change in hand and in the operation log."""
    if not is_versioned(root):
        return

    # `status` is the cheapest command that snapshots the working copy, which
    # is the whole point of running it. The output goes nowhere.
    await _run(root, "status")
