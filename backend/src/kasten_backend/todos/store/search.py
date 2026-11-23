"""One search over the store for every reader: the pane, `GET /api/todos` and the agent's tools."""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import and_, case, func, literal, or_, select

from kasten_backend.todos.store.models import Todo

if TYPE_CHECKING:
    from datetime import date

    from sqlalchemy import ColumnElement, Select
    from sqlalchemy.ext.asyncio import AsyncSession

KINDS = ("#client", "#internal", "#private")
PRIORITY_ORDER = ("highest", "high", "medium", None, "low", "lowest")
"""A todo with no priority sorts between medium and low, as the pane has always ranked it."""
Sort = Literal["place", "priority", "due", "planned", "created"]


@dataclass(frozen=True)
class Filters:
    """What a search keeps; each one left at its default keeps everything."""

    state: tuple[str, ...] = ()
    words: str | None = None
    tag: str | None = None
    kind: str | None = None
    project: str | None = None
    epic: str | None = None
    parent: str | None = None
    priority: tuple[str, ...] = ()
    due_by: date | None = None
    planned_on: date | None = None
    planned_by: date | None = None
    hold_until_by: date | None = None
    waiting: bool | None = None
    look_again_by: date | None = None
    shown_on: date | None = None
    done_from: date | None = None
    done_to: date | None = None
    note: str | None = None
    shared_list: str | None = None
    archive: str | None = None
    sort: Sort = "place"
    limit: int | None = None


def _below(roots: Select[Any], *, keep_roots: bool = True) -> ColumnElement[bool]:
    """Todos among `roots` or under one of them at any depth."""
    tree = select(Todo.id).where(Todo.id.in_(roots)).cte("tree", recursive=True)
    tree = tree.union_all(select(Todo.id).where(Todo.parent_id == tree.c.id))
    inside = Todo.id.in_(select(tree.c.id))
    return inside if keep_roots else and_(inside, Todo.id.not_in(roots))


def _tagged(tag: str) -> ColumnElement[bool]:
    """A tag, or one nested under it: `#p/trip` finds `#p/trip/flights` too."""
    tag = tag if tag.startswith("#") else f"#{tag}"
    nested = func.array_to_string(Todo.tags, " ").like(f"%{tag}/%")
    return or_(Todo.tags.contains([tag]), nested)


def _priority(levels: tuple[str, ...]) -> ColumnElement[bool]:
    named = [level for level in levels if level != "none"]
    wanted = Todo.priority.in_(named)
    return or_(wanted, Todo.priority.is_(None)) if "none" in levels else wanted


def where(filters: Filters) -> list[ColumnElement[bool]]:
    """The conditions `filters` asks for, to add to any select of `Todo`."""
    found: list[ColumnElement[bool]] = []
    if filters.state:
        found.append(Todo.state.in_(filters.state))
    if filters.words:
        found.append(Todo.words.icontains(filters.words, autoescape=True))
    if filters.tag:
        found.append(_tagged(filters.tag))
    if filters.kind:
        kind = filters.kind if filters.kind.startswith("#") else f"#{filters.kind}"
        found.append(_below(select(Todo.id).where(Todo.tags.contains([kind]))))
    if filters.epic:
        found.append(_below(select(Todo.id).where(Todo.epic_id == filters.epic)))
    if filters.parent:
        found.append(_below(select(Todo.id).where(Todo.id == filters.parent), keep_roots=False))
    if filters.priority:
        found.append(_priority(filters.priority))
    found += _days(filters)
    found += [
        column == value
        for column, value in (
            (Todo.project, filters.project),
            (Todo.note, filters.note),
            (Todo.shared_list, filters.shared_list),
        )
        if value
    ]
    if filters.waiting is not None:
        found.append((Todo.state == "waiting") == literal(filters.waiting))
    if filters.archive:
        folder = filters.archive.rstrip("/") + "/"
        found.append(or_(Todo.note.is_(None), ~Todo.note.startswith(folder, autoescape=True)))
    return found


def _days(filters: Filters) -> list[ColumnElement[bool]]:
    found: list[ColumnElement[bool]] = []
    if filters.due_by:
        found.append(Todo.due <= filters.due_by)
    if filters.planned_on:
        found.append(Todo.planned == filters.planned_on)
    if filters.planned_by:
        found.append(Todo.planned <= filters.planned_by)
    if filters.hold_until_by:
        found.append(Todo.hold_until <= filters.hold_until_by)
    if filters.look_again_by:
        found.append(and_(Todo.state == "waiting", Todo.look_again <= filters.look_again_by))
    if filters.done_from:
        found.append(Todo.done >= filters.done_from)
    if filters.done_to:
        found.append(Todo.done <= filters.done_to)
    if day := filters.shown_on:
        # Held off, or waiting with its look-again day still ahead: no list shows it yet.
        found.append(or_(Todo.hold_until.is_(None), Todo.hold_until <= day))
        found.append(
            or_(Todo.state != "waiting", Todo.look_again.is_(None), Todo.look_again <= day)
        )
    return found


def order(sort: Sort) -> list[Any]:
    """The order a sort names; ties fall back to the note and sibling order."""
    rank = case(
        *(
            (Todo.priority.is_(None) if level is None else Todo.priority == level, place)
            for place, level in enumerate(PRIORITY_ORDER)
        ),
    )
    place = [Todo.note, Todo.parent_id, Todo.position, Todo.created]
    first = {
        "place": [],
        "priority": [rank, Todo.due.asc().nulls_last()],
        "due": [Todo.due.asc().nulls_last(), rank],
        "planned": [Todo.planned.asc().nulls_last(), rank],
        "created": [Todo.created],
    }[sort]
    return [*first, *place]


async def search(session: AsyncSession, filters: Filters) -> list[Todo]:
    """The todos `filters` keeps, in its order."""
    query = select(Todo).where(*where(filters)).order_by(*order(filters.sort))
    if filters.limit is not None:
        query = query.limit(filters.limit)
    return list((await session.scalars(query)).all())
