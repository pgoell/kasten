"""`GET /share/meals`: the week plans' meals for the lists app's Essen tab, from today on."""

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

THIS_WEEK = """---
type: Meal Plan
week: 2026-W46
---
- Mo 🏋
- Mo dinner: cook [[Linsen-Dal]] x4 👤 [[Alicia]]
- Di dinner: from [[Linsen-Dal|Dal]]
- Di lunch: from [[Chili sin carne]]
- Do lunch: Essen bei [[Mama]] 👤 Pascal
"""
NEXT_WEEK = """---
type: meal plan
week: 2026-W47
---
- Mo lunch: from [[Hähnchen-Bowls]]
- Di lunch: Kantine
"""


@pytest.fixture(autouse=True)
def plans(vault: Path) -> None:
    shared = vault / "05 Shared"
    shared.mkdir()
    (shared / "Woche 46.md").write_text(THIS_WEEK, encoding="utf-8")
    (shared / "Woche 47.md").write_text(NEXT_WEEK, encoding="utf-8")
    (shared / "Einkauf.md").write_text("- [ ] Mo dinner: cook [[X]] x2\n", encoding="utf-8")


async def test_meals_from_today_for_a_week_across_plans(client: AsyncClient) -> None:
    response = await client.get("/share/meals", params={"today": "2026-11-10"})
    assert response.status_code == 200
    days = response.json()
    assert [day["date"] for day in days] == ["2026-11-10", "2026-11-12", "2026-11-16"]
    tuesday, thursday, monday = days
    assert tuesday["meals"] == [
        {
            "slot": "lunch",
            "kind": "from",
            "dish": "Chili sin carne",
            "servings": None,
            "cook": None,
        },
        {"slot": "dinner", "kind": "from", "dish": "Linsen-Dal", "servings": None, "cook": None},
    ]
    assert thursday["meals"][0]["dish"] == "Essen bei Mama"
    assert thursday["meals"][0]["cook"] == "Pascal"
    assert monday["meals"][0]["dish"] == "Hähnchen-Bowls"


async def test_a_cooked_meal_carries_its_servings_and_cook(client: AsyncClient) -> None:
    days = (await client.get("/share/meals", params={"today": "2026-11-09"})).json()
    assert days[0]["date"] == "2026-11-09"
    assert days[0]["meals"] == [
        {"slot": "dinner", "kind": "cook", "dish": "Linsen-Dal", "servings": 4, "cook": "Alicia"}
    ]
    assert all(day["date"] <= "2026-11-15" for day in days)
