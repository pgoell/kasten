"""The shared lists: Markdown checklists in one folder, read and ticked from the lists app.

A list is a note directly inside `settings.share_folder`, and nothing else is one.
Every name a request brings is spelled into a path here, so the check that the
note sits directly in the folder is the rule the routes depend on.

Edits are plain text on the note's lines. Only the task lines change, and every
other byte of the note goes back out as it came in.
"""

import re
import secrets
from datetime import date
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend import agent, todo_fields, vault

if TYPE_CHECKING:
    from kasten_backend.config import Settings

ITEM = re.compile(r"^- \[([ xX])\] (.*?)(\r?)$")
"""A top-level task line: its state, its words and the line ending an edit keeps.

Only the margin counts, so an indented task under another item is not a list
item and nothing here ticks it.
"""

FINISHED = re.compile(r"[ \t]*✅\N{VARIATION SELECTOR-16}?(?:[ \t]+[0-9]{4}-[0-9]{2}-[0-9]{2})?")
"""The done mark a tick writes and an untick takes away, with its date when it has one."""

ID_MARK = "🆔"
"""The Tasks id a ticked item gets, so the done line keeps one name across edits."""

FIELD_MARKS = re.compile(todo_fields.STOP + "|🔁|👤")
"""Where an item's words end: the Tasks fields kasten reads, and the two it adds.

`🔁` (recurrence) and `👤` (the assignee or the wait) are kasten's own fields, not Tasks plugin
ones, so `todo_fields.STOP` leaves them out and they are listed here.
"""

BLOCK_ID = re.compile(r"\s*\^[A-Za-z0-9_-]+$")
"""A trailing `^block-id`, which kasten uses to link into a line and is no word."""

PARTS = re.compile(r"^[ \t]+- \[.\] ")
"""An indented task: a part of the task above it, which kasten ticks along with it."""

TICK_IN_KASTEN = "Tick this one in kasten"
"""What a tick the share path leaves to kasten is answered with."""


class TickInKastenError(Exception):
    """A tick the share path refuses, because kasten has more to write than a tick does.

    The route answers it with 422, so the lists app shows the item is still open
    and tells the person to tick it in kasten, which writes the rest.
    """


class Item(BaseModel):
    """One task line: where it sits in the note, its words, its state and who it is for."""

    line: int
    """The 0-based index of the line in the note."""

    text: str
    done: bool

    assignee: str | None = None
    """Who the item is for, as written after an undated `👤`, or None. #810 reads and writes it."""


class Checklist(BaseModel):
    """One list, and the digest of the note it was read from."""

    name: str
    sha: str | None
    """The digest on disk, or None when there is no note yet."""

    items: list[Item]


def resolve_list(settings: Settings, name: str) -> Path | None:
    """The note a list name stands for, or None when the name reaches anywhere else.

    The folder and the note are both resolved and then compared, so a `..`, an
    absolute path, a nested name and a link in the folder that points out of it
    all fail the one comparison. A note that does not exist yet still resolves,
    because a first add creates it.
    """
    folder = vault.resolve_folder_path(settings.vault_path, settings.share_folder)
    note = vault.resolve_path(settings.vault_path, f"{settings.share_folder}/{name}.md")
    if folder is None or note is None or note.parent != folder:
        return None

    return note


def inside(settings: Settings, path: str) -> bool:
    """Whether a vault path is a note directly in the share folder.

    The filter `/share/events` puts on every change the watcher reports. Direct
    children only, to match the lists: a note deeper down is no list and its
    name stays off the stream too.
    """
    return PurePosixPath(path).parent == PurePosixPath(settings.share_folder)


def names(settings: Settings) -> list[str]:
    """The names of the lists in the share folder, sorted, or none when it is missing.

    A link in the folder that points out of it is no list, the same as a write to
    one is refused, so its name is not listed either.
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
    """Every task line of `text`, in order, with its words cut before any Tasks field."""
    found = []
    for number, line in enumerate(text.split("\n")):
        match = ITEM.match(line)
        if match is not None:
            found.append(
                Item(
                    line=number,
                    text=_words(match.group(2)),
                    done=match.group(1) != " ",
                    assignee=todo_fields.assignee(match.group(2)),
                )
            )

    return found


def _words(rest: str) -> str:
    """The words of an item: what is left before the first field marker, without its id."""
    return BLOCK_ID.sub("", FIELD_MARKS.split(rest, maxsplit=1)[0]).strip()


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

    `agent.save_note` checks the same digest again under the lock, which is what
    closes the race. This one runs first so a stale caller is answered with the
    current digest and not with a line count that no longer means anything.
    """
    current = None if raw is None else agent.digest(raw)
    if sha != current:
        raise agent.ConflictError(current)


def _kasten_owns(lines: list[str], line: int, rest: str) -> bool:
    """Whether ticking this item here would skip what kasten does with it.

    A recurring item gets its next occurrence written, and an item with parts has
    them ticked with it. Kasten does both on its own tick, so this path must not
    do the first half alone and leave the series stopped.
    """
    following = lines[line + 1] if line + 1 < len(lines) else ""

    return "🔁" in rest or PARTS.match(following) is not None


def _done(line: str) -> bool:
    """Whether a line is a task that is ticked."""
    match = ITEM.match(line)
    return match is not None and match.group(1) != " "


def _ticked(rest: str) -> str:
    """The words of an item as a done one: its done date and an id, the id last.

    An item that already has an id keeps it and gets its date before it, so the
    id does not move between edits.
    """
    rest = FINISHED.sub("", rest).rstrip()
    done = f"✅ {date.today().isoformat()}"
    if ID_MARK in rest:
        head, _, tail = rest.partition(ID_MARK)
        return f"{head.rstrip()} {done} {ID_MARK}{tail}"

    return f"{rest} {done} {ID_MARK} kt-{secrets.token_hex(3)}"


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

    # The line before the new one carries its own ending, so the new line takes a
    # CRLF only when something follows it. Written this way, a note without a
    # final newline does not gain a stray carriage return.
    ending = "\r" if "\r\n" in body and at < len(lines) else ""
    lines.insert(at, f"- [ ] {words}{ending}")

    return await _save(settings, name, "\n".join(lines), sha)


async def tick(settings: Settings, name: str, line: int, done: bool, sha: str) -> Checklist | None:
    """Tick or untick the task on `line`, or change nothing when it is not that state already.

    A line that is no task, or is out of range, answers the list as it is and
    writes nothing, the same as a tick already in the asked state.
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

    if done:
        lines[line] = f"- [x] {_ticked(rest)}{eol}"
    else:
        lines[line] = f"- [ ] {FINISHED.sub('', rest).rstrip()}{eol}"

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
