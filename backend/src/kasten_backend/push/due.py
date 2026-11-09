"""The reminders in the todos: an open todo with `⏰ YYYY-MM-DD HH:MM`, as obsidian-reminder has.

Also when a push may go, given the quiet hours, and the todos a morning push lists.
"""

import datetime as dt
import hashlib
import re
from typing import TYPE_CHECKING, NamedTuple

from kasten_backend import todo_fields, todos

if TYPE_CHECKING:
    from zoneinfo import ZoneInfo

    from kasten_backend.log import Totals
    from kasten_backend.log_config import Config
    from kasten_backend.search import Hit

ALARM = re.compile(
    "⏰\N{VARIATION SELECTOR-16}?[ \t]+([0-9]{4}-[0-9]{2}-[0-9]{2})"
    r"[ \t]+([0-9]{2}:[0-9]{2})(?=[ \t]|$)"
)
LATE = dt.timedelta(hours=1)
"""How late a missed reminder may still go out; an older one is dropped."""
CLOSED = "xX-"
"""The boxes of a todo that is done or cancelled, which reminds of nothing."""


class Reminder(NamedTuple):
    """A todo's reminder: its note and line, its words, when it falls due, and its line's text."""

    path: str
    line: int
    words: str
    due: dt.datetime
    text: str = ""

    @property
    def key(self) -> str:
        """The sent table's key: no line number, so a line moved down is not sent again."""
        return hashlib.sha256(
            f"{self.path}\0{self.due.isoformat()}\0{self.words}".encode()
        ).hexdigest()


def reminder_of(hit: Hit, zone: ZoneInfo) -> Reminder | None:
    """The reminder on one todo line, or None for a closed todo, a malformed time or none at all."""
    # rg hands a CRLF line on with its `\r`, which `LINE` takes as no todo (#1703).
    text = hit.text.removesuffix("\r")
    todo = todos.LINE.fullmatch(text)
    if todo is None or text[len(todo[1]) + 3] in CLOSED:
        return None
    rest = todo[2] or ""
    found = ALARM.search(todo_fields.mask(rest))
    if found is None:
        return None
    try:
        due = dt.datetime.fromisoformat(f"{found[1]}T{found[2]}").replace(tzinfo=zone)
    except ValueError:
        return None
    return Reminder(hit.path, hit.line, _spoken(rest), due, hit.text)


def _spoken(rest: str) -> str:
    """A todo's words as a push shows them: no fields, no `⏰` and no block id."""
    found = ALARM.search(todo_fields.mask(rest))
    if found is not None:
        rest = rest[: found.start()] + rest[found.end() :]
    return " ".join(todo_fields.words(todo_fields.BLOCK_ID.sub("", rest)).split())


def put_off(line: str, today: dt.date) -> str | None:
    """`line` with the `⏰` the reader takes moved to the day after `today`, its time kept.

    None for a line that is no open todo or reads no reminder, so nothing is written.
    """
    todo = todos.LINE.fullmatch(line.removesuffix("\r"))
    if todo is None or todo[2] is None or line[len(todo[1]) + 3] in CLOSED:
        return None
    found = ALARM.search(todo_fields.mask(todo[2]))
    if found is None:
        return None
    start, day = todo.start(2), (today + dt.timedelta(days=1)).isoformat()
    return line[: start + found.start(1)] + day + line[start + found.end(1) :]


def reminders(hits: list[Hit], zone: ZoneInfo) -> list[Reminder]:
    """Every reminder among the todo lines `find_todos` answers with."""
    return [found for hit in hits if "⏰" in hit.text and (found := reminder_of(hit, zone))]


class Quiet(NamedTuple):
    """No push goes, `start` up to `end` local time; a start after the end spans midnight."""

    start: dt.time
    end: dt.time

    def holds(self, local: dt.time) -> bool:
        """Whether a push at `local` waits."""
        if self.start < self.end:
            return self.start <= local < self.end
        return local >= self.start or local < self.end

    def last(self, now: dt.datetime, zone: ZoneInfo) -> tuple[dt.datetime, dt.datetime]:
        """The quiet hours that ended last at or before `now`, as their start and end."""
        day = now.astimezone(zone).date()
        end = dt.datetime.combine(day, self.end, tzinfo=zone)
        if end > now:
            end -= dt.timedelta(days=1)
        start = dt.datetime.combine(end.date(), self.start, tzinfo=zone)
        if self.start > self.end:
            start -= dt.timedelta(days=1)
        return start, end


def sendable(due: dt.datetime, now: dt.datetime, quiet: Quiet | None, zone: ZoneInfo) -> bool:
    """Whether a push due at `due` goes at `now`: inside its late hour and outside quiet hours.

    One whose late hour reached into quiet hours gets a full late hour again from their end (#1681).
    """
    if not due <= now:
        return False
    if now - LATE < due:
        return quiet is None or not quiet.holds(now.astimezone(zone).time())
    if quiet is None or quiet.holds(now.astimezone(zone).time()):
        return False
    start, end = quiet.last(now, zone)
    return now < end + LATE and start - LATE < due


def today_todos(hits: list[Hit], today: dt.date) -> list[str]:
    """The words of every open todo due or scheduled `today`, in the order found."""
    day = today.isoformat()
    found = []
    for hit in hits:
        text = hit.text.removesuffix("\r")
        todo = todos.LINE.fullmatch(text)
        if todo is None or text[len(todo[1]) + 3] in CLOSED:
            continue
        rest = todo[2] or ""
        masked = todo_fields.mask(rest)
        # The first of each field counts, as on the board.
        dates = [m[1] for field in todo_fields.FIELDS[:2] if (m := field.search(masked))]
        if day in dates:
            found.append(_spoken(rest))
    return found


FOOD_UNITS = {"kcal": "kcal", "protein": "g", "carbs": "g", "fat": "g"}


def unmet(config: Config, totals: Totals | None) -> list[tuple[str, str]]:
    """Each `min` goal of the log config `totals` falls short of, as its key and its words.

    Read as the log pane reads goals; `totals` is None on a day with no `## Log`, all zero.
    """
    found = []
    mine = {total.mark: total.total for total in (totals.mine or [])} if totals else {}
    builtin = (
        {"water": totals.water.ml, "coffee": totals.coffee.count, "alcohol": totals.alcohol.count}
        if totals
        else {}
    )
    for kind in config.kinds:
        if kind.goal is None or kind.goal.type != "floor":
            continue
        unit = "ml" if kind.builtin == "water" else kind.unit
        total = builtin.get(kind.builtin, 0) if kind.builtin else mine.get(kind.mark)
        if total is None or total < kind.goal.value:
            words = f"{kind.mark} {kind.name}: {total or 0:g} of {kind.goal.value:g} {unit}"
            found.append((kind.mark, words.rstrip()))
    for field, goal in config.food.items():
        total = getattr(totals.food, field) if totals else 0
        if goal.type == "floor" and total < goal.value:
            unit = FOOD_UNITS[field]
            found.append((field, f"🍽 {field}: {total:g} of {goal.value:g} {unit}"))
    return found
