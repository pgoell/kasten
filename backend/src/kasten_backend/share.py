"""The shared lists: Markdown checklists in one folder, read and ticked from the lists app.

A list is a note directly inside `settings.share_folder`, and nothing else is one. Every name
a request brings is spelled into a path here, so that check is the rule the routes depend on.
Edits touch only the task lines; every other byte goes back out as it came in.
"""

import re
import secrets
from datetime import date
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from kasten_backend import agent, done_log, todo_fields, vault

if TYPE_CHECKING:
    from kasten_backend.config import Settings
    from kasten_backend.events import VaultEvent

ITEM = re.compile(r"^- \[([ xX])\] (.*?)(\r?)$")
"""A top-level task line: its state, its words and the line ending an edit keeps.

Only the margin counts, so an indented task under another item is not a list item.
"""

ID_MARK = "🆔"
"""The Tasks id a ticked item gets, so the done line keeps one name across edits."""

PARTS = re.compile(r"^[ \t]+- \[.\] ")
"""An indented task: a part of the task above it, which kasten ticks along with it."""

TICK_IN_KASTEN = "Tick this one in kasten"
"""What a tick the share path leaves to kasten is answered with."""


class TickInKastenError(Exception):
    """A tick the share path refuses, because kasten has more to write than a tick does.

    The route answers 422, so the lists app shows the item still open and tells the person to
    tick it in kasten. A tick or untick of an id another todo carries is refused the same way.
    """


class Item(BaseModel):
    """One task line: where it sits in the note, its words, its state and who it is for."""

    line: int
    """The 0-based index of the line in the note."""

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
    """Every task line of `text`, in order, with its words as the editor reads them."""
    found = []
    for number, line in enumerate(text.split("\n")):
        match = ITEM.match(line)
        if match is not None:
            found.append(
                Item(
                    line=number,
                    text=words(match.group(2)),
                    done=match.group(1) != " ",
                    assignee=todo_fields.assignee(match.group(2)),
                    key=key(match.group(2)) if match.group(1) != " " else None,
                )
            )

    return found


def key(rest: str) -> str:
    """What names an item across the history: its `🆔` when it reads one, else its words."""
    found = todo_fields.place(rest, todo_fields.ID)
    return words(rest) if found is None else rest[found[0] : found[1]]


def words(rest: str) -> str:
    """The words of an item with every field out, and no trailing block id."""
    return todo_fields.BLOCK_ID.sub("", todo_fields.words(rest).strip())


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


def _kasten_owns(lines: list[str], line: int, rest: str) -> bool:
    """Whether ticking this item here would skip what kasten does with it.

    Kasten writes a recurring item's next occurrence and ticks its parts with it. This path
    must not do one of those alone, and leave the series stopped.
    """
    following = lines[line + 1] if line + 1 < len(lines) else ""

    recurs = todo_fields.place(rest, todo_fields.RECURRENCE) is not None
    return recurs or PARTS.match(following) is not None


def _done(line: str) -> bool:
    """Whether a line is a task that is ticked."""
    match = ITEM.match(line)
    return match is not None and match.group(1) != " "


def _undone(rest: str) -> str:
    """The words without the done field the line reads, its date and all.

    Only the `✅ <date>` the reader takes goes, so a bare `✅` among the words stays.
    """
    found = todo_fields.place(rest, todo_fields.DONE)
    return rest.rstrip() if found is None else _without(rest, *found).rstrip()


def _ticked(rest: str, today: date) -> str:
    """The words of an item as a done one: its done date and an id, a block id last.

    An item that reads an id keeps it, with the date before it, so the id survives edits.
    A new id is made otherwise. A trailing block id stays last.
    """
    rest = _undone(rest)
    block = todo_fields.BLOCK_ID.search(rest)
    tail = "" if block is None else block[0]
    words = rest if block is None else rest[: block.start()]
    found = todo_fields.place(words, todo_fields.ID)
    if found is None:
        head, mark = words, f"{ID_MARK} kt-{secrets.token_hex(3)}"
    else:
        head, mark = words[: found[0]].rstrip(), words[found[0] :]
    # A block id that is the whole item has no blank of its own to keep it apart.
    tail = tail if tail[:1] in ("", " ", "\t") else f" {tail}"
    lead = f"{head} " if head else ""
    return f"{lead}✅ {today.isoformat()} {mark}{tail}"


NEW_FIELD_AT = re.compile(
    todo_fields.STOP + "|🔁|👤\N{VARIATION SELECTOR-16}?[ \t]+[0-9]{4}-[0-9]{2}-[0-9]{2}"
)
"""Where a new assignee goes: the first field marker, or a dated `👤` (the wait) that is one."""


def _assigned(rest: str, assignee: str | None) -> str:
    """The words of an item with its undated `👤` set to `assignee`, or cleared when it is None.

    A switch replaces the value in place, and a clear takes the blank before it. A new one goes
    before the first field, else a trailing block id, else at the end, so existing bytes stay put.
    The same assignee again is the same words, which is how a caller learns nothing is to write.
    """
    span = todo_fields.assignee_span(rest)
    if span is None:
        return rest if assignee is None else _with_new_assignee(rest, assignee)

    start, end = span
    if assignee is None:
        return _without(rest, start, end)

    value = f"[[{assignee}]]"
    if todo_fields.assignee(rest) == value:
        return rest

    return f"{rest[:start]}👤 {value}{rest[end:]}"


def _without(rest: str, start: int, end: int) -> str:
    """The words with `rest[start:end]` taken out, and the blank before it when a blank follows.

    A field glued to the span keeps the blank before it, so the field does not run into the words.
    """
    head, tail = rest[:start], rest[end:]
    if tail and tail[0] not in " \t":
        return head + tail

    head = head.rstrip(" \t")
    return head + tail if head else tail.lstrip(" \t")


def _with_new_assignee(rest: str, assignee: str) -> str:
    """The words with `👤 [[assignee]]` added where the reader finds no other field."""
    field = f"👤 [[{assignee}]]"
    marker = NEW_FIELD_AT.search(todo_fields.mask(rest))
    if marker is not None:
        return f"{rest[: marker.start()]}{field} {rest[marker.start() :]}"

    block = todo_fields.BLOCK_ID.search(rest)
    if block is not None and block.start() > 0:
        return f"{rest[: block.start()]} {field}{rest[block.start() :]}"

    end = len(rest.rstrip(" \t"))
    return f"{rest[:end]} {field}{rest[end:]}"


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


async def add(settings: Settings, name: str, text: str, sha: str | None) -> Checklist | None:
    """Append `- [ ] text` after the last task line, or at the end when there is none.

    The text is joined onto one line, since a newline in it would start a line
    the list does not own. A blank text is refused as an empty capture.
    """
    note = resolve_list(settings, name)
    if note is None:
        return None

    words = " ".join(text.split())
    if words == "":
        raise agent.EmptyCaptureError(agent.NOTHING)

    raw = _read_bytes(note)
    _agree(raw, sha)
    body = "" if raw is None else raw.decode("utf-8")
    lines = body.split("\n")
    numbers = [number for number, line in enumerate(lines) if ITEM.match(line)]
    if numbers:
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
    lines.insert(at, f"- [ ] {words}{ending}")

    return await _save(settings, name, "\n".join(lines), sha)


async def tick(  # noqa: PLR0913  the route's body, field by field, and the ticker's day
    settings: Settings, name: str, line: int, done: bool, sha: str, *, day: date | None = None
) -> Checklist | None:
    """Tick or untick the task on `line`, or change nothing when it is not that state already.

    A line that is no task, or is out of range, answers the list as it is and
    writes nothing, the same as a tick already in the asked state. `day` is the
    ticker's own date; without it the server's stands in.
    """
    note = resolve_list(settings, name)
    if note is None:
        return None

    raw = _read_bytes(note)
    _agree(raw, sha)
    lines = ("" if raw is None else raw.decode("utf-8")).split("\n")
    match = ITEM.match(lines[line]) if 0 <= line < len(lines) else None
    if match is None or (match.group(1) != " ") == done:
        return _shape(name, raw)

    rest, eol = match.group(2), match.group(3)
    if done and _kasten_owns(lines, line, rest):
        raise TickInKastenError(TICK_IN_KASTEN)
    path = f"{settings.share_folder}/{name}.md"
    if settings.share_logs_done:
        twin = await done_log.other_todo_with_id(settings, path, lines, line, rest)
        if twin is not None:
            raise TickInKastenError(twin)

    # One day for the stamp and the daily note: the ticker's, else the server's (#1300).
    today = day or date.today()
    if done:
        rest = _ticked(rest, today)
        lines[line] = f"- [x] {rest}{eol}"
    else:
        lines[line] = f"- [ ] {_undone(rest)}{eol}"

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
    note = resolve_list(settings, name)
    if note is None:
        return None

    raw = _read_bytes(note)
    _agree(raw, sha)
    lines = ("" if raw is None else raw.decode("utf-8")).split("\n")
    match = ITEM.match(lines[line]) if 0 <= line < len(lines) else None
    if match is None:
        return _shape(name, raw)

    rest, eol = match.group(2), match.group(3)
    edited = _assigned(rest, assignee)
    if edited == rest:
        return _shape(name, raw)

    lines[line] = f"- [{match.group(1)}] {edited}{eol}"
    return await _save(settings, name, "\n".join(lines), sha)


async def clear(settings: Settings, name: str, sha: str) -> Checklist | None:
    """Remove every ticked task line, and nothing else, or change nothing when none is ticked."""
    note = resolve_list(settings, name)
    if note is None:
        return None

    raw = _read_bytes(note)
    _agree(raw, sha)
    lines = ("" if raw is None else raw.decode("utf-8")).split("\n")
    kept = [line for line in lines if not _done(line)]
    if len(kept) == len(lines):
        return _shape(name, raw)

    return await _save(settings, name, "\n".join(kept), sha)
