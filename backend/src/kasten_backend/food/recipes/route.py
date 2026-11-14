"""The recipe routes: one note's numbers, every recipe note's, and an import that writes one.

The card sends the open buffer to `POST /api/recipe/nutrition`, so the numbers follow typing
without waiting for a save. `docs/reference/http-api/food.md` holds all three.
"""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from kasten_backend import food, vault
from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import Settings, get_settings
from kasten_backend.files import RefusedError
from kasten_backend.folders import create_note
from kasten_backend.food.recipes import importer
from kasten_backend.food.recipes.foods import FOODS_NOTE, MyFood, parse_my_foods
from kasten_backend.food.recipes.note import parse_recipe, recipe_title
from kasten_backend.food.recipes.nutrition import Recipe, recipe_nutrition
from kasten_backend.frontmatter import stamp
from kasten_backend.graph import typed_notes

router = APIRouter()

MAX_TEXT = 200_000


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
        entries.append(
            RecipeEntry(
                path=path,
                title=recipe_title(text, path),
                servings=recipe.servings,
                per_serving=recipe.per_serving,
                total=recipe.total,
            )
        )
    return sorted(entries, key=lambda entry: entry.title.lower())


class RecipeImport(BaseModel):
    """A page to read a recipe from, or a schema.org Recipe already read, such as a caption's."""

    url: str | None = Field(default=None, max_length=2000)
    recipe: dict[str, object] | None = None
    source: str | None = Field(default=None, max_length=2000)
    """Where `recipe` came from, such as the reel's link, written as the note's `source`."""

    @model_validator(mode="after")
    def _one(self) -> RecipeImport:
        if (self.url is None) == (self.recipe is None):
            raise ValueError("Send a url or a recipe, not both")
        return self


class ImportedNote(BaseModel):
    """The recipe note an import wrote."""

    path: str
    title: str


@router.post("/api/recipes/import", status_code=201)
async def import_recipe(
    body: RecipeImport, settings: Annotated[Settings, Depends(get_settings)]
) -> ImportedNote:
    """Write a recipe note from a page's schema.org data, or from a schema.org Recipe.

    A page is fetched once plainly, and once more as a browser when a bot wall answers. Either
    way the note keeps where it came from as `source`. A name already taken gets a number.
    """
    try:
        if body.url is not None:
            url, page = await importer.fetch(body.url)
            recipe = await asyncio.to_thread(importer.from_html, page, url, url)
        else:
            recipe = await asyncio.to_thread(importer.from_json, body.recipe, body.source)
    except RefusedError as error:
        raise HTTPException(status_code=error.status, detail=str(error)) from error
    except importer.NoRecipeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    name = importer.file_name(recipe.title).removesuffix(".md")
    async with vault_write():
        for count in range(1, 100):
            wanted = f"{settings.recipes_path}/{name}{'' if count == 1 else f' {count}'}.md"
            note = vault.resolve_path(settings.vault_path, wanted)
            if note is None:
                raise HTTPException(status_code=400, detail="The vault will not take that path")
            if not note.exists():
                break
        else:
            raise HTTPException(status_code=409, detail="Too many recipes by that name")
        relative = vault.relative_path(settings.vault_path, note)
        async with vault_change(settings.vault_path, relative):
            create_note(note, stamp(importer.note_text(recipe)))
    return ImportedNote(path=relative, title=recipe.title)
