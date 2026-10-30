"""Recording vault writes in jujutsu, so a bad edit can be walked back.

Nothing else keeps a copy of the vault. One change per note, not per save: saving the same
note amends the change in hand, and moving on seals it. Every save lands in `jj op log`.
"""

import asyncio
import logging
from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

writer: ContextVar[str | None] = ContextVar("writer", default=None)
"""The token name behind the write in hand, or None when the browser is writing.

A contextvar rather than an argument threaded through every call site, since none of them
knows who asked.
"""


def describe(label: str) -> str:
    """How a change is named: the label, and who wrote it when that was not the browser.

    Formatted here, since `begin_change` compares the whole description. A switch of writer
    opens a new change even for the same note, so an agent never amends your browser edits.
    """
    name = writer.get()
    return f"agent({name}): {label}" if name else f"vault: {label}"


IGNORES = ("*.epub", "*.pdf", ".*.tmp")
"""What the vault's history never takes a copy of.

A book, since jj tracks untracked files under a megabyte. The temp a write lands in first,
since a snapshot mid-upload would put half a book in the history for good.
"""


def write_ignores(root: Path) -> None:
    """Give the vault a `.gitignore` holding `IGNORES`, keeping every other line.

    Unconditional, so a vault not yet a repo is covered when `jj git init` runs. Written
    straight, since `resolve_path` refuses dot segments. Search sees ignored files anyway
    (`--no-ignore`); ignoring is not untracking, so a book already tracked stays tracked.
    """
    root.mkdir(parents=True, exist_ok=True)
    path = root / ".gitignore"
    lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []

    missing = [line for line in IGNORES if line not in lines]
    if not missing:
        return

    path.write_text("".join(f"{line}\n" for line in [*lines, *missing]), encoding="utf-8")


def is_versioned(root: Path) -> bool:
    """Report whether the vault is a jj repo."""
    return (root / ".jj").is_dir()


async def _run(root: Path, *args: str) -> str | None:
    """Run one jj command against the vault, or return None when it will not run.

    Every failure is swallowed: the note is saved, or about to be, and its history is worth
    less than the write.
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

    wanted = describe(relative)
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
