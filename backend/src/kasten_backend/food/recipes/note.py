"""A recipe note's parts: the frontmatter fields, the ingredient lines and the steps.

The format is in `docs/reference/food/recipe-note.md`.
"""

import re
from dataclasses import dataclass, field

from kasten_backend import frontmatter

INGREDIENTS = frozenset({"zutaten", "ingredients"})
STEPS = frozenset({"schritte", "zubereitung", "steps"})
SECTION = re.compile(r"## (.+?)[ \t]*")
GROUP = re.compile(r"### (.+?)[ \t]*")
INGREDIENT = re.compile(r"[-*+] (?:\[[ xX]\] )?(.*\S)[ \t]*")
"""An ingredient bullet at column 0. A todo box is passed over, so a ticked line still counts."""
STEP = re.compile(r"[0-9]+[.)] (.*\S)[ \t]*")
FENCE = re.compile(r"(```|~~~)")
MOST_SERVINGS = 1000
"""Past this a number is a typo or a weight, not servings."""


@dataclass(frozen=True)
class IngredientLine:
    """One line under `## Zutaten`: where it is, what it says after the bullet, and its group."""

    line: int
    text: str
    group: str | None


@dataclass
class RecipeNote:
    """What a recipe note holds that kasten reads. Missing fields are None."""

    servings: float | None
    time: str | None
    source: str | None
    tags: list[str]
    ingredients: list[IngredientLine] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)


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
        elif section == "ingredients" and (heading := GROUP.fullmatch(text)) is not None:
            group = heading[1]
        elif section == "ingredients" and (item := INGREDIENT.fullmatch(text)) is not None:
            recipe.ingredients.append(IngredientLine(index + 1, item[1], group))
        elif section == "steps" and (step := STEP.fullmatch(text)) is not None:
            recipe.steps.append(step[1])
    return recipe


def _section(heading: str) -> str | None:
    """Which part of the recipe a `## ` heading opens, or None for any other heading."""
    name = heading.lower()
    if name in INGREDIENTS:
        return "ingredients"
    return "steps" if name in STEPS else None
