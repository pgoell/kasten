"""How one task line of a shared list reads and is rewritten: words, ticks, assignees and parts.

Pure functions over strings. Each rewrite touches only what it names; every other byte stays.
"""

import re
import secrets
from datetime import date  # noqa: TC003  a stamp is written from it

from kasten_backend import todo_fields, todos

TASK = re.compile(r"^([ \t]*)- \[([ xX])\] (.*?)(\r?)$")
"""A task line at any indent: its indent, its state, its words and the line ending an edit keeps."""

ID_MARK = "🆔"
"""The Tasks id a ticked item gets, so the done line keeps one name across edits."""

CLOSED = "xX-"
"""The boxes a part counts closed by, which a parent's tick leaves alone."""


def words(rest: str) -> str:
    """The words of an item with every field out, and no trailing block id."""
    return todo_fields.BLOCK_ID.sub("", todo_fields.words(rest).strip())


def key(rest: str) -> str:
    """What names an item across the history: its `🆔` when it reads one, else its words."""
    found = todo_fields.place(rest, todo_fields.ID)
    return words(rest) if found is None else rest[found[0] : found[1]]


def one_line(text: str) -> str:
    """The text an add or edit writes: its words joined by single spaces, on one line."""
    return " ".join(text.split())


def kept(text: str) -> str:
    """The words an add of `text` shows as on the list, which the app counts a landed add by."""
    return words(one_line(text))


def parents(lines: list[str]) -> dict[int, int | None]:
    """The todo each todo line of a note is a part of, as kasten reads parts (`todos.parents`)."""
    return todos.parents((number, line.removesuffix("\r")) for number, line in enumerate(lines))


def descendants(lines: list[str], line: int) -> list[int]:
    """Every todo line under `line`, parts of parts too, in note order."""
    up = parents(lines)
    found: set[int] = {line}
    for number in sorted(up):
        if up[number] in found:
            found.add(number)
    return sorted(found - {line})


def box(line: str) -> str | None:
    """The state a todo line's box holds, in any of the seven states, or None for no todo."""
    todo = todos.LINE.fullmatch(line.removesuffix("\r"))
    return None if todo is None else line[len(todo[1]) + 3]


def without(rest: str, start: int, end: int) -> str:
    """The words with `rest[start:end]` taken out, and the blank before it when a blank follows.

    A field glued to the span keeps the blank before it, so the field does not run into the words.
    """
    head, tail = rest[:start], rest[end:]
    if tail and tail[0] not in " \t":
        return head + tail

    head = head.rstrip(" \t")
    return head + tail if head else tail.lstrip(" \t")


def undone(rest: str) -> str:
    """The words without the done field the line reads, its date and all.

    Only the `✅ <date>` the reader takes goes, so a bare `✅` among the words stays.
    """
    found = todo_fields.place(rest, todo_fields.DONE)
    if found is None:
        return rest.rstrip()

    head, tail = rest[: found[0]], rest[found[1] :]
    # Words the field kept apart stay apart where, glued, they would read differently (#1491).
    # A no-break space keeps them apart too, though the reader does not squeeze it.
    apart = head[-1:].isspace() or tail[:1].isspace()
    if head and not apart and words(head + tail) != words(f"{head} {tail}"):
        return f"{head} {tail}".rstrip()

    return without(rest, *found).rstrip()


def ticked(rest: str, today: date, *, named: bool = True) -> str:
    """The words of an item as a done one: its done date and, when `named`, an id, a block id last.

    An item that reads an id keeps it, with the date before it, so the id survives edits.
    A new id is made otherwise. A part a parent's tick takes along is not `named` (state-changes).
    """
    rest = undone(rest)
    block = todo_fields.BLOCK_ID.search(rest)
    tail = "" if block is None else block[0]
    body = rest if block is None else rest[: block.start()]
    found = todo_fields.place(body, todo_fields.ID)
    if found is not None:
        head, mark = body[: found[0]].rstrip(), f" {body[found[0] :]}"
    else:
        head, mark = body, f" {ID_MARK} kt-{secrets.token_hex(3)}" if named else ""
    # A block id that is the whole item has no blank of its own to keep it apart.
    tail = tail if tail[:1] in ("", " ", "\t") else f" {tail}"
    lead = f"{head} " if head else ""
    return f"{lead}✅ {today.isoformat()}{mark}{tail}"


def taken_along(line: str, today: date) -> str:
    """A part as its parent's tick leaves it: done with today's `✅`, a wait's dated `👤` gone.

    A closed part, or a line that is no todo, comes back as it was.
    """
    state = box(line)
    if state is None or state in CLOSED:
        return line
    todo = todos.LINE.fullmatch(line.removesuffix("\r"))
    assert todo is not None  # noqa: S101  `box` read it
    rest, eol = todo[2] or "", "\r" if line.endswith("\r") else ""
    wait = todo_fields.place(rest, todo_fields.WAITING)
    rest = rest if wait is None else without(rest, *wait)
    return f"{todo[1]}- [x] {ticked(rest, today, named=False)}{eol}"


def retext(rest: str, text: str) -> str:
    """The words of an item replaced by `text`, every field and a trailing block id kept as written.

    Words between fields, such as a tag after the assignee, are words too, so they go with the rest.
    """
    block = todo_fields.BLOCK_ID.search(rest)
    body = rest if block is None else rest[: block.start()]
    fields = [body[start:end] for start, end in todo_fields.field_spans(body)]
    return " ".join([one_line(text), *fields]) + ("" if block is None else block[0])


NEW_FIELD_AT = re.compile(
    todo_fields.STOP + "|🔁|👤\N{VARIATION SELECTOR-16}?[ \t]+[0-9]{4}-[0-9]{2}-[0-9]{2}"
)
"""Where a new assignee goes: the first field marker, or a dated `👤` (the wait) that is one."""


def assigned(rest: str, assignee: str | None) -> str:
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
        return without(rest, start, end)

    value = f"[[{assignee}]]"
    if todo_fields.assignee(rest) == value:
        return rest

    return f"{rest[:start]}👤 {value}{rest[end:]}"


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
