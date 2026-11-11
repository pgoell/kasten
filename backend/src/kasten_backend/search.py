"""Finding a word in the vault by reading the vault, so nothing can go stale.

ripgrep runs as a subprocess, so the event loop is never held while it scans.
"""

import asyncio
import os
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple, cast

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

MOST_HITS = 2_000
"""How many matching lines come back at most, about 160KB per keystroke.

The client ranks every line it is handed before it cuts, so the cap sits well above
the rows shown.
"""

LONGEST_TEXT = 65_536
"""How many characters of a matching line come back at most (#1244).

Past this, a link, tag or todo in one line is not seen by any reader.
"""

_KEPT = 4 * LONGEST_TEXT + 4_096
"""Bytes kept of a line rg prints: its path, number and `LONGEST_TEXT` characters of 4 bytes."""

_CHUNK = 1 << 20
"""Bytes asked of rg's pipe at a time."""


class Hit(NamedTuple):
    """One matching line: where it lives, which line it is, and what it says."""

    path: str
    line: int
    text: str


# Both readers pass these, so they cannot disagree on which notes exist.
# `--no-ignore`: a `.gitignore` in the vault says nothing about its notes.
SEEN_BY_THE_LISTING = ("--no-ignore", "--glob", "*.md")


def skipping(folder: str | None) -> tuple[str, ...]:
    """The flags that keep a folder out of a scan, or none at all.

    Unanchored `**/`: rg matches against the absolute path, so `98 Archive/**` never
    fires. Goes after `SEEN_BY_THE_LISTING`, as rg's last match wins. A rewrite never
    skips, since that loses links.
    """
    return () if folder is None or folder == "" else ("--glob", f"!**/{folder}/**")


class SearchError(RuntimeError):
    """rg could not read the whole vault, so its answer is not the whole answer.

    Only the rewriting caller raises on it: a short search shows fewer rows, but a
    short rewrite leaves a broken link.
    """


def relative_to_root(root: Path) -> Callable[[str], str]:
    """Strips `root` from the paths rg prints (#1353)."""
    prefix = f"{root}/"

    def relative(path: str) -> str:
        if path.startswith(prefix):
            return path[len(prefix) :]
        return str(Path(path).relative_to(root))

    return relative


async def notes_holding(root: Path, *texts: str, skip: str | None = None) -> list[str]:
    """Every note whose text contains one of `texts`, ignoring case, with no cap.

    A rewrite must see every note or it leaves a link pointing at nothing. The match
    is literal, so it is a superset that the caller narrows note by note. `skip` is
    for a read-only caller, so a move passes none.
    """
    named = [flag for text in texts for flag in ("-e", text)]
    process = await asyncio.create_subprocess_exec(
        "rg",
        "--files-with-matches",
        "--fixed-strings",
        "--ignore-case",
        # NUL ends each path, the one byte a path cannot contain; a newline can.
        "--null",
        *SEEN_BY_THE_LISTING,
        *skipping(skip),
        *named,
        "--",
        str(root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()

    # rg exits 1 for no match, so above 1 it could not read the whole vault.
    if process.returncode is not None and process.returncode > 1:
        raise SearchError(stderr.decode(errors="replace").strip())

    relative = relative_to_root(root)
    found = stdout.decode("utf-8", "replace").split("\0")
    return [relative(path) for path in found if path]


async def scan_vault(
    root: Path,
    matcher: Sequence[str],
    cap: int,
    skip: str | None = None,
    listing: Sequence[str] = SEEN_BY_THE_LISTING,
) -> list[Hit]:
    """Every line rg matches, up to `cap`. `matcher` carries the pattern and its flags.

    Every line reader goes through here, so they all report a hit the same way. A
    missing vault needs no guard: rg writes nothing to stdout, which reads as no
    matches.
    """
    process = await asyncio.create_subprocess_exec(
        "rg",
        "--line-number",
        "--with-filename",
        "--no-heading",
        "--null",
        # The cap makes rg's traversal order decide which hits survive.
        "--sort",
        "path",
        # Matches the listing of `GET /api/files`, where rg would otherwise disagree.
        *listing,
        *skipping(skip),
        *matcher,
        # `--` so a path starting with a dash is a path and not a flag.
        "--",
        str(root),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    hits: list[Hit] = []
    relative = relative_to_root(root)
    # `stdout=PIPE` makes this a reader; the type checker cannot see that.
    stdout = cast("asyncio.StreamReader", process.stdout)
    try:
        # One await per chunk, not per line, which cost the graph most of its time (#1759).
        # Split on bytes: a newline byte never sits inside a UTF-8 character.
        pending = b""
        while len(hits) < cap and (chunk := await stdout.read(_CHUNK)):
            *lines, pending = (pending + chunk).split(b"\n")
            # Cut each chunk, so a line of any length holds at most `_KEPT` bytes (#1244).
            pending = pending[:_KEPT]
            hits.extend(_hits(lines[: cap - len(hits)], relative))
        if pending and len(hits) < cap:
            hits.extend(_hits([pending], relative))
    finally:
        # Counted here, not with `--max-count`, which is per file.
        # Killing rg also covers a request that went away, cancelling this task.
        if process.returncode is None:
            process.kill()
        # Not `wait`, which hangs on a paused pipe until its output is read (#1242).
        await process.communicate()
    return hits


def _hits(lines: list[bytes], relative: Callable[[str], str]) -> list[Hit]:
    """One hit per line rg printed, its text cut to `LONGEST_TEXT` characters."""
    hits = []
    for raw in lines:
        # NUL, not colon, ends the path: a note name can hold a colon.
        path, _, rest = raw[:_KEPT].decode("utf-8", "replace").partition("\0")
        number, _, text = rest.partition(":")
        hits.append(Hit(path=relative(path), line=int(number), text=text[:LONGEST_TEXT]))
    return hits


_BOM = b"\xef\xbb\xbf"


def rg_lines(raw: bytes) -> list[str]:
    """A note's lines as `scan_vault` hands them over, cut to `LONGEST_TEXT` characters.

    rg skips a file holding a NUL, drops a UTF-8 byte order mark, and splits on LF alone,
    so a CR stays on its line. Line N is item N - 1.
    """
    if b"\0" in raw:
        return []
    text = raw.removeprefix(_BOM).decode("utf-8", "replace")
    return [line[:LONGEST_TEXT] for line in text.split("\n")]


def rg_order(path: str) -> list[str]:
    """The sort key of rg's `--sort path`, which sorts each folder's entries by name."""
    return path.split("/")


def skipped(path: str, folder: str | None) -> bool:
    """Whether `path` sits in a folder of that name anywhere, as `skipping` keeps it out."""
    return folder is not None and folder != "" and f"/{folder}/" in f"/{path}"


def literal_matcher(query: str, *, regex: bool = False, word: bool = False) -> tuple[str, ...]:
    """The rg flags that find `query`, ignoring case: as a regex if `regex`, whole words if `word`.

    A literal by default, so `index.` or a half-typed `[[like` is a query, not an error.
    Shared so the notes and extracted text are searched with one matcher.
    """
    kind = () if regex else ("--fixed-strings",)
    edges = ("--word-regexp",) if word else ()
    return (*kind, *edges, "--ignore-case", "-e", query)


class PatternError(ValueError):
    """rg refused the pattern, with its own message saying why."""


async def check_pattern(matcher: Sequence[str]) -> None:
    """Raise `PatternError` when rg cannot read `matcher`'s pattern.

    `scan_vault` drops rg's stderr, so a bad pattern would read as no hits there.
    An empty file is the target, so the check reads nothing.
    """
    process = await asyncio.create_subprocess_exec(
        "rg",
        *matcher,
        "--",
        os.devnull,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode is not None and process.returncode > 1:
        raise PatternError(stderr.decode(errors="replace").strip())


async def search_vault(
    root: Path, query: str, skip: str | None = None, *, regex: bool = False, word: bool = False
) -> list[Hit]:
    """Every line in the vault matching `query`, ignoring case, up to `MOST_HITS`.

    `skip` keeps a folder out, as the archive is by default. It matters because
    `MOST_HITS` caps the answer, so a growing archive would crowd live notes out.
    """
    # An empty literal matches every line, the most expensive query there is.
    if not query.strip():
        return []

    return await scan_vault(root, literal_matcher(query, regex=regex, word=word), MOST_HITS, skip)
