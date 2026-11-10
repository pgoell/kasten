"""`POST /api/meal-plan/shopping`: the week's cooked batches into the shared `Einkauf.md`."""

from typing import TYPE_CHECKING

import pytest

from kasten_backend.food.plan import shopping
from kasten_backend.food.recipes.note import parse_recipe

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

CHILI = """---
type: Recipe
servings: 4
---
# Chili sin carne

## Zutaten
- 500 g Kidneybohnen, abgetropft
- 2 Zwiebeln
- 2 Dosen Tomaten (je 400 g), gehackt
- 1 TL Kreuzkümmel 🏷 4337256380081
- Salz, nach Belieben
"""
DAL = """---
type: Recipe
servings: 4
---
# Linsen-Dal

## Zutaten
- 250 g rote Linsen
- 1 Zwiebeln
- 400 ml Kokosmilch
"""
PLAN = """---
type: Meal Plan
week: 2026-W46
---
- Mo dinner: cook [[Chili sin carne]] x6
- Di dinner: cook [[Linsen-Dal]] x4
- Mi lunch: from [[Chili sin carne]]
"""
EINKAUF = """---
type: Checklist
---
- [x] 2 Zwiebeln ([[Chili sin carne]])
- [ ] 1 Zwiebeln 👤 [[Alicia]]
- [ ] Milch
"""


def test_needs_are_scaled_and_summed_by_food_and_unit() -> None:
    needs = shopping.needs(
        [("Chili sin carne", parse_recipe(CHILI), 6), ("Linsen-Dal", parse_recipe(DAL), 4)]
    )
    by_food = {need.food: need for need in needs}
    assert by_food["Kidneybohnen"].shares == {"Chili sin carne": 750.0}
    assert by_food["Zwiebeln"].shares == {"Chili sin carne": 3.0, "Linsen-Dal": 1.0}
    assert by_food["Tomaten"].words == "Dosen Tomaten (je 400 g)"
    assert by_food["Salz"].quantity(["Chili sin carne"]) is None
    assert [shopping.aisle(by_food[f]) for f in ("Zwiebeln", "Tomaten", "Kokosmilch")] == [
        "Obst & Gemüse",
        "Vorrat",
        "Vorrat",
    ]


def test_quantities_are_written_the_german_way() -> None:
    assert [shopping.shown(q) for q in (750.0, 1.5, 0.333, 12.4)] == ["750", "1,5", "0,33", "12"]


def test_a_merge_tops_up_open_lines_and_files_new_ones_by_aisle() -> None:
    needs = shopping.needs(
        [("Chili sin carne", parse_recipe(CHILI), 6), ("Linsen-Dal", parse_recipe(DAL), 4)]
    )
    merged = shopping.merge(EINKAUF, needs)
    assert merged.text == (
        "---\ntype: Checklist\n---\n"
        "- [x] 2 Zwiebeln ([[Chili sin carne]])\n"
        "- [ ] 5 Zwiebeln ([[Chili sin carne]], [[Linsen-Dal]]) 👤 [[Alicia]]\n"
        "- [ ] Milch\n"
        "\n## Vorrat\n"
        "- [ ] 750 g Kidneybohnen ([[Chili sin carne]])\n"
        "- [ ] 3 Dosen Tomaten (je 400 g) ([[Chili sin carne]])\n"
        "- [ ] 250 g rote Linsen ([[Linsen-Dal]])\n"
        "- [ ] 400 ml Kokosmilch ([[Linsen-Dal]])\n"
        "\n## Gewürze & Öl\n"
        "- [ ] 1,5 TL Kreuzkümmel ([[Chili sin carne]])\n"
        "- [ ] Salz ([[Chili sin carne]])\n"
    )
    assert (merged.added, merged.merged, merged.skipped) == (6, 1, 0)


def test_a_second_merge_adds_nothing() -> None:
    needs = shopping.needs([("Linsen-Dal", parse_recipe(DAL), 4)])
    once = shopping.merge("", needs)
    twice = shopping.merge(once.text, needs)
    assert twice.text == once.text
    assert (twice.added, twice.merged, twice.skipped) == (0, 0, 3)


@pytest.fixture
def notes(vault: Path) -> Path:
    recipes = vault / "Rezepte"
    recipes.mkdir()
    (recipes / "Chili sin carne.md").write_text(CHILI, encoding="utf-8")
    (recipes / "Linsen-Dal.md").write_text(DAL, encoding="utf-8")
    shared = vault / "05 Shared"
    shared.mkdir()
    (shared / "Einkauf.md").write_text(EINKAUF, encoding="utf-8")
    return shared / "Einkauf.md"


async def test_the_button_writes_einkauf(client: AsyncClient, notes: Path) -> None:
    response = await client.post("/api/meal-plan/shopping", json={"text": PLAN})
    assert response.status_code == 200
    assert response.json() == {
        "path": "05 Shared/Einkauf.md",
        "added": 6,
        "merged": 1,
        "skipped": 0,
    }
    text = notes.read_text(encoding="utf-8")  # noqa: ASYNC240
    assert "- [ ] 750 g Kidneybohnen ([[Chili sin carne]])" in text
    assert "- [x] 2 Zwiebeln ([[Chili sin carne]])" in text
    again = await client.post("/api/meal-plan/shopping", json={"text": PLAN})
    assert again.json()["added"] == 0
    assert notes.read_text(encoding="utf-8") == text  # noqa: ASYNC240
