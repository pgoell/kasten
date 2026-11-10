"""Training lines through `GET /api/training`, against the case table and `training-format.md`."""

import json
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from httpx import AsyncClient

CASES = json.loads(
    (Path(__file__).parents[3] / "frontend/src/lib/log/cases/training-cases.json").read_text(
        encoding="utf-8"
    )
)
DAILY = "01 Periodic/00 Daily"
START = date(2026, 1, 1)

WEEK = """---
type: Periodic Note
---

# 2026-11-09 Monday

## Log
- 🏋 [[Kniebeuge]] 80 kg 8

## Training
- 🏋 [[Kniebeuge]] 80 kg 8 7 7 @8
- 🏋 [[Klimmzüge]] bw 6 5 5
- 🏋 [[Plank]] 3x 45 s
- Rücken steif
- 🚶 [[Gehen]] 45 min 4.1 km
- 🏃 [[Joggen]] 32 min 5.0 km ❤ 148
- 🚲 [[Radfahren]] 25 min 8.2 km
- 📏 [[Knie-zur-Wand]] L 11 cm R 9 cm
- 📏 [[Schulter-Rotation]] außen L 95° R 90°, innen L 55° R 45°

```
## Training
- 🏋 [[Kniebeuge]] 200 kg 1
```

## Dump
- 🏋 [[Kniebeuge]] 90 kg 1
"""


def write(vault: Path, name: str, text: str) -> None:
    note = vault / DAILY / name
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


def bare(value: Any) -> Any:
    """`value` with every null field left out, at any depth, as the table writes an entry."""
    if isinstance(value, dict):
        return {key: bare(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [bare(item) for item in value]
    return value


async def test_1715_every_case_of_the_table(client: AsyncClient, vault: Path) -> None:
    days = [START + timedelta(days=index) for index in range(len(CASES))]
    for day, case in zip(days, CASES, strict=True):
        write(vault, f"{day.isoformat()}.md", f"## Training\n{case['line']}\n")

    r = await client.get(
        "/api/training", params={"from": START.isoformat(), "to": days[-1].isoformat()}
    )
    by_date = {day["date"]: day["entries"] for day in r.json()} if r.status_code == 200 else {}

    def first(day: date) -> Any:
        entries = by_date.get(day.isoformat()) or []
        if not entries:
            return None
        entry = bare(entries[0])
        return {key: item for key, item in entry.items() if key not in ("line", "text")}

    actual = {case["id"]: first(day) for day, case in zip(days, CASES, strict=True)}
    expected = {case["id"]: case["entry"] for case in CASES}
    assert {"status": r.status_code, "table": actual} == {"status": 200, "table": expected}


async def test_1715_a_week_with_its_lines_in_order(client: AsyncClient, vault: Path) -> None:
    write(vault, "2026-11-09.md", WEEK)
    write(vault, "2026-11-10.md", "# Tuesday\n\nRest.\n")
    write(vault, "2026-11-11.md", "## Training\n")
    write(vault, "2026-11-17.md", "## Training\n- 🚶 [[Gehen]] 30 min\n")

    r = await client.get("/api/training", params={"from": "2026-11-09", "to": "2026-11-15"})
    days = r.json() if r.status_code == 200 else []

    assert r.status_code == 200
    assert [(day["date"], day["path"]) for day in days] == [
        ("2026-11-09", f"{DAILY}/2026-11-09.md"),
        ("2026-11-11", f"{DAILY}/2026-11-11.md"),
    ]
    monday = days[0]["entries"]
    assert [(entry["line"], entry["kind"], entry["exercise"]) for entry in monday] == [
        (11, "strength", "Kniebeuge"),
        (12, "strength", "Klimmzüge"),
        (13, "strength", "Plank"),
        (15, "walk", "Gehen"),
        (16, "run", "Joggen"),
        (17, "ride", "Radfahren"),
        (18, "test", "Knie-zur-Wand"),
        (19, "test", "Schulter-Rotation"),
    ]
    assert monday[0]["e1rm"] == 101.3
    assert monday[0]["text"] == "- 🏋 [[Kniebeuge]] 80 kg 8 7 7 @8"
    assert days[1]["entries"] == []


async def test_1715_every_field_is_there_null_where_unset(client: AsyncClient, vault: Path) -> None:
    write(vault, "2026-11-09.md", "## Training\n- 🚶 [[Gehen]] 30 min\n")

    r = await client.get("/api/training", params={"from": "2026-11-09", "to": "2026-11-09"})

    assert r.json()[0]["entries"][0] == {
        "line": 2,
        "text": "- 🚶 [[Gehen]] 30 min",
        "kind": "walk",
        "exercise": "Gehen",
        "kg": None,
        "bodyweight": None,
        "reps": None,
        "sets": None,
        "seconds": None,
        "rpe": None,
        "e1rm": None,
        "minutes": 30.0,
        "km": None,
        "heart_rate": None,
        "groups": None,
    }


async def test_1715_bad_ranges(client: AsyncClient) -> None:
    after = await client.get("/api/training", params={"from": "2026-11-10", "to": "2026-11-09"})
    unreal = await client.get("/api/training", params={"from": "2026-02-30", "to": "2026-03-01"})
    shape = await client.get("/api/training", params={"from": "0", "to": "2026-03-01"})

    assert (after.status_code, unreal.status_code, shape.status_code) == (400, 422, 422)


async def test_1715_no_daily_folder_is_an_empty_list(client: AsyncClient) -> None:
    r = await client.get("/api/training", params={"from": "2026-11-09", "to": "2026-11-15"})

    assert (r.status_code, r.json()) == (200, [])
