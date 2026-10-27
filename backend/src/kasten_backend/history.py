"""Reading a note's past out of jujutsu, without writing a thing to it.

`vcs.py` is the write path and snapshots on purpose. This is the read path and
must not: a plain `jj log` snapshots the working copy and records an operation,
and the live vault has its own snapshot job. So every call here passes
`--ignore-working-copy`, and none of them is a command that writes. What `@`
holds is therefore as of the last snapshot, which every save takes.
"""

import asyncio
import json
import unicodedata
from typing import TYPE_CHECKING, NamedTuple

from kasten_backend.vault import resolve_path
from kasten_backend.vcs import is_versioned

if TYPE_CHECKING:
    from pathlib import Path

TIMEOUT = 10.0
"""Seconds one jj call gets before it is killed and the request answers 503."""

HOPS = 20
"""How many renames the walk follows back, which is what stops a loop of them."""

TEMPLATE = (
    '"[" ++ json(commit_id) ++ "," ++ json(change_id.short()) ++ ","'
    ' ++ json(committer.timestamp().format("%Y-%m-%dT%H:%M:%S%:z")) ++ ","'
    ' ++ description.first_line().escape_json() ++ ",["'
    ' ++ self.diff().files().map(|f| "[" ++ json(f.status()) ++ ","'
    ' ++ stringify(f.source().path()).escape_json() ++ ","'
    ' ++ stringify(f.target().path()).escape_json() ++ "]").join(",")'
    ' ++ "]]\\n"'
)
"""One JSON array per change: ids, time, first line, and every file it touched.

JSON rather than a separator, because a description can hold any character.
The files are every one in the change rather than a diff narrowed to the note,
so the note's path sits in one place, the revset, and is escaped once.
"""


class HistoryError(Exception):
    """jj ran and failed, or ran too long. The route answers 503."""


class UnversionedError(Exception):
    """There is no jj to run, which reads the same as a vault with no history."""


class Change(NamedTuple):
    """One change that touched a note, and the path the note had in it."""

    commit: str
    change: str
    time: str
    description: str
    path: str


def literal(path: str) -> str:
    r"""Spell a note path as a fileset that matches that one file and nothing else.

    `root-file:` so the path is exact and read from the repo root, never a glob
    or a prefix. Inside the quotes only `\` and `"` mean anything, so escaping
    those two leaves a crafted name no way out. Control characters are refused
    by the caller rather than escaped: no note is named with one.
    """
    escaped = path.replace("\\", "\\\\").replace('"', '\\"')
    return f'root-file:"{escaped}"'


def plain(path: str) -> bool:
    """Whether a path holds no control character, the one thing `literal` will not spell."""
    return not any(unicodedata.category(char) == "Cc" for char in path)


async def _read(root: Path, *args: str) -> str:
    """Run one read-only jj command against the vault and return its output.

    Unlike `vcs._run`, a failure is not swallowed: nothing was saved here, and
    the reader is better told the history is out of reach than shown none.
    """
    try:
        process = await asyncio.create_subprocess_exec(
            "jj",
            "--ignore-working-copy",
            "--repository",
            str(root),
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as error:
        raise UnversionedError from error

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), TIMEOUT)
    except TimeoutError as error:
        raise HistoryError(f"jj {args[0]} took longer than {TIMEOUT:g} seconds") from error
    finally:
        # Killed and reaped on every way out, a cancelled request included, so a
        # jj still running leaves no child behind. Drained by `communicate`
        # rather than waited for: a stdout paused mid-output never closes, and
        # `wait` waits for it to (#1242).
        if process.returncode is None:
            process.kill()
            await process.communicate()

    if process.returncode != 0:
        raise HistoryError(f"jj {args[0]} failed: {stderr.decode(errors='replace').strip()}")

    try:
        return stdout.decode()
    except UnicodeDecodeError as error:
        raise HistoryError(f"jj {args[0]} wrote output that is not UTF-8") from error


def moved_from(touched: list[list[str]], path: str) -> str | None:
    """The path the note had before this change, when jj says the change moved it.

    Only jj's own rename, which it finds when the text stayed similar, as a
    kasten move keeps it. A guess from a delete beside an add would hand a new
    note the history of one removed in the shell in the same change, and a
    restore would then write that other note's text.
    """
    return next(
        (source for status, source, target in touched if status == "renamed" and target == path),
        None,
    )


async def list_changes(root: Path, path: str) -> list[Change] | None:
    """Every change that touched the note, newest first, following it through renames.

    None when the vault keeps no history, either for want of a repo or of jj.
    Where a change renamed the note from another path, the walk carries on
    with that path among the change's ancestors. The older changes at the
    current path are dropped there, because they belong to whatever file had
    the name before.

    A rename out of a path the vault would refuse, which is `.trash` after a
    restore, is not followed: the version endpoint could not read the note
    there. The walk keeps to the current path instead, which reaches the
    change that moved the note into the trash and everything before it.
    """
    if not is_versioned(root):
        return None

    changes: list[Change] = []
    revset = f"::@ & files({literal(path)})"
    for _ in range(HOPS):
        try:
            output = await _read(root, "log", "-r", revset, "--no-graph", "-T", TEMPLATE)
        except UnversionedError:
            return None

        renamed_from = None
        for line in output.splitlines():
            commit, change, time, description, touched = json.loads(line)
            changes.append(Change(commit, change, time, description, path))
            source = moved_from(touched, path)
            if source is not None and plain(source) and resolve_path(root, source):
                renamed_from = source
                break

        if renamed_from is None:
            return changes

        revset = f"::{changes[-1].commit}- & files({literal(renamed_from)})"
        path = renamed_from

    return changes


async def read_version(root: Path, path: str, commit: str) -> str | None:
    """The note's text at one commit, or None when the commit or the note is not there.

    `commit` is 40 hex digits by the time it gets here, which the route checks,
    so it is a revset that names one commit or none. `present` turns none into
    an empty answer rather than an error, which is how an unknown commit is told
    apart from jj failing.
    """
    if not is_versioned(root):
        return None

    try:
        found = await _read(
            root, "log", "-r", f"present({commit})", "--no-graph", "-T", "commit_id"
        )
        if not found:
            return None
        listed = await _read(root, "file", "list", "-r", commit, literal(path))
        if not listed:
            return None
        return await _read(root, "file", "show", "-r", commit, literal(path))
    except UnversionedError:
        return None
