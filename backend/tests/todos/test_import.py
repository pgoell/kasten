"""The import of the vault's todo lines into the store (#2191), on a vault of made-up notes."""

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend.tests.conftest import changed_paths, descriptions
from kasten_backend import change
from kasten_backend.config import Settings
from kasten_backend.todos import fields, importer
from kasten_backend.todos.models import Todo, TodoChange, TodoSession

TODAY = date(2026, 11, 18)

PLAN = """---
type: Project
---

# Plan

## Steps
- [ ] book flights #p/trip 📅 2026-12-01 ⏫ \N{HEAVY PLUS SIGN} 2026-11-01 🆔 kt-aaaaaa ^flights
  - [x] compare prices ✅ 2026-11-10
  - [ ] pay ⏳ 2026-11-20 🛫 2026-11-25
Some prose in between.
- [w] visa answer 👤 2026-11-05 [[Consulate]] 🆔 kt-bbbbbb
- [b] hotel ⛔ kt-aaaaaa ⛔ kt-cccccc ⏲ 1h20m ⏱ 45m
- [-] cruise ❌ 2026-11-02 🆔 kt-dddddd
- plain bullet
"""

DAILY = """---
type: Periodic Note
---

# 2026-11-17 Tuesday

## TODOs
- [/] water plants 🔁 every week 📅 2026-11-17 🆔 kt-eeeeee
- [ ] call back ⏰ 2026-11-19 09:00 👤 [[Sam]]

## Time
- 09:00-10:30 water plants kt-eeeeee
- 11:00-      call back
- 14:00-      water plants kt-eeeeee
"""

ENDS = """- [ ] call
- plain item
  - [ ] sub under plain

## Other
  - [ ] indented under heading
"""

SHARED = "- [ ] Milch\n- [x] Brot ✅ 2026-11-16\n"


@pytest.fixture
def fixtures(vault: Path) -> Settings:
    for path, text in {
        "02 Projects/Trip/plan.md": PLAN,
        "01 Periodic/00 Daily/2026-11-17.md": DAILY,
        "05 Shared/Einkauf.md": SHARED,
        "98 Archive/old.md": "- [ ] an archived todo\n",
        "notes/fenced.md": "```\n- [ ] in a fence\n```\n",
        "notes/twin.md": "- [ ] twin of flights 🆔 kt-aaaaaa\n",
        "notes/ends.md": ENDS,
        "notes/windows.md": "- [ ] crlf one\r\n  - [ ] crlf part\r\n- [ ] crlf two\r\n",
    }.items():
        note = vault / path
        note.parent.mkdir(parents=True, exist_ok=True)
        note.write_text(text, encoding="utf-8")
    return Settings(vault_path=vault, timezone="Europe/Berlin")


async def _plan(settings: Settings) -> importer.Plan:
    return await importer.plan(settings, set(), TODAY)


async def test_every_todo_line_becomes_a_row_with_its_fields(fixtures: Settings) -> None:
    rows = {row["words"]: row for row in (await _plan(fixtures)).rows}

    assert sorted(rows) == sorted(
        [
            "book flights #p/trip",
            "compare prices",
            "pay",
            "visa answer",
            "hotel",
            "cruise",
            "water plants",
            "call back",
            "twin of flights",
            "Milch",
            "Brot",
            "an archived todo",
            "call",
            "sub under plain",
            "indented under heading",
            "crlf one",
            "crlf part",
            "crlf two",
        ]
    )
    flights = rows["book flights #p/trip"]
    assert {key: flights[key] for key in ("id", "deadline", "deadline_hard", "priority")} == {
        "id": "kt-aaaaaa",
        "deadline": date(2026, 12, 1),
        "deadline_hard": True,
        "priority": "high",
    }
    assert (flights["tags"], flights["created"], flights["project"]) == (
        ["#p/trip"],
        date(2026, 11, 1),
        "02 Projects/Trip",
    )


async def test_the_two_dates_and_the_wait_follow_the_decisions(fixtures: Settings) -> None:
    rows = {row["words"]: row for row in (await _plan(fixtures)).rows}
    soft = TODAY + timedelta(days=importer.SOFT_DAYS)

    assert {
        "later of scheduled and start": rows["pay"]["from_day"],
        "part keeps no deadline": rows["pay"]["deadline"],
        "open, undated: soft": (rows["call back"]["deadline"], rows["call back"]["deadline_hard"]),
        "closed, undated: none": rows["cruise"]["deadline"],
        "shared item: none": rows["Milch"]["deadline"],
        "wait": (
            rows["visa answer"]["waiting_since"],
            rows["visa answer"]["waiting_on"],
            rows["visa answer"]["look_again"],
        ),
    } == {
        "later of scheduled and start": date(2026, 11, 25),
        "part keeps no deadline": None,
        "open, undated: soft": (soft, False),
        "closed, undated: none": None,
        "shared item: none": None,
        "wait": (date(2026, 11, 5), "[[Consulate]]", TODAY),
    }


async def test_the_other_fields_come_across(fixtures: Settings) -> None:
    rows = {row["words"]: row for row in (await _plan(fixtures)).rows}

    assert {
        "blockers": rows["hotel"]["blocked_by"],
        "clocks": (rows["hotel"]["estimate"], rows["hotel"]["worked"]),
        "repeat": rows["water plants"]["repeat"],
        "reminder and assignee": (rows["call back"]["remind_at"], rows["call back"]["assignee"]),
        "shared": (rows["Milch"]["shared_list"], rows["book flights #p/trip"]["shared_list"]),
        "states": [rows[name]["state"] for name in ("compare prices", "hotel", "cruise")],
        "parts": (rows["pay"]["parent_id"], rows["pay"]["position"]),
    } == {
        "blockers": ["kt-aaaaaa", "kt-cccccc"],
        "clocks": (80, 45),
        "repeat": "every week",
        "reminder and assignee": ("2026-11-19T09:00", "[[Sam]]"),
        "shared": ("Einkauf", None),
        "states": ["done", "blocked", "rejected"],
        "parts": ("kt-aaaaaa", 1),
    }


async def test_a_twin_gets_a_new_id_and_the_counts_hold(fixtures: Settings) -> None:
    moved = await _plan(fixtures)
    twin = next(row for row in moved.rows if row["words"] == "twin of flights")

    assert twin["id"] != "kt-aaaaaa"
    assert len(moved.renamed) == 1
    assert moved.open_lines == sum(row["state"] not in importer.CLOSED for row in moved.rows) == 15
    assert moved.ids_on_lines == {f"kt-{c * 6}" for c in "abde"}


async def test_each_top_todo_line_becomes_an_embed_and_its_parts_go(fixtures: Settings) -> None:
    moved = await _plan(fixtures)
    plan = moved.notes["02 Projects/Trip/plan.md"]
    ids = {row["words"]: row["id"] for row in moved.rows}

    assert plan.split("\n")[7:13] == [
        "![[kt-aaaaaa]] ^flights",
        "Some prose in between.",
        "![[kt-bbbbbb]]",
        f"![[{ids['hotel']}]]",
        "![[kt-dddddd]]",
        "- plain bullet",
    ]
    assert "notes/fenced.md" not in moved.notes


async def test_a_run_stores_rows_sessions_and_history_and_a_second_run_finds_nothing(
    fixtures: Settings, store: AsyncEngine
) -> None:
    async with AsyncSession(store) as session:
        first = await importer.run(fixtures, session, dry=False)
        second = await importer.run(fixtures, session, dry=False)
        rows = (await session.scalars(select(Todo))).all()
        sessions = (await session.scalars(select(TodoSession))).all()
        changes = (await session.scalars(select(TodoChange))).all()

    assert first.startswith("open todo lines: 15, open rows: 15")
    assert second.startswith("open todo lines: 0, open rows: 0")
    assert (len(rows), len(changes)) == (18, 18)
    assert sorted((one.started.hour, one.ended and one.ended.hour) for one in sessions) == [
        (8, 9),
        (13, 22),
    ]
    daily = (fixtures.vault_path / "01 Periodic/00 Daily/2026-11-17.md").read_text()
    assert "- [" not in daily.split("## Time")[0]


async def test_a_dry_run_writes_nothing(fixtures: Settings, store: AsyncEngine) -> None:
    async with AsyncSession(store) as session:
        report = await importer.run(fixtures, session, dry=True)
        rows = (await session.scalars(select(Todo))).all()

    assert report.startswith("open todo lines: 15, open rows: 15")
    assert rows == []
    assert (fixtures.vault_path / "05 Shared/Einkauf.md").read_text() == SHARED


READS = json.loads((Path(__file__).parents[1] / "fixtures/todo_reads.json").read_text("utf-8"))
NAMES = dict(
    zip(
        fields.FIELDS,
        (
            "due",
            "scheduled",
            "start",
            "priority",
            "recurrence",
            "onCompletion",
            "created",
            "done",
            "cancelled",
            "estimate",
            "worked",
            "id",
        ),
        strict=True,
    )
)


@pytest.mark.parametrize("case", READS, ids=[case["line"] for case in READS])
def test_the_reader_takes_the_fields_the_editor_takes(case: dict[str, Any]) -> None:
    """The cases `frontend/tests/todo-parse.test.ts` runs too."""
    _, found = fields.values(case["line"][6:])
    read: dict[str, Any] = {
        NAMES[pattern]: groups[0][0] for pattern, groups in found.items() if pattern in NAMES
    }
    read = {key: importer.PRIORITY.get(value, value) for key, value in read.items()}
    if found.get(fields.BLOCKED_BY):
        read["blockedBy"] = [groups[0] for groups in found[fields.BLOCKED_BY]]
    if found.get(fields.ASSIGNEE):
        read["assignee"] = found[fields.ASSIGNEE][0][0]
    if found.get(fields.WAITING):
        read["waitingSince"], read["waitingOn"] = found[fields.WAITING][0]

    assert read == case["fields"]


async def test_a_heading_or_a_plain_item_ends_the_parts_above_it(fixtures: Settings) -> None:
    moved = await _plan(fixtures)
    rows = {row["words"]: row for row in moved.rows}
    ids = {name: rows[name]["id"] for name in rows}

    assert [rows[name]["parent_id"] for name in ("sub under plain", "indented under heading")] == [
        None,
        None,
    ]
    assert moved.notes["notes/ends.md"] == (
        f"![[{ids['call']}]]\n- plain item\n  ![[{ids['sub under plain']}]]\n\n"
        f"## Other\n  ![[{ids['indented under heading']}]]\n"
    )


async def test_a_windows_note_keeps_its_line_endings(fixtures: Settings) -> None:
    moved = await _plan(fixtures)
    ids = {row["words"]: row["id"] for row in moved.rows}

    assert moved.notes["notes/windows.md"] == (
        f"![[{ids['crlf one']}]]\r\n![[{ids['crlf two']}]]\r\n"
    )


async def test_the_move_is_one_jj_change_once_the_snapshot_settles(
    versioned_vault: Path, store: AsyncEngine
) -> None:
    (versioned_vault / "plan.md").write_text("# Plan\n\n- [ ] one\n- [x] two ✅ 2026-11-01\n")
    (versioned_vault / "other.md").write_text("- [ ] three\n")
    settings = Settings(vault_path=versioned_vault, timezone="Europe/Berlin")
    async with AsyncSession(store) as session:
        await importer.run(settings, session, dry=False)
    await change.settled()

    assert descriptions(versioned_vault) == [f"vault: {importer.LABEL}"]
    assert sorted(changed_paths(versioned_vault, "@")) == ["other.md", "plan.md"]


def test_a_wait_reads_its_start_as_the_look_again_day() -> None:
    row = importer.row_of("tax office 👤 [[Tax Office]] ⏳ 2026-11-12 🛫 2026-11-30", "w", TODAY)
    unread = importer.row_of("tax office 👤 [[Tax Office]]", "w", TODAY)

    assert [row[key] for key in ("waiting_on", "waiting_since", "look_again", "from_day")] == [
        "[[Tax Office]]",
        TODAY,
        date(2026, 11, 30),
        date(2026, 11, 12),
    ]
    assert (row["assignee"], unread["look_again"]) == (None, TODAY)
