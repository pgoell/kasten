"""The log config note, read by `kasten_backend.log_config` and through `GET /api/log`.

The row tests run the shared cases in `frontend/src/lib/log-config-cases.json`, the way
`frontend/tests/log-kinds.test.ts` runs them. They import the module inside their
bodies, so on a branch without it they fail for that reason alone and the endpoint
tests at the bottom of the file still reach their own assertions.
"""

import json
from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    from httpx import AsyncClient

CASES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/lib/log-config-cases.json").read_text(
        encoding="utf-8"
    )
)
CONFIG = "99 Misc/01 Config/log.md"
DAILY = "01 Periodic/00 Daily"


def write(vault: Path, relative: str, text: str) -> None:
    """Write `text` at `relative` under the vault, making its folders."""
    note = vault / relative
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8", newline="")


def present(entry: dict[str, Any]) -> dict[str, Any]:
    """An entry without the fields it leaves unset."""
    return {key: value for key, value in entry.items() if value is not None}


def as_row(kind: Any) -> dict[str, Any]:
    """A parsed kind as the shared cases write one: its set fields only."""
    return {key: value for key, value in asdict(kind).items() if value is not None}


@pytest.mark.parametrize("row", CASES["config"], ids=lambda row: row["id"])
def test_769_a1_config_rows(row: dict[str, Any]) -> None:
    from kasten_backend.log_config import parse_config  # noqa: PLC0415

    config = parse_config(row["line"])
    broken = row["kind"] is None and "food" not in row

    assert {
        "kinds": [as_row(kind) for kind in config.kinds],
        "food": {field: asdict(goal) for field, goal in config.food.items()},
        "broken": [{"line": line, "text": text} for line, text in config.broken],
    } == {
        "kinds": [] if row["kind"] is None else [row["kind"]],
        "food": row.get("food", {}),
        "broken": [{"line": 1, "text": row["line"]}] if broken else [],
    }


@pytest.mark.parametrize("row", CASES["lines"], ids=lambda row: row["id"])
def test_769_a1_line_rows(row: dict[str, Any]) -> None:
    from kasten_backend.log_config import parse_config, parse_kind_line  # noqa: PLC0415

    # Over the kinds the row names, so a row whose kind is broken fails on its amounts.
    amounts = [parse_kind_line(kind, row["line"]) for kind in parse_config(row["kind"]).kinds]

    assert amounts == [row["amount"]]


async def test_769_a2_a_tea_line_is_an_entry_and_a_total(client: AsyncClient, vault: Path) -> None:
    write(vault, CONFIG, "- 🍵 tea: 1 cup, min 3\n")
    write(
        vault,
        f"{DAILY}/2026-01-04.md",
        "## Log\n- 🍵 1 cup\n- 🍵 0,5 cup\n- 🍵 1 ml\n- 🍵 cup\n",
    )

    r = await client.get("/api/log", params={"from": "2026-01-04", "to": "2026-01-04"})
    body = (
        [dict(day, entries=[present(entry) for entry in day["entries"]]) for day in r.json()]
        if r.status_code == 200
        else None
    )

    assert {"status": r.status_code, "body": body} == {
        "status": 200,
        "body": [
            {
                "date": "2026-01-04",
                "path": "01 Periodic/00 Daily/2026-01-04.md",
                "entries": [
                    {
                        "line": 2,
                        "text": "- 🍵 1 cup",
                        "kind": "mine",
                        "mark": "🍵",
                        "name": "tea",
                        "amount": 1.0,
                        "unit": "cup",
                    },
                    {
                        "line": 3,
                        "text": "- 🍵 0,5 cup",
                        "kind": "mine",
                        "mark": "🍵",
                        "name": "tea",
                        "amount": 0.5,
                        "unit": "cup",
                    },
                ],
                "totals": {
                    "water": {"ml": 0.0},
                    "coffee": {"count": 0},
                    "alcohol": {"count": 0, "ml": 0.0, "grams": 0.0},
                    "food": {"kcal": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0},
                    "mine": [{"mark": "🍵", "name": "tea", "unit": "cup", "total": 1.5}],
                },
            }
        ],
    }


async def test_769_a3_no_config_note_answers_as_main(client: AsyncClient, vault: Path) -> None:
    # Written out by hand from main's shape: the new keys must not appear at all.
    write(
        vault,
        f"{DAILY}/2026-01-04.md",
        "## Log\n- 💧 500 ml\n- ☕ 2\n- 🍺 1 0.5 l 5%\n- 🍽 lunch: Skyr 250 g 🔥 160 kcal 🥩 27 g\n",
    )

    r = await client.get("/api/log", params={"from": "2026-01-04", "to": "2026-01-04"})

    expected = (
        '[{"date":"2026-01-04","path":"01 Periodic/00 Daily/2026-01-04.md","entries":['
        '{"line":2,"text":"- 💧 500 ml","kind":"water","ml":500.0,"count":null,"abv":null,'
        '"grams":null,"meal":null,"words":null,"kcal":null,"protein":null,"carbs":null,"fat":null},'
        '{"line":3,"text":"- ☕ 2","kind":"coffee","ml":null,"count":2,"abv":null,"grams":null,'
        '"meal":null,"words":null,"kcal":null,"protein":null,"carbs":null,"fat":null},'
        '{"line":4,"text":"- 🍺 1 0.5 l 5%","kind":"alcohol","ml":500.0,"count":1,"abv":5.0,'
        '"grams":19.7,"meal":null,"words":null,"kcal":null,"protein":null,"carbs":null,"fat":null},'
        '{"line":5,"text":"- 🍽 lunch: Skyr 250 g 🔥 160 kcal 🥩 27 g","kind":"food","ml":null,'
        '"count":null,"abv":null,"grams":null,"meal":"lunch","words":"Skyr 250 g","kcal":160.0,'
        '"protein":27.0,"carbs":null,"fat":null}],"totals":{"water":{"ml":500.0},'
        '"coffee":{"count":2},"alcohol":{"count":1,"ml":500.0,"grams":19.7},'
        '"food":{"kcal":160.0,"protein":27.0,"carbs":0.0,"fat":0.0}}}]'
    )
    assert {"status": r.status_code, "bytes": r.content.decode("utf-8")} == {
        "status": 200,
        "bytes": expected,
    }


async def test_769_a2_built_in_kinds_count_whatever_the_config_says(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, CONFIG, "- 🍵 tea: 1 cup, min 3\n")
    write(vault, f"{DAILY}/2026-01-04.md", "## Log\n- ☕ 1\n")

    r = await client.get("/api/log", params={"from": "2026-01-04", "to": "2026-01-04"})
    body = (
        [dict(day, entries=[present(entry) for entry in day["entries"]]) for day in r.json()]
        if r.status_code == 200
        else None
    )

    assert {"status": r.status_code, "body": body} == {
        "status": 200,
        "body": [
            {
                "date": "2026-01-04",
                "path": "01 Periodic/00 Daily/2026-01-04.md",
                "entries": [{"line": 2, "text": "- ☕ 1", "kind": "coffee", "count": 1}],
                "totals": {
                    "water": {"ml": 0.0},
                    "coffee": {"count": 1},
                    "alcohol": {"count": 0, "ml": 0.0, "grams": 0.0},
                    "food": {"kcal": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0},
                    "mine": [{"mark": "🍵", "name": "tea", "unit": "cup", "total": 0.0}],
                },
            }
        ],
    }
