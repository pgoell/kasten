"""The German ingredient line parser against its table of cases, and the recipe note's parts."""

import json
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path

import pytest

from kasten_backend.food.plan import shopping
from kasten_backend.food.recipes import note, parse_amount, route
from kasten_backend.food.recipes.foods import parse_my_food
from kasten_backend.food.recipes.note import parse_recipe

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


FOODS = json.loads((Path(__file__).parent.parent / "foods_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", FOODS, ids=[case["line"] for case in FOODS])
def test_foods_note_line(case: dict) -> None:
    """The same rows run in `frontend/tests/my-foods.test.ts`, so the two readers agree."""
    found = parse_my_food(case["line"])
    want = case["food"]
    assert (None if found is None else asdict(found)) == want


# A heading text, 40,000 blanks, then `x` or `\r`: linear time (#1905).
_LONG = "a' + ' ' * 40_000 + '"


@pytest.mark.parametrize(
    "call",
    [
        f"note.SECTION.fullmatch('## {_LONG}x')",
        f"note.SECTION.fullmatch('## {_LONG}\\r')",
        f"note.GROUP.fullmatch('### {_LONG}x')",
        f"note.COOKED_LINE.fullmatch('- 2026-01-01 {_LONG}x')",
        f"route.TITLE.search('# {_LONG}x')",
        f"shopping.HEADING.fullmatch('# {_LONG}x')",
    ],
    ids=["section", "section-cr", "group", "cooked", "title", "shopping-heading"],
)
def test_1905_a_heading_before_a_long_blank_run_reads_in_linear_time(call: str) -> None:
    # A child process, since `re` cannot be stopped from inside; the bound sits far under main's.
    code = (
        "import time; from kasten_backend.food.recipes import note, route;"
        " from kasten_backend.food.plan import shopping; start = time.perf_counter();"
        f" {call}; print(time.perf_counter() - start)"
    )

    done = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code], check=True, timeout=60, capture_output=True, text=True
    )

    assert float(done.stdout) < 1


# The fix moves no match on a normal line, and blanks-only text is its first blank.
@pytest.mark.parametrize(
    ("pattern", "line", "found"),
    [
        ("SECTION", "## Zutaten", ("Zutaten",)),
        ("SECTION", "## Zutaten \t ", ("Zutaten",)),
        ("SECTION", "## Zu\ttaten\t", ("Zu\ttaten",)),
        ("SECTION", "## Zutaten  \r", ("Zutaten  \r",)),
        ("SECTION", "##  \t ", (" ",)),
        ("SECTION", "## \t ", ("\t",)),
        ("SECTION", "## ", None),
        ("GROUP", "### Teig  ", ("Teig",)),
        ("GROUP", "###   ", (" ",)),
        (
            "COOKED_LINE",
            "- 2026-11-09 gern wieder · mehr Würze  ",
            ("2026-11-09", "gern wieder · mehr Würze"),
        ),
        ("COOKED_LINE", "- 2026-11-09 \t ", ("2026-11-09", "")),
        ("COOKED_LINE", "- 2026-11-09", ("2026-11-09", "")),
        ("HEADING", "## Obst & Gemüse", ("Obst & Gemüse",)),
        ("HEADING", "## Obst \t\r", ("Obst",)),
        ("HEADING", "## Obst\r \t", ("Obst\r",)),
        ("HEADING", "#  \t\r", (" ",)),
        ("HEADING", "# \r", ("\r",)),
        ("HEADING", "####### Obst", None),
    ],
)
def test_1905_a_heading_reads_as_on_main(
    pattern: str, line: str, found: tuple[str, ...] | None
) -> None:
    module = shopping if pattern == "HEADING" else note
    match = getattr(module, pattern).fullmatch(line)

    assert (match and match.groups()) == found


@pytest.mark.parametrize(
    ("text", "title"),
    [
        ("# Chili  \t\n\nbody", "Chili"),
        ("# Chili \r\nbody", "Chili \r"),
        ("#   \nbody", " "),
        ("intro\n# Chili", "Chili"),
    ],
)
def test_1905_a_recipe_title_reads_as_on_main(text: str, title: str) -> None:
    found = route.TITLE.search(text)

    assert found is not None
    assert found[1] == title
