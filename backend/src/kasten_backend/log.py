"""The day's log, read off the `## Log` lines of the daily note and added up.

The line is the record, as a todo is. An entry lives nowhere but its line, so
Obsidian and `cat` show all of it, and every answer is read from the notes:
nothing is stored, so nothing can fall behind them.

The format is `docs/reference/log-format.md`, and its cases are
`frontend/src/lib/log-cases.json`, which the tests run through the endpoint.
The parser sits here because the sums are made here. The daily note's card
reads the drink lines of the open buffer with `frontend/src/lib/log-lines.ts`,
held to the same cases, so a tap counts before the save.
"""

import re
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from kasten_backend import vault
from kasten_backend.code_spans import code_spans, inside
from kasten_backend.config import Settings, get_settings
from kasten_backend.frontmatter import body_start
from kasten_backend.log_config import Kind, parse_config, parse_kind_line
from kasten_backend.periodic import DAILY, SECTION_END, daily_path
from kasten_backend.todos import mask

if TYPE_CHECKING:
    from collections.abc import Sequence

router = APIRouter()

LOG = "## Log"

CONFIG_NOTE = "log.md"
"""The config note's name, in the config folder, which names the kinds of your own."""

DAY_NOTE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}\.md")
"""A daily note's name. A pattern, since `date.fromisoformat` also takes `20261020`."""

ETHANOL_DENSITY = 0.789
"""Grams per millilitre of ethanol, which turns an alcohol line's volume and strength into grams."""

_VS = "\N{VARIATION SELECTOR-16}?"
"""The optional variation selector each marker may carry, as `☕️` does."""

_NUMBER = r"[0-9]{1,9}(?:[.,][0-9]{1,9})?"
"""A number: up to nine digits, then an optional point or comma and up to nine more.

`[0-9]`, not `\\d`, which takes other digits. The cap keeps a line's arithmetic on
values a float holds exactly; a longer run is no entry, as the table says.
"""

DATE_PATTERN = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
"""The shape of `from` and `to`.

Pydantic's date mode reads `0` as a day, so the route takes the text and reads it.
"""

MAX_STRENGTH = 100
"""Per cent alcohol by volume, the most an alcohol line may give: pure ethanol."""


def _unset(value: object) -> bool:
    """Whether a field is left out of the JSON. Only the fields a config note adds use it.

    They are absent with no config note rather than null, so the answer for a
    vault without one is the answer the route gave before the note existed.
    """
    return value is None


class Entry(BaseModel):
    """One log line that parsed: its kind, and the fields the line gives and no others."""

    line: int
    """Which line of the note it is, counting from one."""

    text: str
    """The whole line, as the note holds it."""

    kind: Literal["water", "coffee", "alcohol", "food", "mine"]
    ml: float | None = None
    """Water's amount, or an alcohol line's count times its volume per drink."""

    count: int | None = None
    abv: float | None = None
    grams: float | None = None
    """An alcohol line's grams of alcohol, rounded, when it gives both a volume and a strength."""

    meal: str | None = None
    words: str | None = None
    kcal: float | None = None
    protein: float | None = None
    carbs: float | None = None
    fat: float | None = None
    mark: str | None = Field(default=None, exclude_if=_unset)
    """A kind of your own's mark, and its name, amount and unit as the config names them."""
    name: str | None = Field(default=None, exclude_if=_unset)
    amount: float | None = Field(default=None, exclude_if=_unset)
    unit: str | None = Field(default=None, exclude_if=_unset)


class Water(BaseModel):
    """What the water lines add up to, in millilitres."""

    ml: float


class Coffee(BaseModel):
    """How many coffees the day logs."""

    count: int


class Alcohol(BaseModel):
    """What the alcohol lines add up to: drinks, millilitres and grams of ethanol."""

    count: int
    ml: float
    grams: float


class Food(BaseModel):
    """What the food lines add up to: kcal, and grams of protein, carbs and fat."""

    kcal: float
    protein: float
    carbs: float
    fat: float


class MineTotal(BaseModel):
    """What one kind of your own adds up to on a day, rounded to a tenth."""

    mark: str
    name: str
    unit: str
    total: float


class Totals(BaseModel):
    """What a day adds up to. Every kind is always present, zero where nothing was logged."""

    water: Water
    coffee: Coffee
    alcohol: Alcohol
    food: Food
    mine: list[MineTotal] | None = Field(default=None, exclude_if=_unset)
    """One per kind of your own the config names, in config order. Absent with no config note."""


class Day(BaseModel):
    """A day whose note holds a `## Log`: its entries in line order, and their totals."""

    date: str
    path: str
    entries: list[Entry]
    totals: Totals


WATER = re.compile(rf"- 💧{_VS}[ \t]+({_NUMBER})[ \t]*(ml|l)[ \t]*", re.IGNORECASE)
COFFEE = re.compile(rf"- ☕{_VS}[ \t]+([0-9]{{1,9}})[ \t]*", re.IGNORECASE)
ALCOHOL = re.compile(
    rf"- 🍺{_VS}[ \t]+([0-9]{{1,9}})"
    rf"(?:[ \t]+({_NUMBER})[ \t]*(ml|l))?"
    rf"(?:[ \t]+({_NUMBER})[ \t]*%)?[ \t]*",
    re.IGNORECASE,
)
FOOD = re.compile(rf"- 🍽{_VS}[ \t]+")
MEAL = re.compile(r"(breakfast|lunch|dinner|snack):", re.IGNORECASE)
FIELD_START = re.compile("[🔥🥩🍞🧈]")
FIELD = re.compile(rf"([🔥🥩🍞🧈]){_VS}[ \t]+({_NUMBER})(?:[ \t]*(kcal|g))?", re.IGNORECASE)
FIELDS = re.compile(rf"{FIELD.pattern}(?:[ \t]+{FIELD.pattern})*[ \t]*", re.IGNORECASE)

FOOD_FIELDS = {
    "🔥": ("kcal", "kcal"),
    "🥩": ("protein", "g"),
    "🍞": ("carbs", "g"),
    "🧈": ("fat", "g"),
}
"""Each field's marker, the entry field it sets, and the unit its value may carry."""


def _decimal(number: str) -> Decimal:
    """A written number as an exact decimal, a comma read as the point."""
    return Decimal(number.replace(",", "."))


def _factor(unit: str | None) -> int:
    """How many millilitres one of `unit` holds: a litre is 1000, anything else 1."""
    return 1000 if unit is not None and unit.lower() == "l" else 1


def _grams(ml: float, abv: float) -> float:
    """Grams of ethanol in `ml` of a drink at `abv` per cent, unrounded."""
    return ml * abv / 100 * ETHANOL_DENSITY


def _alcohol(text: str, line: int, found: re.Match[str]) -> Entry | None:
    count = int(found[1])
    ml = float(_decimal(found[2]) * _factor(found[3]) * count) if found[2] else None
    abv = float(_decimal(found[4])) if found[4] else None
    if count < 1 or (ml is not None and ml <= 0) or (abv is not None and abv > MAX_STRENGTH):
        return None
    # Only with both, as the sum of grams is only over lines that give both.
    grams = round(_grams(ml, abv), 1) if ml is not None and abv is not None else None
    return Entry(line=line, text=text, kind="alcohol", count=count, ml=ml, abv=abv, grams=grams)


def _food(text: str, line: int) -> Entry | None:
    start = FOOD.match(text)
    if start is None:
        return None
    meal = MEAL.match(text, start.end())
    begin = meal.end() if meal else start.end()
    # Found on the masked copy, so a marker in a code span or a link stays words.
    field = FIELD_START.search(mask(text), begin)
    words = text[begin : field.start() if field else len(text)].strip(" \t")

    values: dict[str, float] = {}
    if field is not None:
        tail = text[field.start() :]
        if FIELDS.fullmatch(tail) is None:
            return None
        for mark, number, unit in FIELD.findall(tail):
            name, expected = FOOD_FIELDS[mark]
            if name in values or (unit and unit.lower() != expected):
                return None
            values[name] = float(_decimal(number))

    if not words and not values:
        return None
    meal_name = meal[1].lower() if meal else None
    return Entry(
        line=line,
        text=text,
        kind="food",
        meal=meal_name,
        words=words,
        kcal=values.get("kcal"),
        protein=values.get("protein"),
        carbs=values.get("carbs"),
        fat=values.get("fat"),
    )


def _mine(text: str, line: int, kinds: Sequence[Kind]) -> Entry | None:
    """The entry a line of a kind of your own holds, or None when no kind of the config reads it."""
    for kind in kinds:
        amount = parse_kind_line(kind, text)
        if amount is not None:
            return Entry(
                line=line,
                text=text,
                kind="mine",
                mark=kind.mark,
                name=kind.name,
                amount=amount,
                unit=kind.unit,
            )
    return None


def parse_line(text: str, line: int, kinds: Sequence[Kind] = ()) -> Entry | None:
    """The entry the line `line` of a note holds, or None for a line that parses to none.

    A kind of your own is tried only after the built-in parsers all fail, so a line
    keeps the meaning it has always had.
    """
    if (entry := _builtin_line(text, line)) is not None:
        return entry
    return _mine(text, line, kinds)


def _builtin_line(text: str, line: int) -> Entry | None:
    """The entry a line holds as one of the built-in kinds, or None."""
    if found := WATER.fullmatch(text):
        ml = float(_decimal(found[1]) * _factor(found[2]))
        return Entry(line=line, text=text, kind="water", ml=ml) if ml > 0 else None
    if found := COFFEE.fullmatch(text):
        count = int(found[1])
        return Entry(line=line, text=text, kind="coffee", count=count) if count > 0 else None
    if found := ALCOHOL.fullmatch(text):
        return _alcohol(text, line, found)
    return _food(text, line)


def _log_lines(text: str) -> list[tuple[int, str]] | None:
    """The lines under the `## Log` sections of `text`, numbered, or None when there is no section.

    Each line is judged by its start offset. A fence `code_spans` finds, and the
    frontmatter `body_start` skips, hold no heading and no entry.
    """
    body = body_start(text)
    # Fences are found in the body alone, so a fence the frontmatter seems to open
    # hides nothing below it.
    spans = [(start + body, end + body) for start, end in code_spans(text[body:])]
    lines: list[tuple[int, str]] = []
    seen = False
    in_log = False
    offset = 0
    for number, line in enumerate(text.split("\n"), 1):
        start, offset = offset, offset + len(line) + 1
        if start < body or inside(start, spans):
            continue
        # `## Log` matches the section end too, so the flag is set from it here.
        if SECTION_END.match(line):
            in_log = line.rstrip() == LOG
            seen = seen or in_log
        elif in_log:
            lines.append((number, line))
    return lines if seen else None


def _grams_of(entry: Entry) -> float:
    """An alcohol entry's grams before rounding, which the day's total sums, or 0 without both."""
    if entry.ml is None or entry.abv is None:
        return 0.0
    return _grams(entry.ml, entry.abv)


def _totals(entries: list[Entry], kinds: list[Kind] | None) -> Totals:
    """Each kind's sums over `entries`, taken unrounded and rounded once at the end.

    `kinds` is the config's kinds of your own, or None with no config note, which
    leaves `mine` out of the answer.
    """

    def total(kind: str, name: str) -> float:
        return round(sum(getattr(e, name) or 0 for e in entries if e.kind == kind), 1)

    alcohol = [e for e in entries if e.kind == "alcohol"]
    mine = None
    if kinds is not None:
        mine = [
            MineTotal(
                mark=kind.mark,
                name=kind.name,
                unit=kind.unit,
                total=round(
                    sum(e.amount or 0 for e in entries if e.kind == "mine" and e.mark == kind.mark),
                    1,
                ),
            )
            for kind in kinds
        ]
    return Totals(
        mine=mine,
        water=Water(ml=total("water", "ml")),
        coffee=Coffee(count=sum(e.count or 0 for e in entries if e.kind == "coffee")),
        alcohol=Alcohol(
            count=sum(e.count or 0 for e in alcohol),
            ml=total("alcohol", "ml"),
            grams=round(sum(_grams_of(e) for e in alcohol), 1),
        ),
        food=Food(
            kcal=total("food", "kcal"),
            protein=total("food", "protein"),
            carbs=total("food", "carbs"),
            fat=total("food", "fat"),
        ),
    )


@router.get("/api/log")
def read_log(
    start: Annotated[str, Query(alias="from", pattern=DATE_PATTERN)],
    end: Annotated[str, Query(alias="to", pattern=DATE_PATTERN)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[Day]:
    """The days from `from` to `to`, both included, that have a `## Log` in their note.

    A day with no note, or a note with no `## Log`, is absent from the answer,
    which is not the same as a day with a `## Log` and nothing under it: that one
    is present with zero totals. Only the daily notes are read, and nothing is written.
    """
    # A plain `def`, not `async`: FastAPI runs it in its thread pool, so the file
    # reads and the markdown parse do not hold up the event loop.
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="`from` and `to` must be real dates") from error
    if first > last:
        raise HTTPException(status_code=400, detail="`from` is after `to`")

    # One listing of the folder, not a read per date: a range of years would
    # otherwise stall the backend on millions of misses.
    folder = vault.resolve_folder(settings.vault_path, f"{settings.periodic_path}/{DAILY}")
    if folder is None:
        return []

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

    # Read once for the whole range. A note that is not there, or not UTF-8, leaves
    # `mine` out of every day, as a missing note does.
    try:
        config_text = vault.read_note(settings.vault_path, f"{settings.config_path}/{CONFIG_NOTE}")
    except UnicodeDecodeError, OSError:
        config_text = None
    kinds = (
        None
        if config_text is None
        else [kind for kind in parse_config(config_text).kinds if kind.builtin is None]
    )

    days: list[Day] = []
    for day in found:
        path = daily_path(day, settings.periodic_path)
        try:
            text = vault.read_note(settings.vault_path, path)
        except UnicodeDecodeError, OSError:
            # Gone, unreadable or not UTF-8: a note the reader cannot take is
            # skipped as a missing one, so one bad file does not fail the range.
            continue
        lines = None if text is None else _log_lines(text)
        if lines is None:
            continue
        entries = [
            parsed
            for number, line in lines
            if (parsed := parse_line(line, number, kinds or ())) is not None
        ]
        days.append(
            Day(
                date=day.isoformat(),
                path=path,
                entries=entries,
                totals=_totals(entries, kinds),
            )
        )
    return days
