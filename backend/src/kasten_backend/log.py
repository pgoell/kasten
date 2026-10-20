"""The day's log, read off the `## Log` lines of the daily note and added up.

The line is the record, as a todo is. An entry lives nowhere but its line, so
Obsidian and `cat` show all of it, and every answer is read from the notes:
nothing is stored, so nothing can fall behind them.

The format is `docs/reference/log-format.md`, and its cases are
`frontend/src/lib/log-cases.json`, which the tests run through the endpoint.
The parser sits here and not in the editor because the sums are made here, and
nothing else reads the format.
"""

import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from kasten_backend import vault
from kasten_backend.code_spans import code_spans, inside
from kasten_backend.config import Settings, get_settings
from kasten_backend.frontmatter import body_start
from kasten_backend.periodic import DAILY, SECTION_END, daily_path
from kasten_backend.todos import mask

router = APIRouter()

LOG = "## Log"

DAY_NOTE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}\.md")
"""A daily note's name. A pattern, since `date.fromisoformat` also takes `20261020`."""

ETHANOL_DENSITY = 0.789
"""Grams per millilitre of ethanol, which turns an alcohol line's volume and strength into grams."""

_VS = "\N{VARIATION SELECTOR-16}?"
"""The optional variation selector each marker may carry, as `☕️` does."""

_NUMBER = r"[0-9]+(?:[.,][0-9]+)?"
"""A number, digits with an optional decimal part. `[0-9]`, since `\\d` takes other digits."""

MAX_STRENGTH = 100
"""Per cent alcohol by volume, the most an alcohol line may give: pure ethanol."""


class Entry(BaseModel):
    """One log line that parsed: its kind, and the fields the line gives and no others."""

    line: int
    """Which line of the note it is, counting from one."""

    text: str
    """The whole line, as the note holds it."""

    kind: Literal["water", "coffee", "alcohol", "food"]
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


class Totals(BaseModel):
    """What a day adds up to. Every kind is always present, zero where nothing was logged."""

    water: Water
    coffee: Coffee
    alcohol: Alcohol
    food: Food


class Day(BaseModel):
    """A day whose note holds a `## Log`: its entries in line order, and their totals."""

    date: str
    path: str
    entries: list[Entry]
    totals: Totals


WATER = re.compile(rf"- 💧{_VS}[ \t]+({_NUMBER})[ \t]*(ml|l)[ \t]*", re.IGNORECASE)
COFFEE = re.compile(rf"- ☕{_VS}[ \t]+([0-9]+)[ \t]*", re.IGNORECASE)
ALCOHOL = re.compile(
    rf"- 🍺{_VS}[ \t]+([0-9]+)"
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
    return Entry(line=line, text=text, kind="food", meal=meal_name, words=words, **values)


def parse_line(text: str, line: int) -> Entry | None:
    """The entry the line `line` of a note holds, or None for a line that parses to none."""
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
    spans = code_spans(text)
    body = body_start(text)
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


def _totals(entries: list[Entry]) -> Totals:
    """Each kind's sums over `entries`, taken unrounded and rounded once at the end."""

    def total(kind: str, name: str) -> float:
        return round(sum(getattr(e, name) or 0 for e in entries if e.kind == kind), 1)

    alcohol = [e for e in entries if e.kind == "alcohol"]
    return Totals(
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
async def read_log(
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date, Query(alias="to")],
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[Day]:
    """The days from `from` to `to`, both included, that have a `## Log` in their note.

    A day with no note, or a note with no `## Log`, is absent from the answer,
    which is not the same as a day with a `## Log` and nothing under it: that one
    is present with zero totals. Only the daily notes are read, and nothing is written.
    """
    if start > end:
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
        if start <= day <= end:
            found.append(day)

    days: list[Day] = []
    for day in found:
        path = daily_path(day, settings.periodic_path)
        try:
            text = vault.read_note(settings.vault_path, path)
        except FileNotFoundError:
            # Deleted after the note was found, which reads as no note.
            continue
        lines = None if text is None else _log_lines(text)
        if lines is None:
            continue
        entries = [
            parsed for number, line in lines if (parsed := parse_line(line, number)) is not None
        ]
        days.append(Day(date=day.isoformat(), path=path, entries=entries, totals=_totals(entries)))
    return days
