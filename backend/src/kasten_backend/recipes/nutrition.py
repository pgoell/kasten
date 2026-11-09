"""kcal and macros for a recipe, from its ingredient lines matched to foods, never guessed.

A line matches a food of your own by name, or a barcode pinned with `🏷`, looked up in
`foods.md` and then on Open Food Facts. A line that cannot be counted says why.
"""

import re
from typing import TYPE_CHECKING, Literal

from fastapi import HTTPException
from pydantic import BaseModel

from kasten_backend import food
from kasten_backend.recipes.amounts import parse_amount

if TYPE_CHECKING:
    from kasten_backend.recipes.foods import MyFood
    from kasten_backend.recipes.note import IngredientLine, RecipeNote

PIN = re.compile(r"[ \t]*🏷️?[ \t]*([0-9]{8,14})\b")
"""A barcode pinned to a line, which names the food rather than its words."""
SUFFIXES = ("en", "n", "e", "s")
"""Plural and case endings taken off a name before it is compared, so `Zwiebeln` finds `Zwiebel`."""
FIELDS = ("kcal", "protein", "carbs", "fat")

Status = Literal["counted", "no_match", "no_amount", "no_weight", "unreached"]


class Match(BaseModel):
    """The food a line was matched to: one of yours or an Open Food Facts product."""

    source: Literal["mine", "off"]
    name: str
    code: str | None


class Ingredient(BaseModel):
    """One ingredient line, what kasten read from it, and what it adds to the recipe."""

    line: int
    text: str
    """The line as the note holds it, its bullet taken off."""
    group: str | None
    quantity: float | None
    quantity_to: float | None
    """The upper end of a range, as 3 in `2-3 Zwiebeln`. Only `quantity` is counted."""
    unit: str | None
    food: str
    note: str | None
    rest: str
    """The line after its quantity, as `Dosen Tomaten (je 400 g), gehackt`, without a pin."""
    grams: float | None
    match: Match | None
    status: Status
    nutrients: food.Nutrients | None


class Recipe(BaseModel):
    """A recipe's ingredients with their numbers, the sum, and the sum per serving."""

    servings: float | None
    time: str | None
    source: str | None
    tags: list[str]
    ingredients: list[Ingredient]
    steps: list[str]
    total: food.Nutrients
    """Over the counted lines. A field no counted line gives is null."""
    per_serving: food.Nutrients | None
    """The total over `servings`, or null when the note names none."""


def _stem(name: str) -> str:
    key = " ".join(name.lower().split())
    for suffix in SUFFIXES:
        if key.endswith(suffix) and len(key) > len(suffix) + 2:
            return key[: -len(suffix)]
    return key


class _Foods:
    """Your foods by name, by stem and by barcode. The first line to name one keeps it."""

    def __init__(self, foods: list[MyFood]) -> None:
        self.by_name: dict[str, MyFood] = {}
        self.by_stem: dict[str, MyFood] = {}
        self.by_code: dict[str, MyFood] = {}
        for mine in foods:
            self.by_name.setdefault(" ".join(mine.name.lower().split()), mine)
            self.by_stem.setdefault(_stem(mine.name), mine)
            if mine.code is not None:
                self.by_code.setdefault(mine.code, mine)

    def named(self, words: str) -> MyFood | None:
        """The food `words` names, trying the last words alone too, so `rote Zwiebel` finds it."""
        split = words.split()
        for start in range(len(split)):
            tail = " ".join(split[start:]).lower()
            found = self.by_name.get(tail) or self.by_stem.get(_stem(tail))
            if found is not None:
                return found
        return None


def _rounded(values: dict[str, float | None]) -> food.Nutrients:
    return food.Nutrients(
        **{key: None if value is None else round(value, 1) for key, value in values.items()}
    )


def _scaled(per_100g: dict[str, float | None], grams: float) -> dict[str, float | None]:
    return {key: None if value is None else value * grams / 100 for key, value in per_100g.items()}


async def _off(code: str, contact: str) -> food.Food | Literal["unreached"] | None:
    """The product Open Food Facts has, None for none, or `unreached` when it refused or failed."""
    try:
        return await food.product(code, contact)
    except HTTPException:
        return "unreached"


async def _matched(
    pin: str | None, words: str, foods: _Foods, contact: str
) -> tuple[Match, dict[str, float | None], float | None] | Status:
    """The food a line names, its figures per 100 g and its serving, or why there is none."""
    mine = foods.by_code.get(pin) if pin else foods.named(words)
    if mine is not None:
        per_100g = {key: getattr(mine, key) for key in FIELDS}
        return Match(source="mine", name=mine.name, code=mine.code), per_100g, mine.serving_g
    if pin is None:
        return "no_match"
    product = await _off(pin, contact)
    if product == "unreached":
        return "unreached"
    if product is None:
        return "no_match"
    serving = None if product.serving_from == "default" else product.serving_g
    match = Match(source="off", name=product.name, code=product.code)
    return match, product.per_100g.model_dump(), serving


async def _ingredient(
    item: IngredientLine, foods: _Foods, contact: str
) -> tuple[Ingredient, dict[str, float | None] | None]:
    """The line read and matched, and its nutrients unrounded, so the sum rounds only once."""
    pin = PIN.search(item.text)
    amount = parse_amount(PIN.sub("", item.text))
    read = Ingredient(
        line=item.line,
        text=item.text,
        group=item.group,
        quantity=amount.quantity,
        quantity_to=amount.quantity_to,
        unit=amount.unit,
        food=amount.food,
        note=amount.note,
        rest=amount.rest,
        grams=None,
        match=None,
        status="no_amount",
        nutrients=None,
    )
    if amount.quantity is None:
        return read, None
    matched = await _matched(None if pin is None else pin[1], amount.food, foods, contact)
    if isinstance(matched, str):
        return read.model_copy(update={"status": matched}), None
    match, per_100g, serving = matched
    each = amount.grams_per_unit if amount.grams_per_unit is not None else serving
    if each is None:
        return read.model_copy(update={"status": "no_weight", "match": match}), None
    grams = amount.quantity * each
    raw = _scaled(per_100g, grams)
    counted = {"grams": round(grams, 1), "match": match, "status": "counted"}
    return read.model_copy(update={**counted, "nutrients": _rounded(raw)}), raw


async def recipe_nutrition(recipe: RecipeNote, foods: list[MyFood], contact: str) -> Recipe:
    """The recipe's ingredients matched to `foods` and Open Food Facts, and their sums."""
    index = _Foods(foods)
    read = [await _ingredient(item, index, contact) for item in recipe.ingredients]
    counted = [raw for _, raw in read if raw is not None]
    total: dict[str, float | None] = {}
    for key in FIELDS:
        given = [value for raw in counted if (value := raw[key]) is not None]
        total[key] = sum(given) if given else None
    servings = recipe.servings
    per_serving = (
        None
        if servings is None
        else _rounded({k: None if v is None else v / servings for k, v in total.items()})
    )
    return Recipe(
        servings=servings,
        time=recipe.time,
        source=recipe.source,
        tags=recipe.tags,
        ingredients=[ingredient for ingredient, _ in read],
        steps=recipe.steps,
        total=_rounded(total),
        per_serving=per_serving,
    )
