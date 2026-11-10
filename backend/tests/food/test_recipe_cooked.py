"""The lines under a recipe note's `## Gekocht`: the day, the answer to "wieder kochen?", a note."""

import pytest

from kasten_backend.food.recipes.note import parse_recipe

HEAD = "---\ntype: Recipe\nservings: 4\n---\n# Chili\n\n## Gekocht\n"


@pytest.mark.parametrize(
    ("line", "read"),
    [
        (
            "- 2026-11-09 gern wieder · mehr Würze, Beilage anders",
            ("2026-11-09", "gern wieder", "mehr Würze, Beilage anders"),
        ),
        ("- 2026-10-27 Geht so", ("2026-10-27", "geht so", None)),
        ("- 2026-10-27 LIEBER NICHT·zu trocken", ("2026-10-27", "lieber nicht", "zu trocken")),
        ("- 2026-10-02 · mit Limette", ("2026-10-02", None, "mit Limette")),
        ("- 2026-10-02 mit Limette", ("2026-10-02", None, "mit Limette")),
        ("- 2026-10-01 lieber nichts mehr", ("2026-10-01", None, "lieber nichts mehr")),
        ("* 2026-10-01", ("2026-10-01", None, None)),
    ],
)
def test_a_cooked_line_is_read(line: str, read: tuple[str, str | None, str | None]) -> None:
    [cooked] = parse_recipe(HEAD + line + "\n").cooked
    assert (cooked.date, cooked.verdict, cooked.note) == read
    assert cooked.line == HEAD.count("\n") + 1


@pytest.mark.parametrize(
    "line",
    ["- 2026-02-30 gern wieder", "- gestern gern wieder", "2026-10-01 gern wieder", "- 26-10-01"],
)
def test_a_line_without_a_real_day_is_passed_over(line: str) -> None:
    assert parse_recipe(HEAD + line + "\n").cooked == []


def test_cooked_lines_belong_to_their_section_alone() -> None:
    note = (
        HEAD
        + "- 2026-11-09 gern wieder\n\n## Zutaten\n- 2026-11-10 Bohnen\n\n## Cooked\n"
        + "- 2026-11-12 geht so\n```\n- 2026-11-13 gern wieder\n```\n"
    )
    assert [cooked.date for cooked in parse_recipe(note).cooked] == ["2026-11-09", "2026-11-12"]
