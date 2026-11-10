"""A recipe note's parts: its frontmatter fields, ingredient lines, steps and meals cooked.

The format is in `docs/reference/food/recipe-note.md`.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal, cast, get_args

from pydantic import BaseModel

from kasten_backend import frontmatter

INGREDIENTS = frozenset({"zutaten", "ingredients"})
STEPS = frozenset({"schritte", "zubereitung", "steps"})
COOKED = frozenset({"gekocht", "cooked"})
Verdict = Literal["lieber nicht", "geht so", "gern wieder"]
VERDICTS: tuple[Verdict, ...] = get_args(Verdict)
SECTION = re.compile(r"## (.+?)[ \t]*")
GROUP = re.compile(r"### (.+?)[ \t]*")
INGREDIENT = re.compile(r"[-*+] (?:\[[ xX]\] )?(.*\S)[ \t]*")
"""An ingredient bullet at column 0. A todo box is passed over, so a ticked line still counts."""
STEP = re.compile(r"[0-9]+[.)] (.*\S)[ \t]*")
COOKED_LINE = re.compile(r"[-*+] ([0-9]{4}-[0-9]{2}-[0-9]{2})\b[ \t]*(.*?)[ \t]*")
VERDICT = re.compile(rf"({'|'.join(VERDICTS)})\b[ \t]*(.*)", re.IGNORECASE)
FENCE = re.compile(r"(```|~~~)")
MOST_SERVINGS = 1000
"""Past this a number is a typo or a weight, not servings."""


@dataclass(frozen=True)
class IngredientLine:
    """One line under `## Zutaten`: where it is, what it says after the bullet, and its group."""

    line: int
    text: str
    group: str | None


class Cooked(BaseModel):
    """A line under `## Gekocht`: the day cooked, the answer to "wieder kochen?", and a note."""

    line: int
    date: str
    verdict: Verdict | None
    note: str | None


@dataclass
class RecipeNote:
    """What a recipe note holds that kasten reads. Missing fields are None."""

    servings: float | None
    time: str | None
    source: str | None
    tags: list[str]
    ingredients: list[IngredientLine] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    cooked: list[Cooked] = field(default_factory=list)


def _servings(value: str | None) -> float | None:
    """`servings: 4` as 4. Anything that is no number above zero is no servings."""
    if value is None:
        return None
    try:
        number = float(value.replace(",", "."))
    except ValueError:
        return None
    return number if 0 < number < MOST_SERVINGS else None


def parse_recipe(content: str) -> RecipeNote:
    """The recipe the note `content` holds. A note with no `## Zutaten` has no ingredients."""
    recipe = RecipeNote(
        servings=_servings(frontmatter.field(content, "servings")),
        time=frontmatter.field(content, "time") or None,
        source=frontmatter.field(content, "source") or None,
        tags=frontmatter.tags(content),
    )
    lines = content.split("\n")
    close = frontmatter.closing(lines)
    section: str | None = None
    group: str | None = None
    fence: str | None = None
    for index, raw in enumerate(lines):
        text = raw.rstrip("\r")
        if close is not None and index <= close:
            continue
        if (opens := FENCE.match(text)) is not None:
            fence = opens[1] if fence is None else (None if opens[1] == fence else fence)
            continue
        if fence is not None:
            continue
        if text.startswith("# "):
            section, group = None, None
        elif (found := SECTION.fullmatch(text)) is not None:
            section, group = _section(found[1]), None
        else:
            group = _add(recipe, section, group, index + 1, text)
    return recipe


def _add(
    recipe: RecipeNote, section: str | None, group: str | None, line: int, text: str
) -> str | None:
    """Add line `text` to the part of `recipe` its section holds, and answer the group after it."""
    if section == "ingredients" and (heading := GROUP.fullmatch(text)) is not None:
        return heading[1]
    if section == "ingredients" and (item := INGREDIENT.fullmatch(text)) is not None:
        recipe.ingredients.append(IngredientLine(line, item[1], group))
    elif section == "steps" and (step := STEP.fullmatch(text)) is not None:
        recipe.steps.append(step[1])
    elif section == "cooked" and (cooked := _cooked(line, text)) is not None:
        recipe.cooked.append(cooked)
    return group


def _cooked(line: int, text: str) -> Cooked | None:
    """`- 2026-11-09 gern wieder · mehr Würze` read, or None for a line with no real day."""
    found = COOKED_LINE.fullmatch(text)
    if found is None:
        return None
    try:
        day = date.fromisoformat(found[1])
    except ValueError:
        return None
    verdict: Verdict | None = None
    rest = found[2]
    if (said := VERDICT.match(rest)) is not None:
        verdict = cast("Verdict", said[1].lower())
        rest = said[2]
    note = rest.removeprefix("·").strip()
    return Cooked(line=line, date=day.isoformat(), verdict=verdict, note=note or None)


def _section(heading: str) -> str | None:
    """Which part of the recipe a `## ` heading opens, or None for any other heading."""
    name = heading.lower()
    if name in INGREDIENTS:
        return "ingredients"
    if name in COOKED:
        return "cooked"
    return "steps" if name in STEPS else None
