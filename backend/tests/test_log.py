"""The day's log through `GET /api/log`, against the case table and `log-format.md`.

Every test goes through the endpoint, never the module, so each one fails on a
branch without the route for a reason of its own: a 404, or an assertion reached.
"""

import json
from datetime import date, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend.vault import read_note

if TYPE_CHECKING:
    from httpx import AsyncClient

CASES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/lib/log/log-cases.json").read_text(encoding="utf-8")
)
DAY_CASES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/lib/log/log-config-cases.json").read_text(
        encoding="utf-8"
    )
)["days"]
DAILY = "01 Periodic/00 Daily"
CONFIG = "99 Misc/01 Config/log.md"
START = date(2026, 1, 1)


def write(vault: Path, name: str, text: str | bytes) -> None:
    """Write a daily note with `text` as given, so a CRLF in it stays a CRLF."""
    note = vault / DAILY / name
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_bytes(text if isinstance(text, bytes) else text.encode("utf-8"))


def write_config(vault: Path, text: str) -> None:
    """Write the config note the endpoint reads for the kinds of your own."""
    note = vault / CONFIG
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


def snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    """Every file under `root` with its bytes and its modification time."""
    return {
        str(path): (path.read_bytes(), path.stat().st_mtime_ns)
        for path in root.rglob("*")
        if path.is_file()
    }


def present(entry: dict[str, Any]) -> dict[str, Any]:
    """An entry without the fields it leaves unset."""
    return {key: value for key, value in entry.items() if value is not None}


def bare(entry: dict[str, Any]) -> dict[str, Any]:
    """An entry as the table writes one: no line, no text, no unset field."""
    return {key: value for key, value in present(entry).items() if key not in ("line", "text")}


def first_entry(day: dict[str, Any] | None) -> dict[str, Any] | None:
    """The one entry of a day, bare, or None where the day is absent or holds none."""
    if day is None or not day["entries"]:
        return None
    return bare(day["entries"][0])


async def test_619_a1_a5_every_case_of_the_table(client: AsyncClient, vault: Path) -> None:
    days = [START + timedelta(days=index) for index in range(len(CASES))]
    for day, case in zip(days, CASES, strict=True):
        write(vault, f"{day.isoformat()}.md", f"## Log\n{case['line']}\n")

    r = await client.get("/api/log", params={"from": START.isoformat(), "to": days[-1].isoformat()})
    by_date = {day["date"]: day for day in r.json()} if r.status_code == 200 else {}

    actual = {
        case["id"]: first_entry(by_date.get(day.isoformat()))
        for day, case in zip(days, CASES, strict=True)
    }
    expected = {case["id"]: case["entry"] for case in CASES}
    assert {"status": r.status_code, "table": actual} == {"status": 200, "table": expected}


async def test_619_a7_days_in_range_with_entries_and_totals(
    client: AsyncClient, vault: Path
) -> None:
    write(
        vault,
        "2026-01-04.md",
        "## Log\n- 💧 500 ml\n- ☕ 2\n- 🍺 1 0.5 l 5%\n- 🍺 2\n"
        "- 🍽 lunch: Skyr 250 g 🔥 160 kcal 🥩 27 g\n- 🍽 Apple 🔥 52 kcal\n",
    )
    write(vault, "2026-01-05.md", "# Tuesday\n\nNo log here.\n")
    write(vault, "2026-01-07.md", "## Log\n- ☕ 1\n")

    r = await client.get("/api/log", params={"from": "2026-01-04", "to": "2026-01-06"})
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
                    {"line": 2, "text": "- 💧 500 ml", "kind": "water", "ml": 500.0},
                    {"line": 3, "text": "- ☕ 2", "kind": "coffee", "count": 2},
                    {
                        "line": 4,
                        "text": "- 🍺 1 0.5 l 5%",
                        "kind": "alcohol",
                        "count": 1,
                        "ml": 500.0,
                        "abv": 5.0,
                        "grams": 19.7,
                    },
                    {"line": 5, "text": "- 🍺 2", "kind": "alcohol", "count": 2},
                    {
                        "line": 6,
                        "text": "- 🍽 lunch: Skyr 250 g 🔥 160 kcal 🥩 27 g",
                        "kind": "food",
                        "meal": "lunch",
                        "words": "Skyr 250 g",
                        "kcal": 160.0,
                        "protein": 27.0,
                    },
                    {
                        "line": 7,
                        "text": "- 🍽 Apple 🔥 52 kcal",
                        "kind": "food",
                        "words": "Apple",
                        "kcal": 52.0,
                    },
                ],
                "totals": {
                    "water": {"ml": 500.0},
                    "coffee": {"count": 2},
                    "alcohol": {"count": 3, "ml": 500.0, "grams": 19.7},
                    "food": {"kcal": 212.0, "protein": 27.0, "carbs": 0.0, "fat": 0.0},
                },
            }
        ],
    }


async def test_619_i1_only_lines_under_log_count(client: AsyncClient, vault: Path) -> None:
    write(
        vault,
        "2026-01-10.md",
        "## TODOs\n- 💧 500 ml\n## Log\n- ☕ 1\n### Sub\n- 💧 250 ml\n```\n- 🍺 1\n## Log\n"
        "- 🍺 3\n```\n- ☕ 2\n## Dump\n- 💧 900 ml\n## Notes\n```\n## Log\n```\n- 💧 700 ml\n",
    )

    r = await client.get("/api/log", params={"from": "2026-01-10", "to": "2026-01-10"})
    entries = (
        [present(entry) for entry in r.json()[0]["entries"]]
        if r.status_code == 200 and r.json()
        else None
    )

    assert {"status": r.status_code, "entries": entries} == {
        "status": 200,
        "entries": [
            {"line": 4, "text": "- ☕ 1", "kind": "coffee", "count": 1},
            {"line": 6, "text": "- 💧 250 ml", "kind": "water", "ml": 250.0},
            {"line": 12, "text": "- ☕ 2", "kind": "coffee", "count": 2},
        ],
    }


async def test_619_i2_log_without_entries_is_zero_day(client: AsyncClient, vault: Path) -> None:
    write(vault, "2026-01-03.md", "## Log\n- a plain bullet\n")

    r = await client.get("/api/log", params={"from": "2026-01-03", "to": "2026-01-03"})
    body = r.json() if r.status_code == 200 else None

    assert {"status": r.status_code, "body": body} == {
        "status": 200,
        "body": [
            {
                "date": "2026-01-03",
                "path": "01 Periodic/00 Daily/2026-01-03.md",
                "entries": [],
                "totals": {
                    "water": {"ml": 0.0},
                    "coffee": {"count": 0},
                    "alcohol": {"count": 0, "ml": 0.0, "grams": 0.0},
                    "food": {"kcal": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0},
                },
            }
        ],
    }


async def test_619_i4_a_number_is_no_date(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/log", params={"from": "0", "to": "2026-12-31"})

    assert {"status": r.status_code} == {"status": 422}


async def test_619_i4_a_day_that_does_not_exist_is_422(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/log", params={"from": "2026-02-30", "to": "2026-03-01"})

    assert {"status": r.status_code} == {"status": 422}


async def test_619_i4_from_after_to_is_400(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/log", params={"from": "2026-01-05", "to": "2026-01-04"})

    assert {"status": r.status_code} == {"status": 400}


async def test_619_i4_malformed_date_is_422(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/log", params={"from": "not-a-date", "to": "2026-01-04"})

    assert {"status": r.status_code} == {"status": 422}


async def test_619_i5_other_files_in_daily_folder_are_not_read(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "notes.md", "## Log\n- ☕ 1\n")
    write(vault, "2026-01-01 copy.md", "## Log\n- ☕ 1\n")

    r = await client.get("/api/log", params={"from": "2026-01-01", "to": "2026-01-01"})
    body = r.json() if r.status_code == 200 else None

    assert {"status": r.status_code, "body": body} == {"status": 200, "body": []}


async def test_619_i5_a_wide_range_reads_only_the_notes_there(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "2026-10-20.md", "## Log\n- ☕ 1\n")
    write(vault, "2026-02-30.md", "## Log\n- ☕ 1\n")

    r = await client.get("/api/log", params={"from": "0001-01-01", "to": "9999-12-31"})
    dates = [day["date"] for day in r.json()] if r.status_code == 200 else None

    assert {"status": r.status_code, "dates": dates} == {
        "status": 200,
        "dates": ["2026-10-20"],
    }


async def test_619_b_a_note_not_utf8_is_skipped(client: AsyncClient, vault: Path) -> None:
    write(vault, "2026-01-01.md", "## Log\n- ☕ 1\n")
    write(vault, "2026-01-02.md", b"\xff## Log\n- \xe2\x98\x95 2\n")

    r = await client.get("/api/log", params={"from": "2026-01-01", "to": "2026-01-02"})
    dates = [day["date"] for day in r.json()] if r.status_code == 200 else None

    assert {"status": r.status_code, "dates": dates} == {"status": 200, "dates": ["2026-01-01"]}


async def test_619_i6_a_fence_in_the_frontmatter_hides_nothing(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "2026-01-14.md", "---\nnote: |\n  ```\n---\n## Log\n- ☕ 1\n")

    r = await client.get("/api/log", params={"from": "2026-01-14", "to": "2026-01-14"})
    entries = (
        [present(entry) for entry in r.json()[0]["entries"]]
        if r.status_code == 200 and r.json()
        else None
    )

    assert {"status": r.status_code, "entries": entries} == {
        "status": 200,
        "entries": [{"line": 6, "text": "- ☕ 1", "kind": "coffee", "count": 1}],
    }


async def test_619_i6_frontmatter_and_crlf(client: AsyncClient, vault: Path) -> None:
    # A `## Log` inside the frontmatter opens nothing, and the body is the same
    # text with CRLF endings on one of the two days.
    text = "---\ntype: Periodic Note\n## Log\n- ☕ 9\n---\n## Log\n- ☕ 1\n"
    write(vault, "2026-01-12.md", text.replace("\n", "\r\n"))
    write(vault, "2026-01-13.md", text)

    r = await client.get("/api/log", params={"from": "2026-01-12", "to": "2026-01-13"})
    entries = (
        {day["date"]: [present(entry) for entry in day["entries"]] for day in r.json()}
        if r.status_code == 200
        else None
    )
    one = [{"line": 7, "text": "- ☕ 1", "kind": "coffee", "count": 1}]

    assert {"status": r.status_code, "entries": entries} == {
        "status": 200,
        "entries": {"2026-01-12": one, "2026-01-13": one},
    }


async def test_619_i7_the_call_changes_no_note(client: AsyncClient, vault: Path) -> None:
    write(vault, "2026-01-20.md", "## Log\n- ☕ 1\n")
    before = snapshot(vault)

    r = await client.get("/api/log", params={"from": "2026-01-20", "to": "2026-01-20"})

    assert {"status": r.status_code, "unchanged": snapshot(vault) == before} == {
        "status": 200,
        "unchanged": True,
    }


async def test_619_i8_note_gone_is_skipped(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "2026-01-01.md", "## Log\n- ☕ 1\n")
    write(vault, "2026-01-02.md", "## Log\n- ☕ 2\n")
    write(vault, "2026-01-03.md", "## Log\n- ☕ 3\n")

    def gone_on_second(root: Path, relative: str) -> str | None:
        # As though the note were deleted after the listing found it.
        if relative.endswith("2026-01-02.md"):
            raise FileNotFoundError(relative)
        return read_note(root, relative)

    monkeypatch.setattr("kasten_backend.vault.read_note", gone_on_second)

    r = await client.get("/api/log", params={"from": "2026-01-01", "to": "2026-01-03"})
    dates = [day["date"] for day in r.json()] if r.status_code == 200 else None

    assert {"status": r.status_code, "dates": dates} == {
        "status": 200,
        "dates": ["2026-01-01", "2026-01-03"],
    }


@pytest.mark.parametrize("row", DAY_CASES, ids=lambda row: row["id"])
async def test_805_a1_last_kind_day_value(
    client: AsyncClient, vault: Path, row: dict[str, Any]
) -> None:
    write_config(vault, f"{row['kind']}\n")
    write(vault, "2026-01-04.md", "## Log\n" + "".join(f"{line}\n" for line in row["lines"]))

    r = await client.get("/api/log", params={"from": "2026-01-04", "to": "2026-01-04"})
    totals = (
        [[kind["total"] for kind in day["totals"]["mine"]] for day in r.json()]
        if r.status_code == 200
        else None
    )

    assert {"status": r.status_code, "totals": totals} == {
        "status": 200,
        "totals": [[row["value"]]],
    }


async def test_805_a2_last_kind_with_no_line_is_null_in_the_raw_answer(
    client: AsyncClient, vault: Path
) -> None:
    write_config(vault, "- ⚖ weight: kg, last\n")
    write(vault, "2026-01-04.md", "## Log\n- 💧 500 ml\n")

    r = await client.get("/api/log", params={"from": "2026-01-04", "to": "2026-01-04"})
    mine = '"mine":[{"mark":"⚖","name":"weight","unit":"kg","total":null}]'

    assert {"status": r.status_code, "mine": mine in r.content.decode("utf-8")} == {
        "status": 200,
        "mine": True,
    }


async def test_805_a3_a_summed_kind_total_is_unchanged_in_the_raw_answer(
    client: AsyncClient, vault: Path
) -> None:
    write_config(vault, "- 🍵 tea: 1 cup, min 3\n")
    write(vault, "2026-01-04.md", "## Log\n- 🍵 1 cup\n- 🍵 0,5 cup\n")
    # A day with a `## Log` and no tea line sums to zero, written as `0.0` like the others.
    write(vault, "2026-01-05.md", "## Log\n- ☕ 1\n")

    r = await client.get("/api/log", params={"from": "2026-01-04", "to": "2026-01-05"})
    text = r.content.decode("utf-8")
    mine = '"mine":[{"mark":"🍵","name":"tea","unit":"cup","total":1.5}]'
    empty = '"mine":[{"mark":"🍵","name":"tea","unit":"cup","total":0.0}]'

    assert {"status": r.status_code, "mine": (mine in text, empty in text)} == {
        "status": 200,
        "mine": (True, True),
    }
