"""The one move of every todo line in the vault into the store, and an embed where each was.

The rules are in docs/explanation/vault-and-derived-index/todos-in-postgres.md#the-import.
"""

import re
import secrets
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from kasten_backend import periodic, vault
from kasten_backend.change import vault_change, vault_write
from kasten_backend.todos import fields
from kasten_backend.todos.lines import LINE, find_todos, parents, projects_of, word_tags
from kasten_backend.todos.models import Todo, TodoChange, TodoSession

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from kasten_backend.config import Settings
    from kasten_backend.search import Hit

SOFT_DAYS = 14
STATES = {
    " ": "open",
    "/": "doing",
    "x": "done",
    "X": "done",
    "b": "blocked",
    "w": "waiting",
    "r": "review",
    "-": "rejected",
}
CLOSED = ("done", "rejected")
PRIORITY = {"🔺": "highest", "⏫": "high", "🔼": "medium", "🔽": "low", "⏬": "lowest"}
DURATION = re.compile(r"(?=[0-9])(?:([0-9]+)h)?(?:([0-9]+)m)?")
SESSION = re.compile(r"^[ \t]*- ([0-9]{2}:[0-9]{2})-([0-9]{2}:[0-9]{2})?[ \t]*(.*)$")
ID_WORD = re.compile(r"(?:^|\s)(kt-\S+)")
LABEL = "todos: move the todo lines into the store"

(DUE, SCHEDULED, START, PRIORITY_FIELD, REPEAT, ON_COMPLETION) = fields.FIELDS[:6]
(CREATED, DONE, CANCELLED, ESTIMATE, WORKED, ID) = fields.FIELDS[6:]


@dataclass
class Plan:
    """What an import would write, and the two checks it must pass."""

    rows: list[dict[str, Any]] = field(default_factory=list)
    sessions: list[dict[str, Any]] = field(default_factory=list)
    notes: dict[str, str] = field(default_factory=dict)
    open_lines: int = 0
    ids_on_lines: set[str] = field(default_factory=set)
    renamed: list[str] = field(default_factory=list)

    def report(self, stored: set[str]) -> str:
        """The two checks, in words: open lines against open rows, and ids not found."""
        open_rows = sum(row["state"] not in CLOSED for row in self.rows)
        missing = sorted(self.ids_on_lines - stored - {row["id"] for row in self.rows})
        return "\n".join(
            [
                f"open todo lines: {self.open_lines}, open rows: {open_rows}",
                f"rows: {len(self.rows)}, sessions: {len(self.sessions)}, "
                f"notes rewritten: {len(self.notes)}",
                f"ids on lines not in the store: {len(missing)} {' '.join(missing)}".rstrip(),
                *(f"new id for a twin: {line}" for line in self.renamed),
            ]
        )


def minutes(value: str | None) -> int | None:
    """`1h20m` as 80; None for no duration, as the editor reads `90` or `1h30` as words."""
    found = None if value is None else DURATION.fullmatch(value)
    return None if found is None else int(found[1] or 0) * 60 + int(found[2] or 0)


def _day(value: str | None) -> date | None:
    try:
        return None if value is None else date.fromisoformat(value)
    except ValueError:
        return None


def _first(found: dict[Any, list[tuple[str | None, ...]]], pattern: Any) -> str | None:
    groups = found.get(pattern)
    return groups[0][0] if groups else None


def _new_id(taken: set[str]) -> str:
    while (id_ := f"kt-{secrets.token_hex(3)}") in taken:
        pass
    return id_


def row_of(rest: str, box: str, today: date) -> dict[str, Any]:
    """The row one line's words and box make, without its id, note, parent or project."""
    text, found = fields.values(rest)
    alarm = fields.ALARM.search(fields.mask(text))
    remind = None if alarm is None else f"{alarm[1]}T{alarm[2]}"
    if alarm is not None:
        text = text[: alarm.start()] + text[alarm.end() :]
    words = " ".join(fields.BLOCK_ID.sub("", text).split())
    state = STATES[box]
    due = _day(_first(found, DUE))
    starts = [day for day in (_day(_first(found, SCHEDULED)), _day(_first(found, START))) if day]
    waiting = found.get(fields.WAITING, [(None, None)])[0]
    return {
        "words": words,
        "state": state,
        "tags": [words[start:end] for start, end in word_tags(words)],
        "blocked_by": [groups[0] for groups in found.get(fields.BLOCKED_BY, [])],
        "repeat": _first(found, REPEAT),
        "on_completion": _first(found, ON_COMPLETION),
        "priority": PRIORITY.get(_first(found, PRIORITY_FIELD) or ""),
        "from_day": max(starts, default=None),
        "deadline": due,
        "deadline_hard": due is not None,
        "assignee": _first(found, fields.ASSIGNEE),
        "waiting_since": _day(waiting[0]) or (today if state == "waiting" else None),
        "waiting_on": waiting[1],
        "look_again": today if state == "waiting" else None,
        "remind_at": remind,
        "estimate": minutes(_first(found, ESTIMATE)),
        "worked": minutes(_first(found, WORKED)),
        "created": _day(_first(found, CREATED)) or today,
        "done": _day(_first(found, DONE)),
        "cancelled": _day(_first(found, CANCELLED)),
        "id": _first(found, ID),
    }


def _embed(line: str, id_: str) -> str:
    """The line an embed of `id_` takes, the todo's indent and trailing `^block` id kept."""
    ending = "\r" if line.endswith("\r") else ""
    todo = LINE.fullmatch(line.removesuffix("\r"))
    indent = todo[1] if todo else ""
    block = fields.BLOCK_ID.search(line.removesuffix("\r"))
    return f"{indent}![[{id_}]]{block[0] if block else ''}{ending}"


def _sessions(root: Path, settings: Settings, today: date) -> list[dict[str, Any]]:
    """Every `## Time` line of a daily note that names an id, as rows keyed on that id."""
    zone = ZoneInfo(settings.timezone)
    found = []
    folder = PurePosixPath(periodic.daily_path(today, settings.periodic_path)).parent
    for path in vault.list_markdown_files(root):
        day = _day(PurePosixPath(path).stem) if PurePosixPath(path).parent == folder else None
        text = None if day is None else vault.read_note(root, path)
        if day is None or text is None:
            continue
        for line in periodic.section_lines(text, "## Time"):
            session = SESSION.match(line.removesuffix("\r"))
            ids = [] if session is None else ID_WORD.findall(session[3])
            if session is None or not ids:
                continue
            start = datetime.combine(day, time.fromisoformat(session[1]), zone)
            end = session[2] or (None if day == today else "23:59")
            ended = None if end is None else datetime.combine(day, time.fromisoformat(end), zone)
            ended = ended and max(ended, start)
            found.append({"todo_id": ids[-1], "started": start, "ended": ended})
    return found


async def plan(settings: Settings, stored: set[str], today: date) -> Plan:
    """What the import would write, read off the vault as it stands: nothing is written."""
    root = settings.vault_path
    # The lines that end parts stay in: `parents` and `projects_of` stop a part at them.
    hits = await find_todos(root)
    projects = projects_of(hits, vault.list_markdown_files(root))
    result = Plan()
    taken = set(stored)
    ids: dict[tuple[str, int], str] = {}
    by_note: dict[str, list[tuple[Hit, str | None]]] = {}
    for hit, project in zip(hits, projects, strict=True):
        by_note.setdefault(hit.path, []).append((hit, project))
    for note, found in by_note.items():
        up = parents((hit.line, hit.text) for hit, _ in found)
        places: dict[str | None, int] = {}
        todos = [(hit, project) for hit, project in found if hit.line in up]
        for hit, project in todos:
            _plan_line(settings, result, (hit, project, up[hit.line]), (taken, ids, places), today)
        if todos:
            result.notes[note] = _embedded(root, note, todos, ids, up)
    return result


def _plan_line(
    settings: Settings,
    result: Plan,
    line: tuple[Hit, str | None, int | None],
    seen: tuple[set[str], dict[tuple[str, int], str], dict[str | None, int]],
    today: date,
) -> None:
    hit, project, parent_line = line
    taken, ids, places = seen
    todo = LINE.fullmatch(hit.text)
    if todo is None:
        return
    row = row_of(todo[2] or "", hit.text[len(todo[1]) + 3], today)
    written = row.pop("id")
    if written is not None:
        result.ids_on_lines.add(written)
    result.open_lines += row["state"] not in CLOSED
    if written is not None and written in taken and written not in ids.values():
        # Stored by a run whose vault write never landed: embed it, store nothing new.
        ids[(hit.path, hit.line)] = written
        return
    id_ = written if written is not None and written not in taken else _new_id(taken)
    if written is not None and id_ != written:
        result.renamed.append(f"{hit.path}:{hit.line} {written} -> {id_}")
    taken.add(id_)
    ids[(hit.path, hit.line)] = id_
    parent = None if parent_line is None else ids[(hit.path, parent_line)]
    shared = PurePosixPath(hit.path).parent == PurePosixPath(settings.share_folder)
    soft = row["deadline"] is None and parent is None and not shared
    if soft and row["state"] not in CLOSED:
        row["deadline"] = today + timedelta(days=SOFT_DAYS)
    places[parent] = places.get(parent, -1) + 1
    result.rows.append(
        row
        | {
            "id": id_,
            "note": hit.path,
            "shared_list": PurePosixPath(hit.path).stem if shared else None,
            "project": project,
            "parent_id": parent,
            "position": places[parent],
        }
    )


def _embedded(
    root: Path,
    note: str,
    found: list[tuple[Hit, str | None]],
    ids: dict[tuple[str, int], str],
    up: dict[int, int | None],
) -> str:
    """The note's text with each top todo line an embed and each part line gone."""
    path = vault.resolve_note(root, note)
    # Split on LF alone, each CR kept on its line, as `rg_lines` numbers them.
    text = "" if path is None else path.read_text(encoding="utf-8", newline="")
    lines = text.split("\n")
    for hit, _ in sorted(found, key=lambda one: one[0].line, reverse=True):
        if up[hit.line] is None:
            lines[hit.line - 1] = _embed(lines[hit.line - 1], ids[(hit.path, hit.line)])
        else:
            del lines[hit.line - 1]
    return "\n".join(lines)


async def run(settings: Settings, session: AsyncSession, *, dry: bool, by: str = "import") -> str:
    """Import the vault's todo lines, or with `dry` only report what that would do."""
    today = datetime.now(ZoneInfo(settings.timezone)).date()
    async with vault_write():
        stored = set((await session.scalars(select(Todo.id))).all())
        moved = await plan(settings, stored, today)
        moved.sessions = [
            one
            for one in _sessions(settings.vault_path, settings, today)
            if one["todo_id"] in {row["id"] for row in moved.rows}
        ]
        report = moved.report(stored)
        if dry:
            return report
        await _store(session, moved, by, ZoneInfo(settings.timezone))
        async with vault_change(settings.vault_path, LABEL):
            for note, text in moved.notes.items():
                path = vault.resolve_note(settings.vault_path, note)
                if path is not None:
                    vault.write_note(path, text, as_sent=True)
        await session.commit()
    return report


async def _store(session: AsyncSession, moved: Plan, by: str, zone: ZoneInfo) -> None:
    for row in moved.rows:
        session.add(Todo(**row | {"remind_at": _when(row["remind_at"], zone)}))
        await session.flush()
        session.add(TodoChange(todo_id=row["id"], by=by, after=_plain(row)))
    session.add_all(TodoSession(**one) for one in moved.sessions)
    await session.flush()


def _when(value: str | None, zone: ZoneInfo) -> datetime | None:
    """A reminder's day and time, read in the owner's zone as the push reads it."""
    try:
        return None if value is None else datetime.fromisoformat(value).replace(tzinfo=zone)
    except ValueError:
        return None


def _plain(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value.isoformat() if isinstance(value, date) else value for key, value in row.items()
    }
