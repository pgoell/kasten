"""`GET /api/recipes`: the recipe notes the food sheet lists, by title, with their numbers."""

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

FOODS = "---\ntype: Config\n---\n- Kidneybohnen: 🔥 100 🥩 7 🍞 12 🧈 0.5\n"


@pytest.fixture(autouse=True)
def notes(vault: Path) -> None:
    config = vault / "99 Misc" / "01 Config"
    config.mkdir(parents=True, exist_ok=True)
    (config / "foods.md").write_text(FOODS, encoding="utf-8")
    recipes = vault / "Rezepte"
    recipes.mkdir()
    (recipes / "chili.md").write_text(
        "---\ntype: Recipe\nservings: 4\n---\n# Chili sin carne\n\n## Zutaten\n"
        "- 400 g Kidneybohnen\n",
        encoding="utf-8",
    )
    (recipes / "Dal.md").write_text(
        "---\ntype: recipe\n# todo: check\n---\nNo heading here.\n\n"
        "## Zutaten\n- 100 g Kidneybohnen\n",
        encoding="utf-8",
    )
    (recipes / "not-a-recipe.md").write_text("---\ntype: Concept\n---\n# Bohnen\n", "utf-8")
    archive = vault / "98 Archive"
    archive.mkdir(exist_ok=True)
    (archive / "old.md").write_text("---\ntype: Recipe\n---\n# Altes Rezept\n", "utf-8")


async def test_recipes_are_listed_by_title_with_their_numbers(client: AsyncClient) -> None:
    response = await client.get("/api/recipes")
    assert response.status_code == 200
    entries = response.json()
    assert [(entry["path"], entry["title"]) for entry in entries] == [
        ("Rezepte/chili.md", "Chili sin carne"),
        ("Rezepte/Dal.md", "Dal"),
    ]
    chili, dal = entries
    assert chili["servings"] == 4
    assert chili["per_serving"] == {"kcal": 100.0, "protein": 7.0, "carbs": 12.0, "fat": 0.5}
    assert dal["per_serving"] is None
    assert dal["total"]["kcal"] == 100.0
