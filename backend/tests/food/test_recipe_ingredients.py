"""The German ingredient line parser against its table of cases, and the recipe note's parts."""

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from kasten_backend.recipes import parse_amount
from kasten_backend.recipes.foods import parse_my_food
from kasten_backend.recipes.note import parse_recipe

CASES = json.loads((Path(__file__).parent / "ingredient_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["line"] for case in CASES])
def test_ingredient_line(case: dict) -> None:
    amount = parse_amount(case["line"])
    assert amount.quantity == pytest.approx(case["quantity"])
    assert amount.unit == case["unit"]
    assert amount.grams_per_unit == pytest.approx(case["grams_per_unit"])
    assert amount.food == case["food"]
    assert amount.note == case["note"]
    assert amount.rest == case.get("rest", amount.rest)
    assert amount.quantity_to == pytest.approx(case.get("quantity_to"))


NOTE = """---
type: Recipe
servings: 4
time: 45 min
source: https://example.org/chili
tags: [prep, friert-ein]
---
# Chili sin carne

## Zutaten
- 500 g Kidneybohnen, abgetropft
- [x] 2 Zwiebeln

### Sauce
* 2 Dosen Tomaten (je 400 g)

```
- 1 kg Zucker
```

## Schritte
1. Zwiebeln würfeln.
2) Alles kochen.

## Notizen
- 3 EL nicht gezählt
"""


def test_a_recipe_note_has_its_fields_lines_groups_and_steps() -> None:
    recipe = parse_recipe(NOTE)
    assert recipe.servings == 4
    assert recipe.time == "45 min"
    assert recipe.source == "https://example.org/chili"
    assert recipe.tags == ["prep", "friert-ein"]
    assert [(i.line, i.text, i.group) for i in recipe.ingredients] == [
        (11, "500 g Kidneybohnen, abgetropft", None),
        (12, "2 Zwiebeln", None),
        (15, "2 Dosen Tomaten (je 400 g)", "Sauce"),
    ]
    assert recipe.steps == ["Zwiebeln würfeln.", "Alles kochen."]


@pytest.mark.parametrize("value", ["0", "-2", "vier", "", "4000"])
def test_servings_that_are_no_number_above_zero_are_none(value: str) -> None:
    assert parse_recipe(f"---\nservings: {value}\n---\n").servings is None


FOODS = json.loads((Path(__file__).parent / "foods_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", FOODS, ids=[case["line"] for case in FOODS])
def test_foods_note_line(case: dict) -> None:
    """The same rows run in `frontend/tests/my-foods.test.ts`, so the two readers agree."""
    found = parse_my_food(case["line"])
    want = case["food"]
    assert (None if found is None else asdict(found)) == want
