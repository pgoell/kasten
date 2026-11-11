"""`POST /api/recipe/nutrition` on three hand-written recipes, with foods of your own and OFF.

Open Food Facts answers through `httpx.MockTransport`, from the recorded Nutella product.
"""

from pathlib import Path
from typing import TYPE_CHECKING

import httpx
import pytest

from kasten_backend import food

if TYPE_CHECKING:
    from httpx import AsyncClient

NUTELLA = (Path(__file__).parents[2] / "fixtures" / "off" / "product-nutella.json").read_text(
    encoding="utf-8"
)

FOODS = """---
type: Config
---
- Kidneybohnen: 🔥 100 🥩 7 🍞 12 🧈 0.5
- Zwiebel: 80 g, 🔥 40 🥩 1.2 🍞 8 🧈 0.1
- Tomaten: 🔥 20 🥩 1 🍞 3 🧈 0.2
- Olivenöl: 🔥 880 🥩 0 🍞 0 🧈 100
- Haferflocken: 🔥 370 🥩 13 🍞 59 🧈 7
- Milch: 🔥 64 🥩 3.4 🍞 4.8 🧈 3.5
- Paprika: 150 g, 🔥 30 🥩 1 🍞 6 🧈 0.3
- Feta: 🔥 260 🥩 17 🍞 0.5 🧈 21
- Pesto: 🔥 500 🥩 5 🍞 5 🧈 50
"""

CHILI = """---
type: Recipe
servings: 4
tags: [prep, friert-ein]
---
# Chili sin carne

## Zutaten
- 500 g Kidneybohnen, abgetropft
- 2 Zwiebeln
- 2 Dosen Tomaten (je 400 g), gehackt
- 2 EL Olivenöl
- Salz, nach Belieben
- 1 TL Kreuzkümmel

## Schritte
1. Zwiebeln würfeln und anbraten.
2. Alles 30 Minuten köcheln.
"""

PORRIDGE = """---
type: Recipe
servings: 1
---
# Porridge

## Zutaten
- 60 g Haferflocken
- 200 ml Milch
- 20 g Nutella 🏷 3017624010701
"""

OFENGEMUESE = """---
type: Recipe
servings: 2
---
# Ofengemüse mit Feta

## Zutaten
### Gemüse
- 1 rote Paprika
### Obendrauf
- 200 g Feta
- 1 Glas Pesto
- 1 Glas Nutella 🏷 3017624010701
"""


@pytest.fixture(autouse=True)
def foods_note(vault: Path) -> None:
    config = vault / "99 Misc" / "01 Config"
    config.mkdir(parents=True)
    (config / "foods.md").write_text(FOODS, encoding="utf-8")


@pytest.fixture
def off(monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    """Open Food Facts answering every product read with Nutella, and the reads it got."""
    seen: list[httpx.Request] = []

    def nutella(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=NUTELLA)

    transport = httpx.MockTransport(nutella)
    monkeypatch.setattr(food, "_client", lambda: httpx.AsyncClient(transport=transport))
    food._cache.clear()
    food._reads.clear()
    return seen


async def nutrition(client: AsyncClient, text: str) -> dict:
    response = await client.post("/api/recipe/nutrition", json={"text": text})
    assert response.status_code == 200, response.text
    return response.json()


def statuses(recipe: dict) -> list[tuple[str, str]]:
    return [(item["food"], item["status"]) for item in recipe["ingredients"]]


async def test_chili_counts_per_serving_and_names_what_it_could_not(client: AsyncClient) -> None:
    recipe = await nutrition(client, CHILI)
    assert statuses(recipe) == [
        ("Kidneybohnen", "counted"),
        ("Zwiebeln", "counted"),
        ("Tomaten", "counted"),
        ("Olivenöl", "counted"),
        ("Salz", "no_amount"),
        ("Kreuzkümmel", "no_match"),
    ]
    grams = [item["grams"] for item in recipe["ingredients"]]
    assert grams == [500, 160, 800, 30, None, None]
    assert recipe["ingredients"][1]["match"] == {"source": "mine", "name": "Zwiebel", "code": None}
    assert recipe["total"]["kcal"] == 988
    assert recipe["servings"] == 4
    assert recipe["per_serving"]["kcal"] == 247
    assert recipe["per_serving"]["protein"] == 11.2
    assert recipe["per_serving"]["carbs"] == 24.2
    assert recipe["per_serving"]["fat"] == pytest.approx(8.6, abs=0.06)
    assert recipe["tags"] == ["prep", "friert-ein"]
    assert recipe["steps"] == ["Zwiebeln würfeln und anbraten.", "Alles 30 Minuten köcheln."]


async def test_porridge_reads_a_pinned_barcode_on_open_food_facts(
    client: AsyncClient, off: list[httpx.Request]
) -> None:
    recipe = await nutrition(client, PORRIDGE)
    nutella = recipe["ingredients"][2]
    assert nutella["status"] == "counted"
    assert nutella["food"] == "Nutella"
    assert nutella["match"] == {"source": "off", "name": "Nutella", "code": "3017624010701"}
    assert nutella["nutrients"]["kcal"] == 107.8
    assert recipe["per_serving"]["kcal"] == 457.8
    assert len(off) == 1


async def test_ofengemuese_counts_a_piece_by_its_serving_and_not_a_jar_without_weight(
    client: AsyncClient, off: list[httpx.Request]
) -> None:
    recipe = await nutrition(client, OFENGEMUESE)
    assert statuses(recipe) == [
        ("rote Paprika", "counted"),
        ("Feta", "counted"),
        ("Pesto", "no_weight"),
        ("Nutella", "no_weight"),
    ]
    assert [item["group"] for item in recipe["ingredients"]] == [
        "Gemüse",
        "Obendrauf",
        "Obendrauf",
        "Obendrauf",
    ]
    assert recipe["ingredients"][0]["grams"] == 150
    assert recipe["per_serving"]["kcal"] == 282.5


async def test_a_barcode_open_food_facts_cannot_reach_leaves_the_rest_counted(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def busy(_: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="busy")

    transport = httpx.MockTransport(busy)
    monkeypatch.setattr(food, "_client", lambda: httpx.AsyncClient(transport=transport))
    food._cache.clear()
    recipe = await nutrition(client, PORRIDGE)
    assert [item["status"] for item in recipe["ingredients"]] == [
        "counted",
        "counted",
        "unreached",
    ]
    assert recipe["per_serving"]["kcal"] == 350


async def test_a_recipe_with_no_servings_has_a_total_and_no_per_serving(
    client: AsyncClient,
) -> None:
    recipe = await nutrition(client, "# Toast\n\n## Zutaten\n- 60 g Haferflocken\n")
    assert recipe["servings"] is None
    assert recipe["per_serving"] is None
    assert recipe["total"]["kcal"] == 222


async def test_a_vault_without_foods_matches_nothing(client: AsyncClient, vault: Path) -> None:
    (vault / "99 Misc" / "01 Config" / "foods.md").unlink()
    recipe = await nutrition(client, CHILI)
    assert {item["status"] for item in recipe["ingredients"]} == {"no_match", "no_amount"}
    assert recipe["total"] == {"kcal": None, "protein": None, "carbs": None, "fat": None}


async def test_a_pin_open_food_facts_lacks_is_asked_once_an_hour(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[httpx.Request] = []

    def missing(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(404, text="{}")

    transport = httpx.MockTransport(missing)
    monkeypatch.setattr(food, "_client", lambda: httpx.AsyncClient(transport=transport))
    food._cache.clear()
    food._reads.clear()
    for _ in range(2):
        recipe = await nutrition(client, PORRIDGE)
        assert recipe["ingredients"][2]["status"] == "no_match"
    assert len(seen) == 1
    response = await client.get("/api/food/barcode/3017624010701")
    assert response.status_code == 404
    assert len(seen) == 1
