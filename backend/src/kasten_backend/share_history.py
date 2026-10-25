"""Who ticked each done item of a shared list, read back from the note's jj history.

A save under `/share/` is named in the history after its person, as
`agent(share:Alicia): 05 Shared/Einkauf.md`. This walks the note's latest
changes and finds, per item, the version whose patch turned the item done: that
version names the ticker and its committer time is the tick's. Read through
`history._read`, so the walk writes no operation, and a jj that fails or is
missing answers no ticks rather than an error.
"""

import json
import re
from typing import TYPE_CHECKING, NamedTuple

from kasten_backend import agent, history, share, todo_fields, vcs

if TYPE_CHECKING:
    from pathlib import Path

    from kasten_backend.config import Settings

VERSIONS = 30
"""How many of the note's latest changes the walk reads, newest first."""

CACHE_SIZE = 8
"""How many (note, digest, `@`) answers are kept, so a read with no save since costs one jj call."""

MARK = "KTVERSION "
"""What opens a version's header line.

A diff line starts with `+`, `-`, a space or a git word, so none of them is taken for it.
"""

TEMPLATE = (
    '"' + MARK + '" ++ json(commit.description().first_line()) ++ "\\t"'
    ' ++ json(commit.committer().timestamp().format("%Y-%m-%dT%H:%M:%S%:z")) ++ "\\n"'
)
"""One header per version: its writer's description and its committer time, tab-separated."""

WRITER = re.compile(r"agent\(share:([^)]+)\): ")
"""A description a `/share/` write made, which names the person in its brackets."""


class Tick(NamedTuple):
    """Who ticked an item, or None for a tick no person's write made, and when."""

    who: str | None
    when: str


class _Version(NamedTuple):
    """One version of the note: its writer and time, and the done items it takes off and puts on."""

    who: str | None
    when: str
    done_before: set[str]
    done_after: set[str]


_cache: dict[tuple[str, str, str], dict[str, Tick]] = {}


def _key(rest: str) -> str:
    """What names an item across versions: its `🆔` when it reads one, else its words."""
    found = todo_fields.ID.search(todo_fields.mask(rest))
    return share.words(rest) if found is None else rest[found.start() : found.end()]


def _keys(text: str) -> dict[int, str]:
    """The key of every done task line of `text`, by line number."""
    keys = {}
    for number, line in enumerate(text.split("\n")):
        match = share.ITEM.match(line)
        if match is not None and match.group(1) != " ":
            keys[number] = _key(match.group(2))

    return keys


def _take(version: _Version, line: str) -> None:
    """Record a done task line of a version's patch on the side it sits on."""
    match = share.ITEM.match(line[1:])
    if match is None or match.group(1) == " ":
        return

    side = version.done_before if line[0] == "-" else version.done_after
    side.add(_key(match.group(2)))


def _head(line: str) -> _Version:
    """A version from its header line, with no items yet. Raises ValueError when it is not one."""
    description, when = (json.loads(part) for part in line[len(MARK) :].split("\t", 1))
    writer = WRITER.match(description)
    return _Version(None if writer is None else writer[1], when, set(), set())


def _versions(output: str, path: str) -> list[_Version]:
    """Every version in jj's output, newest first, with the done items each one changes.

    Only the hunks of the note's own path count: `diff --git` names the file a
    patch is for, and the hunks after it belong to it until the next one.
    """
    header = f"diff --git a/{path} b/{path}"
    versions: list[_Version] = []
    ours = hunk = False
    for line in output.split("\n"):
        if line.startswith(MARK):
            versions.append(_head(line))
            ours = hunk = False
        elif line.startswith("diff --git "):
            ours, hunk = line == header, False
        elif line.startswith("@@"):
            hunk = ours
        elif hunk and versions and line[:1] in ("+", "-"):
            _take(versions[-1], line)

    return versions


def _ticks(versions: list[_Version]) -> dict[str, Tick]:
    """The tick of each item: the newest version that turns it done without it being done before.

    Versions come newest first, so the first one to name an item is its latest
    tick, which is the one a re-tick after an untick leaves. An edit of a done
    item is no tick, since the item is done on both sides of its patch.
    """
    found: dict[str, Tick] = {}
    for version in versions:
        for key in version.done_after - version.done_before:
            found.setdefault(key, Tick(version.who, version.when))

    return found


async def _ticks_of(root: Path, path: str, digest: str) -> dict[str, Tick]:
    """The ticks of one note, from the cache or one `jj evolog` after a cheap `@` read.

    `@` is in the key because a save amends it: the digest alone would keep an
    answer from before a save that landed after the read, so `@` moves the key on.
    """
    commit = await history._read(root, "log", "-r", "@", "--no-graph", "-T", "commit_id")
    key = (path, digest, commit)
    if key not in _cache:
        output = await history._read(
            root,
            "evolog",
            "-r",
            f"latest(::@ & files({history.literal(path)}), {VERSIONS})",
            "--no-graph",
            "-p",
            "--git",
            "-T",
            TEMPLATE,
        )
        _cache[key] = _ticks(_versions(output, path))
        while len(_cache) > CACHE_SIZE:
            del _cache[next(iter(_cache))]

    return _cache[key]


async def attach(settings: Settings, found: share.Checklist) -> share.Checklist:
    """The list with `ticked_by` and `ticked_at` set on every done item the history can name.

    A list with no done item, a vault with no history and a note with a name
    jj cannot spell all answer the list as it is, with no jj call. A jj that
    fails, is missing or prints what this cannot read answers the same.
    """
    done = [item for item in found.items if item.done]
    if not done or not vcs.is_versioned(settings.vault_path):
        return found

    note = share.resolve_list(settings, found.name)
    path = f"{settings.share_folder}/{found.name}.md"
    if note is None or not note.is_file() or not history.plain(path):
        return found

    raw = note.read_bytes()
    keys = _keys(raw.decode("utf-8"))
    try:
        ticks = await _ticks_of(settings.vault_path, path, agent.digest(raw))
    except history.HistoryError, history.UnversionedError, ValueError:
        return found

    for item in done:
        key = keys.get(item.line)
        tick = None if key is None else ticks.get(key)
        if tick is not None:
            item.ticked_by, item.ticked_at = tick.who, tick.when

    return found
