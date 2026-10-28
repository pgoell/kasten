"""The done log: the `- ✅` line a tick writes under `## Done` in today's daily note.

The todo pane writes it in the browser, through `doneLine` and `doneLogWrites`
in `frontend/src/lib/todo/todo-write.ts`. The lists app ticks on the share host,
which reaches no `/api/*` route, so the server holds a copy for that one caller.
`frontend/tests/fixtures/done-lines.json` holds the lines and placements both
copies must produce, and a test on each side reads it, which is the cheapest
thing that fails when one copy is edited and not the other.
"""

import re
from typing import TYPE_CHECKING

from kasten_backend import agent, periodic, search, todo_fields, todos, vault
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

BLOCK_ID = re.compile(r"(?:^|[ \t]+)\^[A-Za-z0-9_-]+$")
"""A trailing block id, which `withoutBlockId` takes off the words. `[\\w-]` there is ASCII."""


def done_line(rest: str, note_path: str, daily_path: str, today: str) -> str:
    """The log line for a ticked item: its words, a link to its note, and its id.

    `rest` is the line after `- [x] `. The words are what the field reader
    leaves, so an assignee and every field go and tags stay, as in the pane.
    """
    parts = [LOGGED, today, BLOCK_ID.sub("", todo_fields.words(rest).strip())]
    # A note pointing at itself records nothing.
    if note_path != daily_path:
        parts.append(f"[[{note_path.removesuffix('.md')}]]")
    found = todo_fields.ID.search(todo_fields.mask(rest))
    if found is not None:
        parts.append(found[1])
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


def _id(rest: str) -> str | None:
    """The `🆔` an item's words carry, or None."""
    found = todo_fields.ID.search(todo_fields.mask(rest))
    return None if found is None else found[1]


async def _rewrite(
    settings: Settings, path: str, change: Callable[[str], str | None], fresh: str | None = None
) -> None:
    """Write one note as `change` makes it from the text on disk, read and written under one hold.

    For a write worked out from the note as it stands, such as the done log line
    a share tick adds to today's note: a browser save landing between a read and
    a write would otherwise be written over. `change` answers None to leave the
    note as it is. A note the vault does not hold starts from `fresh`, and is
    left unmade without one.
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
    """Write the done log line for the item `rest` in today's note, unless one names it already.

    The pane skips an id a `- ✅` line names anywhere, so ticking twice leaves one
    line rather than a pile, and so does this. Today's note is checked again
    under the lock the write takes, and is made as `<leader>gd` makes it where
    the vault has none.
    """
    id_ = _id(rest)
    if id_ is None:
        return
    daily = periodic.daily_path(today, settings.periodic_path)
    for path in await _holding(settings, id_, note_path):
        if path != daily and drop_done(_text(settings, path), id_) is not None:
            return

    line = done_line(rest, note_path, daily, today.isoformat())
    await _rewrite(
        settings,
        daily,
        lambda text: None if drop_done(text, id_) is not None else append_under(text, DONE, line),
        fresh=periodic.daily_note(today, settings.periodic_path),
    )


def _carries(line: str, id_: str) -> bool:
    """Whether `line` is a todo whose `🆔` is `id_`, as `parseTodo(line)?.id` reads it."""
    found = todos.LINE.fullmatch(line.removesuffix("\r"))
    return found is not None and _id(found[2] or "") == id_


async def other_todo_with_id(
    settings: Settings, note_path: str, lines: list[str], line: int, rest: str
) -> str | None:
    """What the pane's `otherTodoWithId` answers for the item on `line`, or None.

    An untick drops log lines by id, and a pasted copy of the item carries the
    same id, so the share untick refuses as the pane does rather than drop the
    line the other todo is logged by. `lines` is the list as the untick read it.
    """
    id_ = _id(rest)
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
    id_ = _id(rest)
    if id_ is None:
        return
    for path in await _holding(settings, id_, note_path):
        await _rewrite(settings, path, lambda text: drop_done(text, id_))
