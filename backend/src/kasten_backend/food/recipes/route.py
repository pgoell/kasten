"""`POST /api/recipe/nutrition`: a recipe note's text in, its ingredients and numbers out.

The card sends the open buffer, so the numbers follow typing without waiting for a save.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from kasten_backend import vault
from kasten_backend.config import Settings, get_settings
from kasten_backend.food.recipes.foods import FOODS_NOTE, MyFood, parse_my_foods
from kasten_backend.food.recipes.note import parse_recipe
from kasten_backend.food.recipes.nutrition import Recipe, recipe_nutrition

router = APIRouter()

MAX_TEXT = 200_000


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
