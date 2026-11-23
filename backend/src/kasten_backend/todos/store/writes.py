"""The rules a write to a todo runs, once, for every caller: the pane, push, shares, agents.

What each state change stamps and drags along: docs/reference/todo-format/state-changes.md.
Every write records the row before and after in `todos.change`.
"""

import secrets
from datetime import date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from sqlalchemy import event, inspect, select

from kasten_backend import events, periodic, vault
from kasten_backend.todos.lines import PROJECT_ROOTS, read
from kasten_backend.todos.store import recur
from kasten_backend.todos.store.models import Todo, TodoChange, TodoSession

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from kasten_backend.config import Settings

SOFT_DAYS = 14
FORGOTTEN = timedelta(hours=12)
"""How long a timer runs before a stop takes it for one left on."""
LOOK_AGAIN_DAYS = 7
"""How long a wait lasts when nobody names a look-again day."""
CLOSED = ("done", "rejected")
CYCLE = {
    "open": "doing",
    "doing": "done",
    "review": "done",
    "done": "open",
    "blocked": "doing",
    "waiting": "doing",
    "rejected": "open",
}
"""The walk `x` takes: not started, started, finished; a hold picks up at doing."""
EDITABLE = frozenset(
    {
        "words",
        "description",
        "priority",
        "planned",
        "hold_until",
        "epic",
        "epic_id",
        "due",
        "due_hard",
        "repeat",
        "estimate",
        "assignee",
        "waiting_on",
        "look_again",
        "blocked_by",
        "remind_at",
        "parent_id",
        "position",
        "project",
        "note",
        "shared_list",
    }
)


class MissingError(LookupError):
    """No todo has that id."""


class RefusedError(ValueError):
    """The write names a parent or epic no todo can have: none by that id, or a loop."""


class StaleError(ValueError):
    """The row moved since the caller read it: its version is not the one sent."""


def plain(row: Todo) -> dict[str, Any]:
    """A row as JSON holds it: what `todos.change` keeps and the routes answer."""
    values = {column.key: getattr(row, column.key) for column in inspect(Todo).columns}
    return {
        key: value.isoformat() if isinstance(value, date | datetime) else value
        for key, value in values.items()
    }


def new_id(taken: set[str] | None = None) -> str:
    """A `kt-` id with six hex characters, never one in `taken`."""
    while (id_ := f"kt-{secrets.token_hex(3)}") in (taken or set()):
        pass
    return id_


async def placed(
    session: AsyncSession, settings: Settings, values: dict[str, Any]
) -> dict[str, Any]:
    """Where a new todo lives: a `#p/x` tag's project, else its parent's or its note's.

    A todo with no note, parent or shared list lands in today's daily note, as a typed
    one always has.
    """
    parent = (
        None if values.get("parent_id") is None else await session.get(Todo, values["parent_id"])
    )
    if values.get("note") is None and values.get("shared_list") is None:
        values["note"] = (
            parent.note
            if parent
            else periodic.daily_path(
                datetime.now(ZoneInfo(settings.timezone)).date(), settings.periodic_path
            )
        )
    if "project" not in values:
        files = vault.list_markdown_files(settings.vault_path)
        tagged = read.project_by_tag(tags_of(values["words"]), read.project_folders(files))
        note: str | None = values.get("note")
        noted = None if note is None else read.project_in(note, PROJECT_ROOTS)
        values["project"] = tagged or (parent.project if parent else noted)
    return values


async def follow_move(writes: Writes, source: str, target: str, *, folder: bool) -> None:
    """Point every todo of a moved note, or of the notes under a moved folder, at its new path.

    A project read off the old path becomes the one the new path reads; one a tag gave stays.
    """
    prefix = source.rstrip("/") + "/"
    moved = Todo.note.startswith(prefix, autoescape=True) if folder else Todo.note == source
    for row in (await writes.session.scalars(select(Todo).where(moved))).all():
        note = target.rstrip("/") + "/" + (row.note or "")[len(prefix) :] if folder else target
        writes._touch(row)
        if row.project == read.project_in(row.note or "", PROJECT_ROOTS):
            row.project = read.project_in(note, PROJECT_ROOTS)
        row.note = note


def _told(_session: object) -> None:
    events.todos_changed()


class Writes:
    """One caller's writes in one session, each recorded under `by` and counted from `today`."""

    def __init__(self, session: AsyncSession, by: str, today: date) -> None:
        """Writes in `session`, recorded as `by`'s and dated `today`."""
        self.session = session
        self.by = by
        self.today = today
        self.touched: dict[str, Todo] = {}
        self._before: dict[str, dict[str, Any] | None] = {}

    async def get(self, id_: str) -> Todo:
        """The row with `id_`, or `MissingError`."""
        row = await self.session.get(Todo, id_)
        if row is None:
            raise MissingError(id_)
        return row

    def _touch(self, row: Todo, *, fresh: bool = False) -> None:
        if row.id not in self._before:
            self._before[row.id] = None if fresh else plain(row)
        self.touched[row.id] = row

    async def done(self) -> list[Todo]:
        """Record each touched row's change and flush; the rows written, in the order touched.

        Open event streams hear of it once the session commits.
        """
        if self._before and not event.contains(self.session.sync_session, "after_commit", _told):
            event.listen(self.session.sync_session, "after_commit", _told, once=True)
        await self.session.flush()
        for id_, row in self.touched.items():
            if self._before[id_] != (after := plain(row)):
                row.version = (row.version or 0) + (self._before[id_] is not None)
                row.updated = datetime.now(ZoneInfo("UTC"))
                after = plain(row)
                self.session.add(
                    TodoChange(todo_id=id_, by=self.by, before=self._before[id_], after=after)
                )
        await self.session.flush()
        return list(self.touched.values())

    def _default_due(self, row: Todo) -> None:
        """A top todo off the shared lists saved with no due date gets a soft one."""
        if row.due is None and row.parent_id is None and row.shared_list is None:
            row.due = self.today + timedelta(days=SOFT_DAYS)
            row.due_hard = False

    async def add(self, values: dict[str, Any]) -> Todo:
        """A new open todo from `values`, placed after its siblings, created today."""
        taken = set((await self.session.scalars(select(Todo.id))).all())
        fields = {key: value for key, value in values.items() if key in EDITABLE}
        row = Todo(id=new_id(taken), state="open", created=self.today, version=1, **fields)
        await self._check_parent(row.id, row.parent_id)
        await self._check_epic(row.id, row.epic_id)
        row.blocked_by = row.blocked_by or []
        await self._check_blockers(set(row.blocked_by))
        row.tags = tags_of(row.words)
        siblings = select(Todo.position).where(Todo.parent_id == row.parent_id)
        row.position = max((await self.session.scalars(siblings)).all(), default=-1) + 1
        self._default_due(row)
        if row.blocked_by and await self._held(row.blocked_by):
            row.state = "blocked"
        self.session.add(row)
        self._touch(row, fresh=True)
        return row

    async def edit(self, id_: str, version: int, values: dict[str, Any]) -> Todo:
        """Change the fields named in `values` on a row read at `version`."""
        row = await self.get(id_)
        if row.version != version:
            raise StaleError(id_)
        self._touch(row)
        had = list(row.blocked_by)
        if "parent_id" in values:
            await self._check_parent(row.id, values["parent_id"])
        if "epic_id" in values:
            await self._check_epic(row.id, values["epic_id"])
        await self._check_blockers(set(values.get("blocked_by") or []) - set(had))
        for key, value in values.items():
            if key in EDITABLE:
                setattr(row, key, value)
        row.tags = tags_of(row.words)
        if values.get("epic") is False:
            await self._leave_epic(row.id)
        if row.due is None:
            row.due_hard = False
            self._default_due(row)
        if row.blocked_by != had and row.state in ("open", "blocked"):
            # A blocker picked holds an open todo; the last one gone opens it.
            held = bool(row.blocked_by) and await self._held(row.blocked_by)
            row.state = "blocked" if held else "open"
        return row

    async def _check_parent(self, id_: str, parent: str | None) -> None:
        """Refuse a parent that is no todo, the todo itself or one of its parts: a loop."""
        if parent is None:
            return
        if await self.session.get(Todo, parent) is None:
            raise RefusedError(f"No todo has the id {parent}.")
        row = await self.session.get(Todo, id_)
        below = set() if row is None else {part.id for part in await self.parts(row)}
        if parent == id_ or parent in below:
            raise RefusedError(f"{parent} is {id_} or one of its parts.")

    async def _check_blockers(self, added: set[str]) -> None:
        """Refuse an added blocker that is no todo: a deleted one would hold for good (#2212)."""
        for blocker in sorted(added):
            if await self.session.get(Todo, blocker) is None:
                raise RefusedError(f"No todo has the id {blocker}.")

    async def _leave_epic(self, id_: str) -> None:
        """A todo no longer an epic lets go of every todo that counted toward it."""
        members = select(Todo).where(Todo.epic_id == id_)
        for member in (await self.session.scalars(members)).all():
            self._touch(member)
            member.epic_id = None

    async def _check_epic(self, id_: str, epic: str | None) -> None:
        """Refuse an epic that is no todo marked as one, or the todo itself."""
        if epic is None:
            return
        found = await self.session.get(Todo, epic)
        if found is None or not found.epic or epic == id_:
            raise RefusedError(f"{epic} is no epic {id_} can count toward.")

    async def delete(self, id_: str) -> None:
        """Delete a todo and its parts, each recorded; their change rows stay.

        Each todo they blocked lets go of their ids and opens once nothing holds it (#2219).
        """
        row = await self.get(id_)
        gone = [row, *await self.parts(row)]
        ids = [one.id for one in gone]
        for one in gone:
            self._before.setdefault(one.id, plain(one))
            self.session.add(TodoChange(todo_id=one.id, by=self.by, before=plain(one), after=None))
        freed = select(Todo).where(Todo.blocked_by.overlap(ids), Todo.id.not_in(ids))
        for dependent in (await self.session.scalars(freed)).all():
            self._touch(dependent)
            dependent.blocked_by = [one for one in dependent.blocked_by if one not in ids]
            if dependent.state == "blocked" and not await self._held(dependent.blocked_by):
                dependent.state = "open"
        await self.session.delete(row)

    async def cycle(self, id_: str) -> Todo:
        """Walk a todo one step of `CYCLE`."""
        row = await self.get(id_)
        return await self.set_state(id_, CYCLE[row.state])

    async def set_state(
        self, id_: str, state: str, *, look_again: date | None = None, waiting_on: str | None = None
    ) -> Todo:
        """Put a todo in `state`, with the stamps and everything the change drags along."""
        row = await self.get(id_)
        if row.state == state == "waiting" and (look_again or waiting_on):
            # Chasing, or waiting longer: the wait goes on to a new day.
            self._touch(row)
            row.look_again = look_again or row.look_again
            row.waiting_on = waiting_on or row.waiting_on
        if row.state == state:
            return row
        self._touch(row)
        was = row.state
        self._leave(row)
        row.state = state
        if state == "done":
            row.done = self.today
        if state == "rejected":
            row.cancelled = self.today
        if state == "waiting":
            row.waiting_since = row.waiting_since or self.today
            row.look_again = look_again or self.today + timedelta(days=LOOK_AGAIN_DAYS)
            row.waiting_on = waiting_on or row.waiting_on
        if state == "done":
            await self._tick_parts(row)
            if row.repeat:
                await self._next_round(row)
        if (was in CLOSED) != (state in CLOSED):
            await self._follow(row.id)
        return row

    def _leave(self, row: Todo) -> None:
        if row.state == "done":
            row.done = None
        if row.state == "rejected":
            row.cancelled = None
        if row.state == "waiting":
            row.waiting_since = row.waiting_on = row.look_again = None

    async def parts(self, row: Todo) -> list[Todo]:
        """Every todo under `row`, at any depth, parents before their parts."""
        found: list[Todo] = []
        level = [row.id]
        while level:
            below = select(Todo).where(Todo.parent_id.in_(level)).order_by(Todo.position)
            rows = list((await self.session.scalars(below)).all())
            found += rows
            level = [one.id for one in rows]
        return found

    async def _tick_parts(self, row: Todo) -> None:
        """Ticking a parent ticks every part still open; a closed part stays as it was."""
        for part in await self.parts(row):
            if part.state not in CLOSED:
                self._touch(part)
                self._leave(part)
                part.state, part.done = "done", self.today

    async def _next_round(self, row: Todo) -> None:
        """Keep the finished round as a done row of its own, and move the todo on.

        The todo keeps its id, so embeds, blockers and plan picks still name it.
        """
        # The editor counted off due, then scheduled, then start; a soft due date comes last.
        anchor = (row.due if row.due_hard else None) or row.planned or row.hold_until or row.due
        days = recur.shift(row.repeat or "", anchor, self.today)
        if days is None:
            return
        parts = await self.parts(row)
        taken = set((await self.session.scalars(select(Todo.id))).all())
        kept = self._copy(row, new_id(taken), row.parent_id, row.position)
        kept.round_of = row.id
        rounds = {row.id: kept.id}
        for part in parts:
            rounds[part.id] = new_id(taken | set(rounds.values()))
            self._copy(part, rounds[part.id], rounds[part.parent_id or ""], part.position)
        await self.session.flush()
        # The round's time goes with the round, so the todo's next total starts at nothing.
        # A session still running stays on the todo, where its timer can stop it.
        timed = select(TodoSession).where(
            TodoSession.todo_id.in_(list(rounds)), TodoSession.ended.is_not(None)
        )
        for session in (await self.session.scalars(timed)).all():
            session.todo_id = rounds[session.todo_id]
        for one in (row, *parts):
            self._move_on(one, days, part=one is not row)
            if await self._held(one.blocked_by):
                one.state = "blocked"

    def _copy(self, row: Todo, id_: str, parent: str | None, position: int) -> Todo:
        names = [column.key for column in inspect(Todo).columns]
        values = {name: getattr(row, name) for name in names if name not in ("id", "version")}
        copy = Todo(**values | {"tags": list(row.tags), "blocked_by": list(row.blocked_by)})
        copy.id, copy.parent_id, copy.position, copy.version = id_, parent, position, 1
        self.session.add(copy)
        self._touch(copy, fresh=True)
        return copy

    def _move_on(self, row: Todo, days: int, *, part: bool) -> None:
        self._touch(row)
        row.state, row.done, row.cancelled, row.worked = "open", None, None, None
        row.waiting_since = row.waiting_on = row.look_again = None
        if part:
            row.assignee = None
        for name in ("planned", "hold_until", "due"):
            if (day := getattr(row, name)) is not None:
                setattr(row, name, day + timedelta(days=days))
        if row.remind_at is not None:
            row.remind_at += timedelta(days=days)

    async def _held(self, ids: list[str]) -> bool:
        """Whether any of `ids` names a todo still open; an id naming none holds nothing."""
        found = select(Todo.state).where(Todo.id.in_(ids))
        return any(state not in CLOSED for state in (await self.session.scalars(found)).all())

    async def _follow(self, id_: str) -> None:
        """Move each todo `id_` blocks between open and blocked; other states stay as set."""
        held = Todo.blocked_by.contains([id_])
        waiting = select(Todo).where(held, Todo.state.in_(("open", "blocked")))
        for row in (await self.session.scalars(waiting)).all():
            want = "blocked" if await self._held(row.blocked_by) else "open"
            if row.state != want:
                self._touch(row)
                row.state = want

    async def timer(self, id_: str, now: datetime) -> Todo:
        """Start a session on a todo, or close every one running and sum them into `worked`."""
        row = await self.get(id_)
        self._touch(row)
        mine = select(TodoSession).where(TodoSession.todo_id == id_)
        sessions = list((await self.session.scalars(mine.where(TodoSession.ended.is_(None)))).all())
        if not sessions:
            self.session.add(TodoSession(todo_id=id_, started=now))
            return row
        for one in sessions:
            # A timer left running half a day was forgotten: it closes at 23:59 of its own day.
            day = one.started.astimezone(now.tzinfo).date()
            late = datetime.combine(day, time(23, 59), now.tzinfo)
            one.ended = now if now - one.started < FORGOTTEN else late
        await self.session.flush()
        closed = (await self.session.scalars(mine.where(TodoSession.ended.is_not(None)))).all()
        seconds = sum(
            max((one.ended - one.started).total_seconds(), 0) for one in closed if one.ended
        )
        row.worked = int(seconds // 60)
        return row


def tags_of(words: str) -> list[str]:
    """The tags in a todo's words, hash and all, by the one tag rule."""
    return [words[start:end] for start, end in read.word_tags(words)]
