"""`GET /share/recipes`: the recipe notes for the Rezepte tab, by name, never by path."""

from typing import TYPE_CHECKING

import pytest

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from httpx import AsyncClient

CHILI = """---
type: Recipe
servings: 4
time: 45 min
source: https://example.org/chili
tags: [prep, vegetarisch]
---
# Chili sin carne

## Zutaten
- 500 g Kidneybohnen, abgetropft
- 2-3 Zwiebeln
- 1 TL Kreuzkümmel 🏷 4337256380081
- Salz

### Zum Servieren
- 150 g Schmand

## Schritte
1. Zwiebeln würfeln.
2. Alles 30 Minuten köcheln.

## Gekocht
- 2026-10-27 gern wieder · mehr Chili
"""
DAL = "---\ntype: recipe\n---\n## Zutaten\n- 250 g Linsen\n"
PLAN = """---
type: Meal Plan
week: 2026-W46
---
- Mo dinner: cook [[Chili]] x4
- Di dinner: from [[Chili|das Chili]]
- Mi dinner: cook [[Notizen]]
- Do dinner: Pizza
"""


@pytest.fixture(autouse=True)
def notes(vault: Path) -> None:
    for folder in ("05 Shared", "Rezepte/Suppen", "02 Projects", "98 Archive"):
        (vault / folder).mkdir(parents=True)
    (vault / "Rezepte" / "Chili.md").write_text(CHILI, encoding="utf-8")
    (vault / "Rezepte" / "Suppen" / "Dal.md").write_text(DAL, encoding="utf-8")
    (vault / "02 Projects" / "Notizen.md").write_text("# Geheim\n", encoding="utf-8")
    (vault / "98 Archive" / "Alt.md").write_text(DAL, encoding="utf-8")
    (vault / "05 Shared" / "Woche 46.md").write_text(PLAN, encoding="utf-8")


async def test_the_list_holds_every_recipe_by_title_and_name_without_a_path(
    client: AsyncClient,
) -> None:
    response = await client.get("/share/recipes")

    assert response.status_code == 200
    assert response.json() == [
        {
            "name": "Chili",
            "title": "Chili sin carne",
            "servings": 4,
            "time": "45 min",
            "tags": ["prep", "vegetarisch"],
        },
        {"name": "Dal", "title": "Dal", "servings": None, "time": None, "tags": []},
    ]


async def test_a_recipe_reads_to_cook_from_without_its_pin_or_meals_cooked(
    client: AsyncClient,
) -> None:
    response = await client.get("/share/recipes/chili")

    assert response.status_code == 200
    recipe = response.json()
    assert recipe["name"] == "Chili"
    assert recipe["source"] == "https://example.org/chili"
    assert recipe["steps"] == ["Zwiebeln würfeln.", "Alles 30 Minuten köcheln."]
    assert "cooked" not in recipe
    assert [line["text"] for line in recipe["ingredients"]] == [
        "500 g Kidneybohnen, abgetropft",
        "2-3 Zwiebeln",
        "1 TL Kreuzkümmel",
        "Salz",
        "150 g Schmand",
    ]
    onions, salt, cream = (recipe["ingredients"][n] for n in (1, 3, 4))
    assert (onions["quantity"], onions["quantity_to"], onions["rest"]) == (2, 3, "Zwiebeln")
    assert salt["quantity"] is None
    assert cream["group"] == "Zum Servieren"


@pytest.mark.parametrize(
    "name",
    ["Notizen", "Woche 46", "Alt", "Nichts", "..%2F02 Projects%2FNotizen", "Rezepte%2FChili"],
)
async def test_a_name_that_reaches_no_recipe_answers_404(name: str, client: AsyncClient) -> None:
    response = await client.get(f"/share/recipes/{name}")

    assert response.status_code == 404


async def test_a_planned_meal_names_its_recipe_and_a_note_that_is_none_names_nothing(
    client: AsyncClient,
) -> None:
    days = (await client.get("/share/meals", params={"today": "2026-11-09"})).json()

    assert [meal["recipe"] for day in days for meal in day["meals"]] == [
        "Chili",
        "Chili",
        None,
        None,
    ]


@pytest.fixture
def share_host(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    monkeypatch.setenv("KASTEN_SHARE_HOST", "liste.example")
    get_settings.cache_clear()

    yield "liste.example"

    get_settings.cache_clear()


async def test_the_share_host_reaches_the_recipes(client: AsyncClient, share_host: str) -> None:
    listed = await client.get("/share/recipes", headers={"Host": share_host})
    one = await client.get("/share/recipes/Dal", headers={"Host": share_host})

    assert listed.status_code == 200
    assert one.json()["ingredients"][0]["rest"] == "g Linsen"
