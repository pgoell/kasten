"""A plan's meals laid out as the week view draws them: batches as bands, days with training.

Pure, given the plan and the vault's paths; the route reads the notes and fills in protein.
"""

from datetime import timedelta
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel

from kasten_backend.food.plan.note import (  # noqa: TC001  pydantic reads them at runtime
    Kind,
    Slot,
)
from kasten_backend.links import link_path

if TYPE_CHECKING:
    from kasten_backend.food.plan.note import Meal, Plan

SLOT_ORDER: dict[Slot, int] = {"lunch": 0, "dinner": 1}


class PlannedMeal(BaseModel):
    """One meal of the week, with the recipe note it names and the batch it eats from."""

    line: int
    day: int
    """0 for Monday through 6 for Sunday."""
    slot: Slot
    kind: Kind
    text: str
    recipe: str | None
    """The link's name as the plan writes it."""
    path: str | None
    """The recipe note's vault path, or null when no note answers to the link."""
    servings: int | None
    cook: str | None
    batch: int | None
    """The index into `batches` of the batch this meal cooks or eats from."""
    fridge_day: int | None
    """1 on the day a batch is cooked, 2 the day after, and so on."""
    freeze: bool
    """The meal is on or past the plan's fridge limit: freeze it, or eat it sooner."""


class Batch(BaseModel):
    """A dish cooked once and eaten over several meals, as a band down the days."""

    recipe: str
    path: str | None
    day: int | None
    """The day it is cooked, or null for a batch cooked before this week."""
    slot: Slot | None
    servings: int | None
    first_day: int
    """Where its band starts: the day it is cooked, or for an earlier one its first meal."""
    eaten: int
    """Meals that take a serving from it, the cooking meal included."""
    left: int | None
    """Servings left after the week, negative when the plan draws more than it makes."""
    last_day: int
    cook: str | None
    state: Literal["cooked", "earlier"]


class PlanDay(BaseModel):
    """One day of the week: its date, whether it is a training day, and the plan's protein."""

    day: int
    date: str | None
    training: bool
    protein: float | None
    """Grams from one serving of each recipe the day's meals name, or null for none."""


def _order(meal: Meal) -> int:
    return meal.day * 2 + SLOT_ORDER[meal.slot]


def _batch_for(batches: list[Batch], meal: Meal, path: str | None) -> int | None:
    """The latest batch of the same recipe cooked before `meal`, or None."""
    want = path or (meal.target or "").lower()
    found = None
    for index, batch in enumerate(batches):
        if (batch.path or batch.recipe.lower()) != want:
            continue
        if batch.day is None or batch.slot is None:
            found = index if found is None else found
        elif batch.day * 2 + SLOT_ORDER[batch.slot] < _order(meal):
            found = index
    return found


def lay_out(plan: Plan, paths: list[str]) -> tuple[list[PlannedMeal], list[Batch]]:
    """The meals in week order, each tied to its batch, and the batches with what is left."""
    batches: list[Batch] = []
    meals: list[PlannedMeal] = []
    for meal in sorted(plan.meals, key=_order):
        path = None
        if meal.target is not None:
            named = link_path(meal.target, paths)
            path = named if named in paths else None
        batch: int | None = None
        if meal.kind == "cook" and meal.target is not None:
            batches.append(
                Batch(
                    recipe=meal.target,
                    path=path,
                    day=meal.day,
                    slot=meal.slot,
                    servings=meal.servings,
                    first_day=meal.day,
                    eaten=0,
                    left=None,
                    last_day=meal.day,
                    cook=meal.cook,
                    state="cooked",
                )
            )
            batch = len(batches) - 1
        elif meal.kind == "from" and meal.target is not None:
            batch = _batch_for(batches, meal, path)
            if batch is None:
                batches.append(
                    Batch(
                        recipe=meal.target,
                        path=path,
                        day=None,
                        slot=None,
                        servings=None,
                        first_day=meal.day,
                        eaten=0,
                        left=None,
                        last_day=meal.day,
                        cook=None,
                        state="earlier",
                    )
                )
                batch = len(batches) - 1
        fridge_day = None
        freeze = False
        if batch is not None:
            held = batches[batch]
            held.eaten += 1
            held.last_day = max(held.last_day, meal.day)
            if held.day is not None:
                fridge_day = meal.day - held.day + 1
                freeze = meal.day - held.day >= plan.fridge_days
        meals.append(
            PlannedMeal(
                line=meal.line,
                day=meal.day,
                slot=meal.slot,
                kind=meal.kind,
                text=meal.text,
                recipe=meal.target,
                path=path,
                servings=meal.servings,
                cook=meal.cook,
                batch=batch,
                fridge_day=fridge_day,
                freeze=freeze,
            )
        )
    for held in batches:
        held.left = None if held.servings is None else held.servings - held.eaten
    return meals, batches


def days(plan: Plan, training: set[int], protein: dict[int, float]) -> list[PlanDay]:
    """The seven days, Monday first."""
    return [
        PlanDay(
            day=day,
            date=None if plan.monday is None else (plan.monday + timedelta(day)).isoformat(),
            training=day in training,
            protein=protein.get(day),
        )
        for day in range(7)
    ]
