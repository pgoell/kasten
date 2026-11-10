"""The recipe routes: one note's numbers, and every recipe note's for the food sheet.

`POST /api/recipe/nutrition` takes a note's text and answers its ingredients and numbers.
`GET /api/recipes` lists every recipe note with its numbers per serving. The card sends the
open buffer, so the numbers follow typing without waiting for a save.
"""

import asyncio
import re
from posixpath import basename
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from kasten_backend import food, vault
from kasten_backend.config import Settings, get_settings
from kasten_backend.food.recipes.foods import FOODS_NOTE, MyFood, parse_my_foods
from kasten_backend.food.recipes.note import parse_recipe
from kasten_backend.food.recipes.nutrition import Recipe, recipe_nutrition
from kasten_backend.frontmatter import body_start
from kasten_backend.graph import typed_notes

router = APIRouter()

MAX_TEXT = 200_000
TITLE = re.compile(r"^# (.+?)[ \t]*$", re.MULTILINE)


class RecipeEntry(BaseModel):
    """A recipe note as the food sheet lists it."""

    path: str
    title: str
    """The note's first `# ` heading, or its file name without `.md`."""
    servings: float | None
    per_serving: food.Nutrients | None
    total: food.Nutrients


class RecipeText(BaseModel):
    """A recipe note as the editor holds it."""

    text: str = Field(max_length=MAX_TEXT)


def _my_foods(settings: Settings) -> list[MyFood]:
    """The foods of `foods.md`. A note that is missing or not UTF-8 holds none."""
    try:
        note = vault.read_note(settings.vault_path, f"{settings.config_path}/{FOODS_NOTE}")
    except UnicodeDecodeError, OSError:
        return []
    return [] if note is None else parse_my_foods(note)


@router.post("/api/recipe/nutrition")
async def read_recipe(
    body: RecipeText, settings: Annotated[Settings, Depends(get_settings)]
) -> Recipe:
    """The recipe's ingredient lines, each matched to a food or saying why not, and the sums.

    A barcode pinned to a line is looked up on Open Food Facts, inside its limits; a line it
    could not reach says `unreached` and the rest still count.
    """
    return await recipe_nutrition(
        parse_recipe(body.text), _my_foods(settings), settings.food_contact
    )


@router.get("/api/recipes")
async def list_recipes(settings: Annotated[Settings, Depends(get_settings)]) -> list[RecipeEntry]:
    """Every note with `type: Recipe` outside the archive, by title, with its numbers."""
    root = settings.vault_path
    paths = await asyncio.to_thread(typed_notes, root, "recipe", settings.archive_path)
    foods = _my_foods(settings)
    entries: list[RecipeEntry] = []
    for path in paths:
        try:
            text = vault.read_note(root, path)
        except UnicodeDecodeError, OSError:
            continue
        if text is None:
            continue
        recipe = await recipe_nutrition(parse_recipe(text), foods, settings.food_contact)
        title = TITLE.search(text, body_start(text))
        entries.append(
            RecipeEntry(
                path=path,
                title=title[1] if title else basename(path).removesuffix(".md"),
                servings=recipe.servings,
                per_serving=recipe.per_serving,
                total=recipe.total,
            )
        )
    return sorted(entries, key=lambda entry: entry.title.lower())
