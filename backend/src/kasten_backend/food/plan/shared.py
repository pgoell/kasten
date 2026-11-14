"""The week plans' meals and the recipe notes, as the lists app's Essen and Rezepte tabs read them.

Read-only, and only meals and recipes: training days, protein and nutrition stay in kasten. A
recipe goes by its note's name, never its path, so the share host learns no folder outside its own.
"""

import re
from datetime import date, timedelta
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend import frontmatter, vault
from kasten_backend.food.plan.note import (
    Kind,
    Slot,
    parse_plan,
)
from kasten_backend.food.recipes import PIN, parse_amount, parse_recipe, recipe_title
from kasten_backend.graph import typed_notes
from kasten_backend.links import link_path

if TYPE_CHECKING:
    from pathlib import Path

DAYS_SHOWN = 7
# No part holds a `[` or the mark opening the next, and a gap starts on its first blank only,
# so a long line reads in linear time.
LINK = re.compile(r"\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|([^\[\]]+))?\]\]")
COOK = re.compile(r"(?<![ \t])[ \t]*👤.*$")


class SharedMeal(BaseModel):
    """One meal: the dish, whether it comes from a batch, how many it cooks, and who cooks."""

    slot: Slot
    kind: Kind
    dish: str
    servings: int | None
    cook: str | None
    recipe: str | None
    """The recipe note's name for `GET /share/recipes/{name}`, or None for a dish with no note."""


class SharedDay(BaseModel):
    """A day that has a planned meal, its meals lunch first."""

    date: str
    meals: list[SharedMeal]


def _words(text: str) -> str:
    """A meal's words without link brackets or its cook, `[[Dal|Linsen-Dal]]` as `Linsen-Dal`."""
    plain = LINK.sub(lambda found: (found[2] or found[1]).strip(), COOK.sub("", text))
    return " ".join(plain.split())


def upcoming(root: Path, folder: str, names: list[str], today: date, skip: str) -> list[SharedDay]:
    """The meals of each week plan among the share folder's `names`, today and six days on.

    Blocking file reads, so an async caller runs it in a thread.
    """
    last = today + timedelta(DAYS_SHOWN - 1)
    book = Cookbook(root, skip)
    found: dict[str, list[tuple[int, SharedMeal]]] = {}
    for name in names:
        try:
            text = vault.read_note(root, f"{folder}/{name}.md")
        except UnicodeDecodeError, OSError:
            continue
        kind = (frontmatter.field(text or "", "type") or "").strip("'\"").lower()
        if text is None or kind != "meal plan":
            continue
        plan = parse_plan(text)
        if plan.monday is None:
            continue
        for meal in plan.meals:
            day = plan.monday + timedelta(meal.day)
            if not today <= day <= last:
                continue
            dish = meal.target if meal.kind in ("cook", "from") and meal.target else None
            shown = SharedMeal(
                slot=meal.slot,
                kind=meal.kind,
                dish=dish or _words(meal.text),
                servings=meal.servings,
                cook=meal.cook,
                recipe=book.name_of(meal.target),
            )
            found.setdefault(day.isoformat(), []).append((0 if meal.slot == "lunch" else 1, shown))
    return [
        SharedDay(date=day, meals=[meal for _, meal in sorted(meals, key=lambda pair: pair[0])])
        for day, meals in sorted(found.items())
    ]


class SharedRecipeEntry(BaseModel):
    """A recipe as the Rezepte tab lists it."""

    name: str
    title: str
    servings: float | None
    time: str | None
    tags: list[str]


class SharedIngredient(BaseModel):
    """An ingredient line, its barcode taken off, with the number a view scales."""

    text: str
    group: str | None
    quantity: float | None
    quantity_to: float | None
    rest: str
    """The line after its quantity, unit included."""


class SharedRecipe(SharedRecipeEntry):
    """A recipe as the lists app shows it to cook from. The meals cooked stay in kasten."""

    source: str | None
    ingredients: list[SharedIngredient]
    steps: list[str]


class Cookbook:
    """The vault's recipe notes that a bare `[[name]]` reaches, outside the `skip` folder.

    Blocking file reads, so an async caller runs it in a thread.
    """

    def __init__(self, root: Path, skip: str) -> None:
        """Walk the vault once, for every name this cookbook answers."""
        self.root = root
        self.paths = vault.list_markdown_files(root)
        self.recipes = set(typed_notes(root, "recipe", skip))

    def path_of(self, name: str) -> str | None:
        """The recipe note `[[name]]` names, or None when that is no recipe or a path."""
        if "/" in name or "\\" in name:
            return None
        path = link_path(name, self.paths)
        return path if path in self.recipes else None

    def name_of(self, target: str | None) -> str | None:
        """The name that reaches the recipe `[[target]]` names, or None for no recipe."""
        if target is None:
            return None
        path = link_path(target, self.paths)
        name = path.rsplit("/", 1)[-1].removesuffix(".md")
        return name if path in self.recipes and self.path_of(name) == path else None

    def _text(self, path: str) -> str | None:
        try:
            return vault.read_note(self.root, path)
        except UnicodeDecodeError, OSError:
            return None

    def entries(self) -> list[SharedRecipeEntry]:
        """Every recipe its name reaches, by title."""
        found: list[SharedRecipeEntry] = []
        for path in sorted(self.recipes):
            name = path.rsplit("/", 1)[-1].removesuffix(".md")
            text = self._text(path)
            if text is None or self.path_of(name) != path:
                continue
            note = parse_recipe(text)
            found.append(
                SharedRecipeEntry(
                    name=name,
                    title=recipe_title(text, path),
                    servings=note.servings,
                    time=note.time,
                    tags=note.tags,
                )
            )
        return sorted(found, key=lambda entry: entry.title.lower())

    def recipe(self, name: str) -> SharedRecipe | None:
        """The recipe `name` reaches, read to cook from, or None."""
        path = self.path_of(name)
        text = None if path is None else self._text(path)
        if path is None or text is None:
            return None
        note = parse_recipe(text)
        ingredients = []
        for line in note.ingredients:
            plain = PIN.sub("", line.text).strip()
            amount = parse_amount(plain)
            ingredients.append(
                SharedIngredient(
                    text=plain,
                    group=line.group,
                    quantity=amount.quantity,
                    quantity_to=amount.quantity_to,
                    rest=amount.rest,
                )
            )
        return SharedRecipe(
            name=path.rsplit("/", 1)[-1].removesuffix(".md"),
            title=recipe_title(text, path),
            servings=note.servings,
            time=note.time,
            tags=note.tags,
            source=note.source,
            ingredients=ingredients,
            steps=note.steps,
        )
