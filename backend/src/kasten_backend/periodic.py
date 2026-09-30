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

DAILY = "01 Periodic/00 Daily"
"""Where the day's notes live. `FOLDER.daily` in `periodic.ts` is the other copy."""

WEEKLY = "01 Periodic/01 Weekly"
"""Where the week a day links up to lives."""

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
"""Spelled out rather than read off `strftime("%A")`, which answers in the locale."""

DUMP = "## Dump"
"""The heading `/close-day` reads the day's unsorted thoughts from."""

_SECTION_END = re.compile(r"^#{1,2} ")
"""A heading at the dump's own level or above, which is where the dump stops.

Not every heading: a `###` written inside the dump is part of what was dumped.
"""


def daily_path(day: date) -> str:
    """Where the note for `day` lives, relative to the vault root."""
    return f"{DAILY}/{day.isoformat()}.md"


def daily_note(day: date) -> str:
    """The text `<leader>gd` gives a daily note it makes, frontmatter and all."""
    year, week, _ = day.isocalendar()
    before = daily_path(day - timedelta(days=1)).removesuffix(".md")
    after = daily_path(day + timedelta(days=1)).removesuffix(".md")
    nav = f"[[{before}]] | [[{WEEKLY}/{year}-W{week:02d}]] | [[{after}]]"

    return (
        f"---\ntype: Periodic Note\n---\n\n"
        f"# {day.isoformat()} {WEEKDAYS[day.weekday()]}\n\n{nav}\n\n## TODOs\n"
    )


def append_dump(text: str, capture: str) -> str:
    """`text` with `capture` as a paragraph of its own at the end of `## Dump`.

    The dump is prose, so a capture is a paragraph rather than a list item, a
    blank line apart from the one before it. A note with no dump gets one at its
    end, which is where the ritual writes it by hand at 17:00. A section that
    follows the dump keeps the blank line in front of its heading: `/close-day`
    writes one there, and a capture pushed under the gap would read as its.
    """
    lines = text.split("\n")
    at = next((index for index, line in enumerate(lines) if line.rstrip() == DUMP), None)

    if at is None:
        return f"{text.rstrip(chr(10))}\n\n{DUMP}\n{capture}\n"

    end = next(
        (index for index in range(at + 1, len(lines)) if _SECTION_END.match(lines[index])),
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
