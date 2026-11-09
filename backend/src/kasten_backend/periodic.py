"""Today's daily note, and the section of it the day's loose thoughts collect in.

The note is the one `<leader>gd` makes, built by `frontend/src/lib/notes/text/periodic.ts`. The
server needs its own copy of the day's template for the capture route, so
`frontend/tests/fixtures/daily-notes.json` holds the text both copies must produce.
"""

import re
from datetime import date, timedelta
from typing import TYPE_CHECKING

from kasten_backend.code_spans import code_spans, fence_open, inside
from kasten_backend.config import DEFAULTS
from kasten_backend.frontmatter import body_start

if TYPE_CHECKING:
    from pathlib import Path

DAILY = "00 Daily"
"""Where the day's notes live, inside `KASTEN_PERIODIC_PATH`.

`FOLDER.daily` in `periodic.ts` is the other copy.
"""

WEEKLY = "01 Weekly"
"""Where the week a day links up to lives, beside the days."""

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
"""Spelled out rather than read off `strftime("%A")`, which answers in the locale."""

DUMP = "## Dump"
"""The heading `/close-day` reads the day's unsorted thoughts from."""

SECTION_END = re.compile(r"^#{1,2} ")
"""A heading at the dump's own level or above, which is where the dump stops.

Not every heading: a `###` inside the dump is part of what was dumped. `log.py` ends a
`## Log` section by the same rule.
"""

DAY_NOTE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}\.md")
"""A daily note's name. A pattern, since `date.fromisoformat` also takes `20261020`."""

ANY_HEADING = re.compile(r"^#{1,6} ")
"""Where a section `append_under` writes ends: any heading, as `sectionEnd` in `note-section.ts`."""


def daily_path(day: date, periodic: str = DEFAULTS.periodic_path) -> str:
    """Where the note for `day` lives, relative to the vault root."""
    return f"{periodic}/{DAILY}/{day.isoformat()}.md"


def daily_note(day: date, periodic: str = DEFAULTS.periodic_path) -> str:
    """The text `<leader>gd` gives a daily note it makes, frontmatter and all."""
    year, week, _ = day.isocalendar()
    before = daily_path(day - timedelta(days=1), periodic).removesuffix(".md")
    after = daily_path(day + timedelta(days=1), periodic).removesuffix(".md")
    nav = f"[[{before}]] | [[{periodic}/{WEEKLY}/{year}-W{week:02d}]] | [[{after}]]"

    return (
        f"---\ntype: Periodic Note\n---\n\n"
        f"# {day.isoformat()} {WEEKDAYS[day.weekday()]}\n\n{nav}\n\n## TODOs\n"
    )


FENCE_LINE = re.compile(r"^[ \t]*(`{3,}|~{3,})")
"""The run of a line markdown-it opens a fence on, nested list items' four spaces too (#1550)."""


def _live(text: str) -> list[bool]:
    """Per line of `text`, whether it is the note's own text and not frontmatter or code.

    Fences are found in the body alone, so a fence the frontmatter seems to open hides
    nothing below it.
    """
    body = body_start(text)
    spans = [(start + body, end + body) for start, end in code_spans(text[body:])]
    live = []
    offset = 0
    for line in text.split("\n"):
        start, offset = offset, offset + len(line) + 1
        live.append(start >= body and not inside(start, spans))
    return live


def _open_fence(text: str, lines: list[str], *, frontmatter: bool = True) -> str | None:
    """The run of the fence that runs to the note's end, such as "```", or None.

    `code_spans` decides which line opens a fence, not a line-by-line read: markdown-it
    rules a backtick run with a backtick after it opens nothing. A capture has no
    frontmatter to skip, hence `frontmatter=False`.
    """
    body = body_start(text) if frontmatter else 0
    last = len(text) - 1 - body
    found = next((span for span in code_spans(text[body:]) if span[0] <= last < span[1]), None)
    if found is None:
        return None
    opener = text.count("\n", 0, body + found[0])
    marker = FENCE_LINE.match(lines[opener])
    if marker is None:
        return None
    return marker[1] if fence_open(text[body:], opener - text.count("\n", 0, body)) else None


def _close(text: str, fence: str, *, frontmatter: bool = True) -> str:
    """`text` with a closing line for `fence` after its last character, if that line closes it.

    A bare line at column 0 does not close an inline span or a fence in a list item, so
    the line is left out then rather than opening a new fence.
    """
    closed = f"{text}{fence}\n" if text.endswith("\n") else f"{text}\n{fence}"
    if _open_fence(closed, closed.split("\n"), frontmatter=frontmatter) is not None:
        return text
    return closed


def _section(
    text: str, heading: str = DUMP, ends: re.Pattern[str] = SECTION_END
) -> tuple[int | None, int]:
    """The line `heading` is read from, or None, and the line its section ends at.

    The section ends at the next live heading at its level or above, or at the note's end.
    """
    lines = text.split("\n")
    live = _live(text)
    at = next(
        (index for index, line in enumerate(lines) if live[index] and line.rstrip() == heading),
        None,
    )
    if at is None:
        return None, len(lines)
    end = next(
        (index for index in range(at + 1, len(lines)) if live[index] and ends.match(lines[index])),
        len(lines),
    )
    return at, end


def append_dump(text: str, capture: str) -> str:
    """`text` with `capture` as a paragraph of its own at the end of `## Dump`.

    The capture is a paragraph, not a list item, and never lands inside a fence. A
    fence nobody closed at the note's end is closed first.
    """
    capture_fence = _open_fence(capture, capture.split("\n"), frontmatter=False)
    if capture_fence is not None:
        capture = _close(capture, capture_fence, frontmatter=False)

    at, end = _section(text)
    lines = text.split("\n")
    fence = _open_fence(text, lines)
    if fence is not None and (at is None or end == len(lines)):
        text = _close(text, fence)
        lines = text.split("\n")
        at, end = _section(text)

    if at is None:
        return f"{text.rstrip(chr(10))}\n\n{DUMP}\n{capture}\n"

    last = end
    while last > at + 1 and lines[last - 1].strip() == "":
        last -= 1

    # An empty dump takes the capture straight under its heading, as the ritual writes it.
    written = [*lines[:last], *([""] if last > at + 1 else []), capture]
    rest = lines[end:]

    return "\n".join([*written, "", *rest] if rest else [*written, ""])


def section_lines(text: str, heading: str) -> list[str]:
    """The lines under `heading` to its section's end, found as `append_under` finds it."""
    at, end = _section(text, heading, ANY_HEADING)
    return [] if at is None else text.split("\n")[at + 1 : end]


def append_under(text: str, heading: str, line: str) -> str:
    """`text` with `line` at the end of `heading`'s section, made at the end where there is none.

    `appendUnder` in `note-section.ts` is the other copy, and
    `frontend/tests/fixtures/done-lines.json` holds the placements both must produce.
    A fence nobody closed at the end gets its closer first, as in `append_dump`.
    """
    at, end = _section(text, heading, ANY_HEADING)
    lines = text.split("\n")
    fence = _open_fence(text, lines)
    if fence is not None and (at is None or end == len(lines)):
        text = _close(text, fence)
        lines = text.split("\n")
        at, end = _section(text, heading, ANY_HEADING)

    if at is None:
        return f"{text.rstrip(chr(10))}\n\n{heading}\n{line}\n"

    while end > at + 1 and lines[end - 1].strip() == "":
        end -= 1

    # Nothing follows the section, so the line goes on the end with a newline in
    # front of it rather than behind.
    if end == len(lines):
        return f"{text}\n{line}"

    return "\n".join([*lines[:end], line, *lines[end:]])


def day_notes(folder: Path, first: date, last: date) -> list[date]:
    """The days from `first` to `last` that have a daily note in `folder`, in order."""
    # Zero-padded names sort in date order, so the sort is the chronology.
    found: list[date] = []
    for name in sorted(item.name for item in folder.iterdir()):
        if DAY_NOTE.fullmatch(name) is None:
            continue
        try:
            day = date.fromisoformat(name.removesuffix(".md"))
        except ValueError:
            # Shaped like a date and no real one, such as 2026-02-30.
            continue
        if first <= day <= last:
            found.append(day)
    return found


def heading_lines(text: str, heading: str) -> list[tuple[int, str]] | None:
    """The lines under every `heading` section of `text`, numbered, or None with no section.

    Each line is judged by its start offset. A fence `code_spans` finds, and the frontmatter
    `body_start` skips, hold no heading and no entry. `## Log` and `## Training` are read so.
    """
    body = body_start(text)
    # Fences are found in the body alone, so a fence the frontmatter seems to open
    # hides nothing below it.
    spans = [(start + body, end + body) for start, end in code_spans(text[body:])]
    lines: list[tuple[int, str]] = []
    seen = False
    within = False
    offset = 0
    for number, line in enumerate(text.split("\n"), 1):
        start, offset = offset, offset + len(line) + 1
        if start < body or inside(start, spans):
            continue
        # The heading matches the section end too, so the flag is set from it here.
        if SECTION_END.match(line):
            within = line.rstrip() == heading
            seen = seen or within
        elif within:
            lines.append((number, line))
    return lines if seen else None
