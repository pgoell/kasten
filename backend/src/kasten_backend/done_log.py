"""The done log: the `- ✅` line a tick writes under `## Done` in today's daily note.

The browser writes the same line through `doneLine` in `frontend/src/lib/todo/todo-write.ts`.
The share host reaches no `/api/*` route, so the server keeps a copy for that caller.
The fixture `frontend/tests/fixtures/done-lines.json` holds what both copies must produce.
"""

import re
from typing import TYPE_CHECKING

from kasten_backend import periodic, search, todo_fields, todos, vault
from kasten_backend.agent import capabilities as agent
from kasten_backend.change import vault_change, vault_write
from kasten_backend.folders import create_note
from kasten_backend.frontmatter import body_start
from kasten_backend.periodic import append_under

if TYPE_CHECKING:
    from collections.abc import Callable
    from datetime import date

    from kasten_backend.config import Settings

__all__ = [
    "DONE",
    "append_under",
    "done_line",
    "drop_done",
    "log",
    "other_todo_with_id",
    "unlog",
]

DONE = "## Done"
"""The heading the done log lives under, made on first write."""

LOGGED = "- ✅"
"""A log line, which is deliberately not a checkbox, for the reason `doneLine` gives."""


def done_line(rest: str, note_path: str, daily_path: str, today: str) -> str:
    """The log line for a ticked item: its words, a link to its note, and its id.

    `rest` is the line after `- [x] `. Fields go and tags stay, as in the pane.
    """
    parts = [LOGGED, today, todo_fields.BLOCK_ID.sub("", todo_fields.words(rest).strip())]
    # A note pointing at itself records nothing.
    if note_path != daily_path:
        parts.append(f"[[{note_path.removesuffix('.md')}]]")
    found = todo_fields.id_of(rest)
    if found is not None:
        parts.append(found)
    return " ".join(parts)


FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)")
"""The run that opens or closes a fenced block, and what follows it, as `note-section.ts` has it."""


def _names(line: str, id_: str) -> bool:
    """Whether a line is the log's and names this id, as `namesInLog` reads it.

    Its last `kt-` word, or its last word where it has none (#1301).
    """
    if not line.lstrip().startswith(LOGGED):
        return False
    words = line.split()
    ids = [word for word in words if word.startswith("kt-")]
    return (ids or words)[-1] == id_


def _fenced(lines: list[str]) -> set[int]:
    """The lines in a fenced block, fences included, as `fencedLines` finds them."""
    coded: set[int] = set()
    run: str | None = None
    for index, line in enumerate(lines):
        match = FENCE.match(line)
        if run is None:
            if match is not None and (match[1][0] == "~" or "`" not in match[2]):
                run = match[1]
                coded.add(index)
            continue
        fence = None if match is None else match[1]
        if fence is not None and fence[0] == run[0] and len(fence) >= len(run):
            run = None if line.strip() == fence else run
        coded.add(index)
    return coded


def drop_done(text: str, id_: str) -> str | None:
    """Drop every `- ✅` line naming `id_`, none in a fence. None where the note holds none."""
    lines = text.split("\n")
    # The body alone, as `append_under` reads it: a fence the frontmatter seems
    # to open hides nothing below it.
    above = text[: body_start(text)].count("\n")
    coded = {at + above for at in _fenced(lines[above:])}
    kept = [line for at, line in enumerate(lines) if at in coded or not _names(line, id_)]
    return None if len(kept) == len(lines) else "\n".join(kept)


async def rewrite(
    settings: Settings, path: str, change: Callable[[str], str | None], fresh: str | None = None
) -> None:
    """Write one note as `change` makes it from the text on disk, under one hold.

    Read and write happen under one lock, so a browser save landing between them is not
    written over. `change` answers None to leave the note alone. A note the vault does not
    hold starts from `fresh`, and is left unmade without one.
    """
    note = vault.resolve_path(settings.vault_path, path)
    if note is None:
        return

    relative = vault.relative_path(settings.vault_path, note)
    async with vault_write():
        previous = note.read_bytes() if note.is_file() else None
        held = fresh if previous is None else previous.decode("utf-8")
        changed = None if held is None else change(held)
        if changed is None:
            return

        content = agent._bounded(note, agent._write(relative, changed, previous))
        async with vault_change(settings.vault_path, relative):
            if previous is None:
                create_note(note, content)
            else:
                vault.write_note(note, content)


def _text(settings: Settings, path: str) -> str:
    """A note's text, or nothing where it went since the search found it."""
    note = vault.resolve_path(settings.vault_path, path)
    return note.read_text(encoding="utf-8") if note is not None and note.is_file() else ""


async def _holding(settings: Settings, id_: str, note_path: str) -> list[str]:
    """Every note but the item's own that holds `id_`, the archive left out as in the pane."""
    found = await search.notes_holding(settings.vault_path, id_, skip=settings.archive_path)
    return [path for path in found if path != note_path]


async def log(settings: Settings, note_path: str, rest: str, today: date) -> None:
    """Write the done log line for the item `rest` in today's note, unless one names it.

    The pane skips an id a `- ✅` line names anywhere, so ticking twice leaves one line.
    Today's note is checked again under the write's lock.
    """
    id_ = todo_fields.id_of(rest)
    if id_ is None:
        return
    daily = periodic.daily_path(today, settings.periodic_path)
    for path in await _holding(settings, id_, note_path):
        if path != daily and drop_done(_text(settings, path), id_) is not None:
            return

    line = done_line(rest, note_path, daily, today.isoformat())
    await rewrite(
        settings,
        daily,
        lambda text: None if drop_done(text, id_) is not None else append_under(text, DONE, line),
        fresh=periodic.daily_note(today, settings.periodic_path),
    )


def _carries(line: str, id_: str) -> bool:
    """Whether `line` is a todo whose `🆔` is `id_`, as `parseTodo(line)?.id` reads it."""
    found = todos.LINE.fullmatch(line.removesuffix("\r"))
    return found is not None and todo_fields.id_of(found[2] or "") == id_


async def other_todo_with_id(
    settings: Settings, note_path: str, lines: list[str], line: int, rest: str
) -> str | None:
    """What the pane's `otherTodoWithId` answers for the item on `line`, or None.

    A tick and an untick find log lines by id, and a pasted copy carries the same id, so the
    share tick refuses either as the pane does (#1303). `lines` is the list as the tick read it.
    """
    id_ = todo_fields.id_of(rest)
    if id_ is None:
        return None
    others = [
        f"{note_path} line {at + 1}"
        for at, found in enumerate(lines)
        if at != line and _carries(found, id_)
    ]
    for path in await _holding(settings, id_, note_path):
        others += [
            f"{path} line {at + 1}"
            for at, found in enumerate(_text(settings, path).split("\n"))
            if _carries(found, id_)
        ]
    if not others:
        return None
    more = f", and {len(others) - 1} more" if len(others) > 1 else ""
    return f"🆔 {id_} is on another todo too: {others[0]}{more}"


async def unlog(settings: Settings, note_path: str, rest: str) -> None:
    """Drop every `- ✅` line naming the item's id, wherever it is, as the pane's untick does."""
    id_ = todo_fields.id_of(rest)
    if id_ is None:
        return
    for path in await _holding(settings, id_, note_path):
        await rewrite(settings, path, lambda text: drop_done(text, id_))
