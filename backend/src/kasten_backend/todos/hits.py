"""The store's rows as the todo lines the app has always read, and a line read back into a row.

The pane, board, reviews and push parse lines; answering them lines rendered from the store
keeps one parser for both (#2191). Fields a line cannot carry travel beside it.
"""

from datetime import date, datetime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from kasten_backend import periodic
from kasten_backend.search import Hit
from kasten_backend.todos.importer import PRIORITY, row_of
from kasten_backend.todos.lines.read import LINE
from kasten_backend.todos.store.search import Filters, search

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from kasten_backend.config import Settings
    from kasten_backend.todos.store.models import Todo, TodoSession

BOX = {"open": " ", "doing": "/", "done": "x", "blocked": "b", "waiting": "w", "review": "r"}
BOX["rejected"] = "-"
GLYPH = {level: glyph for glyph, level in PRIORITY.items()}
INDENT = "  "


def _duration(value: int | None) -> str | None:
    if value is None:
        return None
    hours, rest = divmod(value, 60)
    return (f"{hours}h" if hours else "") + (f"{rest}m" if rest or not hours else "")


def line_of(row: Todo, depth: int = 0, zone: str = "Europe/Berlin") -> str:
    """The line the editor would have written for `row`, its id always on it."""
    waits = row.state == "waiting"
    words = [row.words]
    if row.assignee:
        words.append(f"👤 {row.assignee}")
    if waits and row.waiting_since:
        words.append(f"👤 {row.waiting_since.isoformat()} {row.waiting_on or ''}".rstrip())
    elif waits and row.waiting_on and not row.assignee:
        words.append(f"👤 {row.waiting_on}")
    fields: list[tuple[str, object]] = [
        (GLYPH.get(row.priority or "", ""), ""),
        ("🔁", row.repeat),
        ("🏁", row.on_completion),
        *(("⛔", one) for one in row.blocked_by),
        ("\N{HEAVY PLUS SIGN}", row.created),
        ("⏳", row.planned),
        ("🛫", row.look_again if waits else row.hold_until),
        ("📅", row.due),
        ("⏲", _duration(row.estimate)),
        ("⏱", _duration(row.worked)),
        ("✅", row.done),
        ("❌", row.cancelled),
    ]
    for glyph, value in fields:
        if glyph and value == "":
            words.append(glyph)
        elif glyph and value is not None:
            words.append(f"{glyph} {value.isoformat() if isinstance(value, date) else value}")
    if row.remind_at is not None:
        # In the owner's zone: the connection may hand the time back in UTC.
        words.append(f"⏰ {row.remind_at.astimezone(ZoneInfo(zone)).strftime('%Y-%m-%d %H:%M')}")
    words.append(f"🆔 {row.id}")
    return f"{INDENT * depth}- [{BOX[row.state]}] {' '.join(words)}"


def as_hits(rows: list[Todo], settings: Settings) -> list[dict[str, Any]]:
    """Each row with the path, line and text it reads as: parts under their parent, in order.

    A part sits in its top todo's note, so the tree reads from indents as it always has.
    """
    by_id = {row.id: row for row in rows}
    below: dict[str | None, list[Todo]] = {}
    for row in rows:
        below.setdefault(row.parent_id if row.parent_id in by_id else None, []).append(row)
    lines: dict[str, int] = {}
    found: list[dict[str, Any]] = []

    def walk(row: Todo, depth: int, path: str) -> None:
        lines[path] = lines.get(path, 0) + 1
        found.append(
            {
                "row": row,
                "path": path,
                "line": lines[path],
                "text": line_of(row, depth, settings.timezone),
            }
        )
        for part in sorted(below.get(row.id, []), key=lambda one: one.position):
            walk(part, depth + 1, path)

    for top in below.get(None, []):
        walk(top, 0, top.note or periodic.daily_path(top.created, settings.periodic_path))
    return found


def session_hits(
    sessions: list[tuple[TodoSession, Todo]], settings: Settings
) -> list[dict[str, Any]]:
    """Each running session as the `## Time` line the timer reads, in its day's note."""
    zone = ZoneInfo(settings.timezone)
    found = []
    for number, (session, row) in enumerate(sessions, start=1):
        started = session.started.astimezone(zone)
        found.append(
            {
                "path": periodic.daily_path(started.date(), settings.periodic_path),
                "line": 100_000 + number,
                "text": f"- {started.strftime('%H:%M')}- {row.words} {row.id}",
            }
        )
    return found


def values_of(line: str, row: Todo | None, today: date, zone: str) -> dict[str, Any]:
    """The fields and state a typed line sets; a soft due date it kept stays soft."""
    found = LINE.match(line.strip("\r\n"))
    box = line[line.index("[") + 1] if found else " "
    values = row_of(found[2] or "" if found else line, box, today)
    values.pop("id", None)
    values.pop("worked", None)
    for stamp in ("created", "done", "cancelled", "waiting_since"):
        if row is not None or values[stamp] is None:
            values.pop(stamp)
    if values["state"] != "waiting":
        values.pop("look_again")
    elif row is not None and row.state == "waiting" and row.look_again:
        values["look_again"] = values["look_again"] if "🛫" in line else row.look_again
    if values["remind_at"] is not None:
        values["remind_at"] = datetime.fromisoformat(values["remind_at"]).replace(
            tzinfo=ZoneInfo(zone)
        )
    if row is not None and row.due is not None and not row.due_hard and values["due"] == row.due:
        values["due_hard"] = False
    if values["due"] is None:
        values.pop("due_hard")
    values.pop("tags")
    return values


async def store_hits(session: AsyncSession, settings: Settings) -> list[Hit]:
    """Every todo outside the archive as the line the push reminders read."""
    rows = await search(session, Filters(archive=settings.archive_path))
    return [Hit(hit["path"], hit["line"], hit["text"]) for hit in as_hits(rows, settings)]
