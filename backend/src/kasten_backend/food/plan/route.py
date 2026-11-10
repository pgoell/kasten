"""The week plan routes: the plan as the week view draws it, and its ingredients into Einkauf.

Both take the open buffer, so the view follows typing. `docs/reference/http-api/food.md`.
"""

import asyncio
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from kasten_backend import agent, vault
from kasten_backend.config import Settings, get_settings
from kasten_backend.food.plan import shopping
from kasten_backend.food.plan.note import Plan, parse_plan
from kasten_backend.food.plan.week import Batch, PlanDay, PlannedMeal, days, lay_out
from kasten_backend.food.recipes.foods import FOODS_NOTE, parse_my_foods
from kasten_backend.food.recipes.note import RecipeNote, parse_recipe
from kasten_backend.food.recipes.nutrition import recipe_nutrition
from kasten_backend.log_config import parse_config
from kasten_backend.periodic import day_sections
from kasten_backend.training import parse_line
from kasten_backend.vault import list_markdown_files

router = APIRouter()

MAX_TEXT = 200_000
SHOPPING_NOTE = "Einkauf.md"
CONFIG_NOTE = "log.md"
TRAINING = "## Training"


class PlanText(BaseModel):
    """A week plan note as the editor holds it."""

    text: str = Field(max_length=MAX_TEXT)


class ProteinGoal(BaseModel):
    """The daily protein goal of the log's config note."""

    type: str
    value: float


class MealPlan(BaseModel):
    """The week as the view draws it."""

    week: str | None
    """The ISO week, as `2026-W46`, or null when the note names none."""
    fridge_days: int
    days: list[PlanDay]
    meals: list[PlannedMeal]
    batches: list[Batch]
    protein_goal: ProteinGoal | None
    ingredients: int
    """How many lines the week's cooked batches bring to the shopping list, before merging."""


class ShoppingWritten(BaseModel):
    """What `POST /api/meal-plan/shopping` did to the shopping list."""

    path: str
    added: int
    merged: int
    """Open lines that took more of a food, for a recipe they did not link yet."""
    skipped: int
    """Foods an open line already holds for every recipe, which a second press adds nothing to."""


def _read(settings: Settings, path: str) -> str | None:
    try:
        return vault.read_note(settings.vault_path, path)
    except UnicodeDecodeError, OSError:
        return None


def _recipes(settings: Settings, meals: list[PlannedMeal]) -> dict[str, RecipeNote]:
    """Each recipe note the meals name, by path. One that cannot be read is left out."""
    found: dict[str, RecipeNote] = {}
    for meal in meals:
        if meal.path is not None and meal.path not in found:
            text = _read(settings, meal.path)
            if text is not None:
                found[meal.path] = parse_recipe(text)
    return found


def _cooked(
    meals: list[PlannedMeal], recipes: dict[str, RecipeNote]
) -> list[tuple[str, RecipeNote, int | None]]:
    return [
        (meal.recipe, recipes[meal.path], meal.servings)
        for meal in meals
        if meal.kind == "cook" and meal.recipe and meal.path in recipes
    ]


def _training(settings: Settings, plan: Plan) -> set[int]:
    """The days the plan marks, and the days whose daily note holds a training entry."""
    marked = set(plan.training)
    if plan.monday is None:
        return marked
    for day, _, lines in day_sections(
        settings.vault_path,
        settings.periodic_path,
        plan.monday,
        plan.monday + timedelta(6),
        TRAINING,
    ):
        if any(parse_line(line, number) is not None for number, line in lines):
            marked.add((day - plan.monday).days)
    return marked


async def _protein(
    settings: Settings, meals: list[PlannedMeal], recipes: dict[str, RecipeNote]
) -> dict[int, float]:
    foods_text = _read(settings, f"{settings.config_path}/{FOODS_NOTE}")
    foods = [] if foods_text is None else parse_my_foods(foods_text)
    per: dict[str, float | None] = {}
    for path, recipe in recipes.items():
        counted = await recipe_nutrition(recipe, foods, settings.food_contact)
        per[path] = None if counted.per_serving is None else counted.per_serving.protein
    found: dict[int, float] = {}
    for meal in meals:
        grams = per.get(meal.path) if meal.path else None
        if grams is not None:
            found[meal.day] = found.get(meal.day, 0.0) + grams
    return found


@router.post("/api/meal-plan")
async def read_meal_plan(
    body: PlanText, settings: Annotated[Settings, Depends(get_settings)]
) -> MealPlan:
    """The week's meals, each batch with what is left, training days and their protein.

    Protein counts one serving of each recipe a meal names; meals with no recipe add nothing.
    """
    plan = parse_plan(body.text)
    paths = await asyncio.to_thread(list_markdown_files, settings.vault_path)
    meals, batches = lay_out(plan, paths)
    recipes = await asyncio.to_thread(_recipes, settings, meals)
    training = await asyncio.to_thread(_training, settings, plan)
    protein = await _protein(settings, meals, recipes)
    config = parse_config(_read(settings, f"{settings.config_path}/{CONFIG_NOTE}"))
    goal = config.food.get("protein")
    week = None if plan.monday is None else plan.monday.strftime("%G-W%V")
    return MealPlan(
        week=week,
        fridge_days=plan.fridge_days,
        days=days(plan, training, protein),
        meals=meals,
        batches=batches,
        protein_goal=None if goal is None else ProteinGoal(type=goal.type, value=goal.value),
        ingredients=len(shopping.needs(_cooked(meals, recipes))),
    )


@router.post("/api/meal-plan/shopping")
async def write_shopping(
    body: PlanText, settings: Annotated[Settings, Depends(get_settings)]
) -> ShoppingWritten:
    """Write the ingredients of the week's cooked batches into the shared `Einkauf.md`.

    A food already on an open line for the same recipe is skipped, so a second press adds
    nothing. The list is read and written with its digest, so an edit in between answers 409.
    """
    plan = parse_plan(body.text)
    paths = await asyncio.to_thread(list_markdown_files, settings.vault_path)
    meals, _ = lay_out(plan, paths)
    recipes = await asyncio.to_thread(_recipes, settings, meals)
    path = f"{settings.share_folder}/{SHOPPING_NOTE}"
    note = await agent.read_note(settings, path)
    merged = shopping.merge(
        "" if note is None else note.content, shopping.needs(_cooked(meals, recipes))
    )
    if merged.added or merged.merged:
        saved = await agent.save_note(
            settings, path, merged.text, None if note is None else note.sha
        )
        if saved is None:
            raise HTTPException(status_code=400, detail="The vault will not take that path")
    return ShoppingWritten(
        path=path, added=merged.added, merged=merged.merged, skipped=merged.skipped
    )
