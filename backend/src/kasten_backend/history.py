"""Reading a note's past out of jujutsu, without writing a thing to it.

`vcs.py` is the write path and snapshots on purpose. This is the read path and must not: every
call here passes `--ignore-working-copy`, so nothing is recorded. `@` is therefore as of the
last snapshot, which every save takes.
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

    `root-file:` makes the path exact, read from the repo root, never a glob. Inside the quotes
    only `\\` and `"` mean anything, so escaping those two leaves no way out. Control characters
    are refused by the caller rather than escaped.
    """
    escaped = path.replace("\\", "\\\\").replace('"', '\\"')
    return f'root-file:"{escaped}"'


def plain(path: str) -> bool:
    """Whether a path holds no control character, the one thing `literal` will not spell."""
    return not any(unicodedata.category(char) == "Cc" for char in path)


async def _read(root: Path, *args: str) -> str:
    """Run one read-only jj command against the vault and return its output.

    Unlike `vcs._run`, a failure is raised: nothing was saved here, so the reader is better told
    the history is out of reach.
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
        # Killed and reaped on every way out, so no jj is left behind. Drained by `communicate`,
        # not waited for: a stdout paused mid-output never closes, and `wait` would hang (#1242).
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

    Only jj's own rename, which it finds when the text stayed similar. A guess from a delete beside
    an add would hand a new note another's history, and a restore would then write that text.
    """
    return next(
        (source for status, source, target in touched if status == "renamed" and target == path),
        None,
    )


async def list_changes(root: Path, path: str) -> list[Change] | None:
    """Every change that touched the note, newest first, following it through renames.

    None when the vault keeps no history. Renames are followed, except out of `.trash`, which the
    version endpoint cannot read. Older changes at a path drop once the walk follows a rename.
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

    `commit` is 40 hex digits by the time it gets here, so it names one commit or none. `present`
    turns none into an empty answer, which tells an unknown commit apart from jj failing.
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
