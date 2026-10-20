"""Today's daily note, and the section of it the day's loose thoughts collect in.

The note is the one `<leader>gd` makes, which `frontend/src/lib/periodic.ts`
builds. That module owns all five periodic notes, and the key, the todo prompt
and the week's arithmetic all read it, so it stays where it is and the day's
template is mirrored here rather than moved. The capture route makes the note
on the server with nothing but a date in hand, so the server needs a copy.
`frontend/tests/fixtures/daily-notes.json` holds the text both copies must
produce and a test on each side reads it, which is the cheapest thing that
fails when one copy is edited and not the other.
"""

import re
from datetime import date, timedelta

from kasten_backend.code_spans import code_spans, inside
from kasten_backend.config import DEFAULTS
from kasten_backend.frontmatter import body_start

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

Not every heading: a `###` written inside the dump is part of what was dumped.
`log.py` ends a `## Log` section by the same rule.
"""


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


FENCE_LINE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
"""A line that opens or closes a fenced block, read the way `note-section.ts` reads one."""


def _live(text: str) -> list[bool]:
    """Per line of `text`, whether the line is the note's own text and not frontmatter or code.

    Each line is judged by its start offset, as `log.py` judges its lines. The
    fences are found in the body alone, so a fence the frontmatter seems to open
    hides nothing below it.
    """
    body = body_start(text)
    spans = [(start + body, end + body) for start, end in code_spans(text[body:])]
    live = []
    offset = 0
    for line in text.split("\n"):
        start, offset = offset, offset + len(line) + 1
        live.append(start >= body and not inside(start, spans))
    return live


def _open_fence(text: str, lines: list[str]) -> int | None:
    """The index of the line opening a fence that runs to the note's end, or None.

    markdown-it decides which line opens a fence, so `code_spans` is asked rather
    than the lines read one by one: a backtick run with a backtick after it opens
    nothing, and a four-backtick span is no closer for a three-backtick fence. The
    span holding the note's last character is the fence; a closing line after its
    opener means it was closed after all.
    """
    body = body_start(text)
    last = len(text) - 1 - body
    found = next((span for span in code_spans(text[body:]) if span[0] <= last < span[1]), None)
    if found is None:
        return None
    opener = text.count("\n", 0, body + found[0])
    marker = FENCE_LINE.match(lines[opener])
    if marker is None:
        return None
    fence = marker[1]
    closed = any(
        (stripped := line.strip()) == fence[0] * len(stripped) and len(stripped) >= len(fence)
        for line in lines[opener + 1 :]
    )
    return None if closed else opener


def _heading(text: str, lines: list[str], live: list[bool]) -> int | None:
    """The line `## Dump` is read from, or None when the note has none.

    The first live line that is the heading. A note ending inside a fence nobody
    closed has the readers take that fence as its text, so a heading made at its
    end would be one they never see: the `## Dump` inside the fence is used instead.
    """
    at = next(
        (index for index, line in enumerate(lines) if live[index] and line.rstrip() == DUMP),
        None,
    )
    if at is not None:
        return at

    opened = _open_fence(text, lines)
    if opened is None:
        return None
    return next(
        (index for index in range(opened + 1, len(lines)) if lines[index].rstrip() == DUMP),
        None,
    )


def append_dump(text: str, capture: str) -> str:
    """`text` with `capture` as a paragraph of its own at the end of `## Dump`.

    The dump is prose, so a capture is a paragraph rather than a list item, a
    blank line apart from the one before it. A note with no dump gets one at its
    end, which is where the ritual writes it by hand at 17:00. A section that
    follows the dump keeps the blank line in front of its heading: `/close-day`
    writes one there, and a capture pushed under the gap would read as its.

    The heading and its end are found the way `log.py` finds `## Log`: a line in
    the frontmatter or in a fence is neither, so a dump written in code is not the
    section.
    """
    lines = text.split("\n")
    live = _live(text)
    at = _heading(text, lines, live)

    if at is None:
        return f"{text.rstrip(chr(10))}\n\n{DUMP}\n{capture}\n"

    end = next(
        (
            index
            for index in range(at + 1, len(lines))
            if live[index] and SECTION_END.match(lines[index])
        ),
        len(lines),
    )
    last = end
    while last > at + 1 and lines[last - 1].strip() == "":
        last -= 1

    # A dump holding nothing yet takes the capture straight under its heading,
    # the way the ritual writes the first line of one.
    written = [*lines[:last], *([""] if last > at + 1 else []), capture]
    rest = lines[end:]

    return "\n".join([*written, "", *rest] if rest else [*written, ""])
