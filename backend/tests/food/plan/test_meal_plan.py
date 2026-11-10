"""`POST /api/meal-plan`: a week plan as the view draws it, batches as bands with servings left."""

from datetime import date
from typing import TYPE_CHECKING

import pytest

from kasten_backend.food.plan.note import parse_plan
from kasten_backend.periodic import daily_path

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

PLAN = """---
type: Meal Plan
week: 2026-W46
---
# Woche 46

- Mo 🏋
- Mo lunch: from [[Chili sin carne]]
- Mo dinner: cook [[Linsen-Dal]] x4 👤 [[Alicia]]
- Di lunch: from [[Chili sin carne]]
- Di dinner: from [[Linsen-Dal]]
- Mi Mittag: aus [[Linsen-Dal|Dal]]
- Do lunch: Kantine
- Do dinner: cook [[Hähnchen-Bowls]] \u00d75 👤 Pascal
- Fr lunch: from [[Hähnchen-Bowls]]
- Fr dinner: Essen gehen
- Sa lunch: from [[Hähnchen-Bowls]]
- Notes on the week, not a meal
"""
FOODS = (
    "---\ntype: Config\n---\n"
    "- Linsen: 🔥 350 🥩 24 🍞 50 🧈 1.5\n- Hähnchen: 🔥 110 🥩 23 🍞 0 🧈 1.5\n"
)
DAL = "---\ntype: Recipe\nservings: 4\n---\n# Linsen-Dal\n\n## Zutaten\n- 400 g Linsen\n"
BOWLS = "---\ntype: Recipe\nservings: 2\n---\n# Bowls\n\n## Zutaten\n- 400 g Hähnchen\n"


@pytest.fixture(autouse=True)
def notes(vault: Path) -> None:
    config = vault / "99 Misc" / "01 Config"
    config.mkdir(parents=True, exist_ok=True)
    (config / "foods.md").write_text(FOODS, encoding="utf-8")
    (config / "log.md").write_text("---\ntype: Config\n---\n- 🍽 food: protein min 120\n", "utf-8")
    recipes = vault / "Rezepte"
    recipes.mkdir()
    (recipes / "Linsen-Dal.md").write_text(DAL, encoding="utf-8")
    (recipes / "Hähnchen-Bowls.md").write_text(BOWLS, encoding="utf-8")
    friday = vault / daily_path(date(2026, 11, 13))
    friday.parent.mkdir(parents=True, exist_ok=True)
    friday.write_text("# Fr\n\n## Training\n- 🏋 [[Kniebeuge]] 80 kg 8 7 7\n", "utf-8")


def test_the_note_reads_its_week_meals_and_training() -> None:
    plan = parse_plan(PLAN)
    assert plan.monday == date(2026, 11, 9)
    assert plan.fridge_days == 2
    assert plan.training == {0}
    assert len(plan.meals) == 10
    dal = plan.meals[1]
    assert (dal.day, dal.slot, dal.kind, dal.target, dal.servings, dal.cook) == (
        0,
        "dinner",
        "cook",
        "Linsen-Dal",
        4,
        "Alicia",
    )
    assert plan.meals[4].target == "Linsen-Dal"
    assert plan.meals[4].slot == "lunch"
    assert plan.meals[6].cook == "Pascal"
    assert plan.meals[5].kind == "other"


def test_a_fridge_limit_and_a_missing_week() -> None:
    plan = parse_plan("---\ntype: Meal Plan\nfridge: 3\n---\n- Mo dinner: cook [[X]]\n")
    assert (plan.monday, plan.fridge_days) == (None, 3)
    assert plan.meals[0].servings is None


async def test_the_bands_match_the_servings(client: AsyncClient) -> None:
    response = await client.post("/api/meal-plan", json={"text": PLAN})
    assert response.status_code == 200
    week = response.json()
    assert week["week"] == "2026-W46"
    chili, dal, bowls = week["batches"]
    assert (chili["state"], chili["eaten"], chili["left"], chili["path"]) == (
        "earlier",
        2,
        None,
        None,
    )
    assert (dal["day"], dal["servings"], dal["eaten"], dal["left"], dal["last_day"]) == (
        0,
        4,
        3,
        1,
        2,
    )
    assert dal["path"] == "Rezepte/Linsen-Dal.md"
    assert dal["cook"] == "Alicia"
    assert (bowls["servings"], bowls["eaten"], bowls["left"]) == (5, 3, 2)


async def test_the_third_day_in_the_fridge_warns(client: AsyncClient) -> None:
    week = (await client.post("/api/meal-plan", json={"text": PLAN})).json()
    by_line = {meal["text"]: meal for meal in week["meals"]}
    assert by_line["from [[Hähnchen-Bowls]]"]["fridge_day"] in (2, 3)
    saturday = next(m for m in week["meals"] if m["day"] == 5)
    assert (saturday["fridge_day"], saturday["freeze"]) == (3, True)
    friday = next(m for m in week["meals"] if m["day"] == 4 and m["slot"] == "lunch")
    assert (friday["fridge_day"], friday["freeze"]) == (2, False)
    kantine = next(m for m in week["meals"] if m["text"] == "Kantine")
    assert (kantine["batch"], kantine["freeze"]) == (None, False)


async def test_training_days_carry_the_plans_protein(client: AsyncClient) -> None:
    week = (await client.post("/api/meal-plan", json={"text": PLAN})).json()
    days = week["days"]
    assert [day["training"] for day in days] == [True, False, False, False, True, False, False]
    assert days[0]["date"] == "2026-11-09"
    # Monday: one serving of dal, 100 g Linsen at 24 g protein per 100 g.
    assert days[0]["protein"] == pytest.approx(24.0)
    # Friday: one serving of bowls, 200 g Hähnchen.
    assert days[4]["protein"] == pytest.approx(46.0)
    assert days[6]["protein"] is None
    assert week["protein_goal"] == {"type": "floor", "value": 120.0}
    assert week["ingredients"] == 2
