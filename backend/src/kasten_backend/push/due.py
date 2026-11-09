"""The reminders in the todos: an open todo with `⏰ YYYY-MM-DD HH:MM`, as obsidian-reminder has."""

import datetime as dt
import hashlib
import re
from typing import TYPE_CHECKING, NamedTuple

from kasten_backend import todo_fields, todos

if TYPE_CHECKING:
    from zoneinfo import ZoneInfo

    from kasten_backend.search import Hit

ALARM = re.compile(
    "⏰\N{VARIATION SELECTOR-16}?[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})"
    r"[ \t]+([0-9]{2}:[0-9]{2})(?=[ \t]|$)"
)
CLOSED = "xX-"
"""The boxes of a todo that is done or cancelled, which reminds of nothing."""


class Reminder(NamedTuple):
    """A todo's reminder: its note and line, its words, and when it falls due."""

    path: str
    line: int
    words: str
    due: dt.datetime

    @property
    def key(self) -> str:
        """The sent table's key: no line number, so a line moved down is not sent again."""
        return hashlib.sha256(
            f"{self.path}\0{self.due.isoformat()}\0{self.words}".encode()
        ).hexdigest()


def reminder_of(hit: Hit, zone: ZoneInfo) -> Reminder | None:
    """The reminder on one todo line, or None for a closed todo, a malformed time or none at all."""
    todo = todos.LINE.fullmatch(hit.text)
    if todo is None or hit.text[len(todo[1]) + 3] in CLOSED:
        return None
    rest = todo[2] or ""
    found = ALARM.search(todo_fields.mask(rest))
    if found is None:
        return None
    try:
        due = dt.datetime.fromisoformat(f"{found[1]}T{found[2]}").replace(tzinfo=zone)
    except ValueError:
        return None
    rest = todo_fields.BLOCK_ID.sub("", rest[: found.start()] + rest[found.end() :])
    words = todo_fields.words(rest)
    return Reminder(hit.path, hit.line, " ".join(words.split()), due)


def reminders(hits: list[Hit], zone: ZoneInfo) -> list[Reminder]:
    """Every reminder among the todo lines `find_todos` answers with."""
    return [found for hit in hits if "⏰" in hit.text and (found := reminder_of(hit, zone))]
