"""The shared lists: Markdown checklists in one folder, read and ticked from the lists app.

A list is a note directly inside `settings.share_folder`, and nothing else is one. Every name
a request brings is spelled into a path here, so that check is the rule the routes depend on.
Edits touch only the task lines; every other byte goes back out as it came in.
"""

from datetime import date
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from kasten_backend import agent, done_log, todo_fields, vault
from kasten_backend.share.lines import (
    CLOSED,
    TASK,
    assigned,
    box,
    descendants,
    key,
    one_line,
    parents,
    retext,
    taken_along,
    ticked,
    undone,
    words,
)

if TYPE_CHECKING:
    import re
    from collections.abc import Callable

    from kasten_backend.config import Settings
    from kasten_backend.events import VaultEvent

TICK_IN_KASTEN = "Tick this one in kasten"
"""What a tick the share path leaves to kasten is answered with."""


class TickInKastenError(Exception):
    """A tick the share path refuses, because kasten has more to write than a tick does.

    The route answers 422, so the lists app shows the item still open and tells the person to
    tick it in kasten: a recurring item or part, and a tick or untick of an id another todo carries.
    """


class Item(BaseModel):
    """One task line: where it sits in the note, its words, its state and who it is for."""

    line: int
    """The 0-based index of the line in the note."""

    depth: int = 0
    """0 for an item, 1 for a part of the item above it, 2 for a part of that part, and so on."""

    text: str
    done: bool

    assignee: str | None = None
    """Who the item is for, as written after an undated `👤`, or None."""

    ticked_by: str | None = None
    """Who ticked the item, from the history, or None when no person's write made the tick."""

    ticked_at: str | None = None
    """When the item was ticked, ISO 8601 with its offset, or None when the history does not say."""

    key: str | None = Field(default=None, exclude=True)
    """What names a done item across the history: its `🆔`, else its words. Not sent to the app.

    Taken from the same bytes as the rest of the item, so it never reads a changed note.
    """


class Checklist(BaseModel):
    """One list, and the digest of the note it was read from."""

    name: str
    sha: str | None
    """The digest on disk, or None when there is no note yet."""

    items: list[Item]


def resolve_list(settings: Settings, name: str) -> Path | None:
    """The note a list name stands for, or None when the name reaches anywhere else.

    Both the folder and the note are resolved, then compared, so `..`, an absolute path, a
    nested name and an outward link all fail. A note not yet there still resolves, since a
    first add creates it.
    """
    folder = vault.resolve_folder_path(settings.vault_path, settings.share_folder)
    note = vault.resolve_path(settings.vault_path, f"{settings.share_folder}/{name}.md")
    if folder is None or note is None or note.parent != folder:
        return None

    return note


def inside(settings: Settings, path: str) -> bool:
    """Whether a vault path is a note directly in the share folder: the `/share/events` filter.

    Direct children only, to match the lists. A deeper note is no list, so its name stays off
    the stream too.
    """
    return PurePosixPath(path).parent == PurePosixPath(settings.share_folder)


def passes(settings: Settings, event: VaultEvent) -> bool:
    """Whether `/share/events` tells the share host of this change.

    A change to a list, and a `page` never: an html page in the share folder is
    no list, and its name and digest are not the share host's business.
    """
    return event.change != "page" and inside(settings, event.path)


def names(settings: Settings) -> list[str]:
    """The names of the lists in the share folder, sorted, or none when it is missing.

    A link in the folder that points out of it is no list, so its name is not listed either.
    """
    folder = vault.resolve_folder_path(settings.vault_path, settings.share_folder)
    if folder is None or not folder.is_dir():
        return []

    return sorted(
        note.stem
        for note in folder.iterdir()
        if note.suffix == vault.SUFFIX
        and note.is_file()
        and resolve_list(settings, note.stem) is not None
    )


def items(text: str) -> list[Item]:
    """Every task line of `text` at the margin, and the parts under one, in note order.

    A part counts only under a task the list shows: one under a `[/]` line or plain item stays out.
    """
    lines = text.split("\n")
    up = parents(lines)
    depth: dict[int, int] = {}
    found = []
    for number, line in enumerate(lines):
        match = TASK.match(line)
        if match is None or (match.group(1) and up.get(number) not in depth):
            continue
        parent = up.get(number)
        depth[number] = 0 if not match.group(1) or parent is None else depth[parent] + 1
        rest, done = match.group(3), match.group(2) != " "
        found.append(
            Item(
                line=number,
                depth=depth[number],
                text=words(rest),
                done=done,
                assignee=todo_fields.assignee(rest),
                key=key(rest) if done else None,
            )
        )

    return found


def _shape(name: str, raw: bytes | None) -> Checklist:
    """The list a note's bytes make, or the empty list a note that is not there makes."""
    if raw is None:
        return Checklist(name=name, sha=None, items=[])

    return Checklist(name=name, sha=agent.digest(raw), items=items(raw.decode("utf-8")))


def _read_bytes(note: Path) -> bytes | None:
    """The note's bytes, or None when there is no note to read."""
    return note.read_bytes() if note.is_file() else None


def _agree(raw: bytes | None, sha: str | None) -> None:
    """Refuse an edit whose caller read a different list, before the edit is worked out.

    `agent.save_note` checks the digest again under the lock, which closes the race. This runs
    first, so a stale caller gets the current digest, not a line count that means nothing.
    """
    current = None if raw is None else agent.digest(raw)
    if sha != current:
        raise agent.ConflictError(current)


def _lines(raw: bytes | None) -> list[str]:
    """The note's lines, an empty note's one empty line when there is none."""
    return ("" if raw is None else raw.decode("utf-8")).split("\n")


def _task(lines: list[str], line: int) -> re.Match[str] | None:
    """The task on `line`, or None when the line is no task or out of range."""
    return TASK.match(lines[line]) if 0 <= line < len(lines) else None


def _recurs(line: str) -> bool:
    """Whether an open todo line carries a `🔁`, whose next copy only kasten writes."""
    state = box(line)
    open_ = state is not None and state not in CLOSED
    return open_ and todo_fields.place(line, todo_fields.RECURRENCE) is not None


def _drop(lines: list[str], numbers: list[int]) -> str:
    """The note with the lines at `numbers` taken out, every other byte as it was."""
    gone = set(numbers)
    return "\n".join(line for number, line in enumerate(lines) if number not in gone)


async def _save(settings: Settings, name: str, content: str, sha: str | None) -> Checklist | None:
    """Write the list through the agent's conditional save, and answer with what landed."""
    saved = await agent.save_note(settings, f"{settings.share_folder}/{name}.md", content, sha)
    if saved is None:
        return None

    return _shape(name, saved.content.encode("utf-8"))


async def read(settings: Settings, name: str) -> Checklist | None:
    """One list, or None when the name is not a list in the share folder."""
    note = resolve_list(settings, name)
    if note is None:
        return None

    return _shape(name, _read_bytes(note))


async def add(
    settings: Settings, name: str, text: str, sha: str | None, under: int | None = None
) -> Checklist | None:
    """Append `- [ ] text` after the last task line, or as a part of the task on line `under`.

    A part goes after the parts the task has, two spaces further in, as the todo pane's `s`
    writes one. The text is joined onto one line; a blank one is refused as an empty capture.
    """
    note = resolve_list(settings, name)
    if note is None:
        return None

    text = one_line(text)
    if text == "":
        raise agent.EmptyCaptureError(agent.NOTHING)

    raw = _read_bytes(note)
    _agree(raw, sha)
    body = "" if raw is None else raw.decode("utf-8")
    lines = body.split("\n")
    parent = None if under is None else _task(lines, under)
    numbers = [number for number, line in enumerate(lines) if TASK.match(line)]
    indent = ""
    if parent is not None and under is not None:
        at, indent = max([under, *descendants(lines, under)]) + 1, f"{parent.group(1)}  "
    elif numbers:
        at = numbers[-1] + 1
    elif lines[-1] == "":
        # A note ending in a newline has an empty last element, and the new line
        # goes before it so the note keeps its final newline.
        at = len(lines) - 1
    else:
        at = len(lines)

    # The new line takes a CRLF only when something follows it, so a note without a final
    # newline gains no stray carriage return.
    ending = "\r" if "\r\n" in body and at < len(lines) else ""
    lines.insert(at, f"{indent}- [ ] {text}{ending}")

    return await _save(settings, name, "\n".join(lines), sha)


async def tick(  # noqa: PLR0913  the route's body, field by field, and the ticker's day
    settings: Settings, name: str, line: int, done: bool, sha: str, *, day: date | None = None
) -> Checklist | None:
    """Tick or untick the task on `line`, or change nothing when it is not that state already.

    A tick takes the open parts along, as kasten's does; an untick leaves them. A line that is
    no task answers the list as it is. `day` is the ticker's date, else the server's stands in.
    """
    note = resolve_list(settings, name)
    if note is None:
        return None

    raw = _read_bytes(note)
    _agree(raw, sha)
    lines = _lines(raw)
    match = _task(lines, line)
    if match is None or (match.group(2) != " ") == done:
        return _shape(name, raw)

    indent, rest, eol = match.group(1), match.group(3), match.group(4)
    parts = descendants(lines, line) if done else []
    if done and any(_recurs(lines[number]) for number in [line, *parts]):
        raise TickInKastenError(TICK_IN_KASTEN)
    path = f"{settings.share_folder}/{name}.md"
    if settings.share_logs_done:
        twin = await done_log.other_todo_with_id(settings, path, lines, line, rest)
        if twin is not None:
            raise TickInKastenError(twin)

    # One day for the stamp and the daily note: the ticker's, else the server's (#1300).
    today = day or date.today()
    if done:
        rest = ticked(rest, today)
        lines[line] = f"{indent}- [x] {rest}{eol}"
        for number in parts:
            lines[number] = taken_along(lines[number], today)
    else:
        lines[line] = f"{indent}- [ ] {undone(rest)}{eol}"

    saved = await _save(settings, name, "\n".join(lines), sha)
    # The list first, then the log: a write that fails between them leaves the
    # item ticked with no log line, which is what a tick wrote before #726.
    if saved is not None and settings.share_logs_done:
        if done:
            await done_log.log(settings, path, rest, today)
        else:
            await done_log.unlog(settings, path, rest)

    return saved


async def assign(
    settings: Settings, name: str, line: int, assignee: str | None, sha: str
) -> Checklist | None:
    """Set or clear the undated `👤` of the task on `line`, or change nothing when it is so already.

    A line that is no task, or is out of range, answers the list as it is. The caller has checked
    that `assignee` is a known person, so nothing else is written into the line.
    """
    return await _rewrite(settings, name, line, sha, lambda rest: assigned(rest, assignee))


async def edit(settings: Settings, name: str, line: int, text: str, sha: str) -> Checklist | None:
    """Put `text` in for the words of the task on `line`, its box, indent and fields as they were.

    Text that leaves the item no words, blank or only fields, is refused as an empty capture.
    """
    if words(retext("", text)) == "":
        raise agent.EmptyCaptureError(agent.NOTHING)

    return await _rewrite(settings, name, line, sha, lambda rest: retext(rest, text))


async def _rewrite(
    settings: Settings, name: str, line: int, sha: str, change: Callable[[str], str]
) -> Checklist | None:
    """Write the task on `line` with its words through `change`, or nothing when they stay."""
    note = resolve_list(settings, name)
    if note is None:
        return None

    raw = _read_bytes(note)
    _agree(raw, sha)
    lines = _lines(raw)
    match = _task(lines, line)
    edited = None if match is None else change(match.group(3))
    if match is None or edited == match.group(3):
        return _shape(name, raw)

    lines[line] = f"{match.group(1)}- [{match.group(2)}] {edited}{match.group(4)}"
    return await _save(settings, name, "\n".join(lines), sha)


async def delete(settings: Settings, name: str, line: int, sha: str) -> Checklist | None:
    """Take the task on `line` out of the note, and its parts with it; the history keeps them."""
    note = resolve_list(settings, name)
    if note is None:
        return None

    raw = _read_bytes(note)
    _agree(raw, sha)
    lines = _lines(raw)
    if _task(lines, line) is None:
        return _shape(name, raw)

    return await _save(settings, name, _drop(lines, [line, *descendants(lines, line)]), sha)


async def clear(settings: Settings, name: str, sha: str) -> Checklist | None:
    """Remove every ticked item at the margin with its parts, or change nothing when none is ticked.

    An item with a part still open stays, so no open work goes. A done part of an open item stays
    with it, counted in its `1/3`.
    """
    note = resolve_list(settings, name)
    if note is None:
        return None

    raw = _read_bytes(note)
    _agree(raw, sha)
    lines = _lines(raw)
    gone: list[int] = []
    for number, line in enumerate(lines):
        match = TASK.match(line)
        if match is None or match.group(1) or match.group(2) == " ":
            continue
        parts = descendants(lines, number)
        if all((box(lines[part]) or "x") in CLOSED for part in parts):
            gone += [number, *parts]
    if not gone:
        return _shape(name, raw)

    return await _save(settings, name, _drop(lines, gone), sha)
