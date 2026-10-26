"""The monthly note the collector writes: a rerun, a note that is not its own, the rewrite.

Made-up files under tmp_path, as in test_model_use.py.
"""

import os
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from backend.tests.model_use_records import (
    CONFIG,
    NOTE,
    config,
    record,
    session,
    snapshot,
    usage,
    usage_lines,
)
from kasten_backend.model_use import run

if TYPE_CHECKING:
    from pathlib import Path

DAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)
SENTENCE = "The collector writes this note, and its lines are rewritten for the days a run covers."
FRONT = (
    "---\nid: 0190a000-0000-7000-8000-000000000001\n"
    "created: 2026-10-01T00:00:00+00:00\nmodified: 2026-10-01T00:00:00+00:00\n"
    "type: Reference\ngenerator: kasten-model-use\n---\n"
)


@pytest.fixture
def world(tmp_path: Path) -> tuple[Path, Path]:
    """An empty session folder and an empty vault, both under tmp_path, with prices in the vault."""
    source, vault = tmp_path / "projects", tmp_path / "vault"
    source.mkdir()
    vault.mkdir()
    config(vault)
    return source, vault


def test_808_a5_a_second_run_writes_nothing(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100, output=10)))
    run(source, vault, CONFIG, DAY, DAY, NOW)
    path = vault / NOTE
    before = (path.read_bytes(), path.stat().st_mtime_ns)

    report = run(source, vault, CONFIG, DAY, DAY, datetime(2026, 10, 27, 9, 0, tzinfo=UTC))

    assert (report, path.read_bytes(), path.stat().st_mtime_ns) == (
        [f"unchanged {NOTE}"],
        before[0],
        before[1],
    )


def test_808_a6_a_note_without_the_marker_is_left_alone_and_named(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100)))
    mine = "# My own October\n\n- 2026-10-25 claude-opus-5-5 kasten: in 1, out 2\n"
    (vault / CONFIG / "Model use").mkdir(parents=True)
    (vault / NOTE).write_text(mine, encoding="utf-8")

    report = run(source, vault, CONFIG, DAY, DAY, NOW)

    assert {"report": report, "bytes": (vault / NOTE).read_text(encoding="utf-8")} == {
        "report": [f"left alone {NOTE}"],
        "bytes": mine,
    }


def test_808_a6_no_other_file_in_the_vault_is_touched(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100)))
    (vault / "Notes").mkdir()
    (vault / "Notes" / "Kept.md").write_text("# Kept\n", encoding="utf-8")
    before = snapshot(vault)

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # The note is the one file the run may create; every other file keeps its bytes.
    assert (snapshot(vault, skip=NOTE) == before, (vault / NOTE).is_file()) == (True, True)


def test_808_i3_lines_of_days_outside_the_range_stay_byte_for_byte(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    outside = (
        "- 2026-10-20 claude-opus-5-5 kasten: in 1, out 2, cache write 3, cache read 4, "
        "cost 9.9999 usd"
    )
    stale = (
        "- 2026-10-25 claude-opus-5-5 kasten: in 999, out 0, cache write 0, cache read 0, "
        "cost 1.0000 usd"
    )
    (vault / CONFIG / "Model use").mkdir(parents=True)
    (vault / NOTE).write_text(
        f"{FRONT}# Model use 2026-10\n\n{SENTENCE}\n\n{outside}\n{stale}\n", encoding="utf-8"
    )
    session(source, "a.jsonl", record("m1", usage(input=100)))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    lines = usage_lines(vault)
    assert (outside in lines, stale in lines, len(lines)) == (True, False, 2)


def test_808_i3_a_foreign_line_is_kept_after_the_usage_lines(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100)))
    run(source, vault, CONFIG, DAY, DAY, NOW)
    prose = "Pascal's own note about the month."
    (vault / NOTE).write_text(
        (vault / NOTE).read_text(encoding="utf-8") + f"\n{prose}\n", encoding="utf-8"
    )
    settled = (vault / NOTE).read_bytes()

    again = run(source, vault, CONFIG, DAY, DAY, NOW)
    same = (vault / NOTE).read_bytes() == settled
    session(source, "b.jsonl", record("m2", usage(input=50)))
    changed = run(source, vault, CONFIG, DAY, DAY, NOW)

    text = (vault / NOTE).read_text(encoding="utf-8")
    usage_150 = "- 2026-10-25 claude-opus-5-5 kasten: in 150, out 0, cache write 0, cache read 0, "
    assert {
        "again": again,
        "same": same,
        "changed": changed,
        "after_usage": text.endswith(f"\n{usage_150}cost 0.0006 usd\n\n{prose}\n"),
        "no_gap": "\n\n\n" not in text,
    } == {
        "again": [f"unchanged {NOTE}"],
        "same": True,
        "changed": [f"written {NOTE}"],
        "after_usage": True,
        "no_gap": True,
    }


def test_808_i5_id_and_created_survive_a_rewrite_with_no_temp_file(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100)))
    run(source, vault, CONFIG, DAY, DAY, NOW)
    first = (vault / NOTE).read_text(encoding="utf-8").split("\n")[1:4]
    session(source, "b.jsonl", record("m2", usage(input=50)))

    report = run(source, vault, CONFIG, DAY, DAY, datetime(2026, 10, 27, 8, 0, tzinfo=UTC))

    text = (vault / NOTE).read_text(encoding="utf-8").split("\n")
    assert {
        "report": report,
        "id_and_created": [text[1], text[2]] == first[:2],
        "modified": text[3],
        "files": sorted(path.name for path in (vault / NOTE).parent.iterdir()),
    } == {
        "report": [f"written {NOTE}"],
        "id_and_created": True,
        "modified": "modified: 2026-10-27T08:00:00+00:00",
        "files": ["2026-10.md"],
    }


def test_808_r1_a_day_with_no_message_in_the_source_keeps_its_lines(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100)))
    run(source, vault, CONFIG, DAY, DAY + timedelta(days=1), NOW)
    # The 25th's file is gone; only the 26th has a message now.
    (source / "a.jsonl").unlink()
    session(source, "b.jsonl", record("m2", usage(input=50), stamp="2026-10-26T10:00:00Z"))

    run(source, vault, CONFIG, DAY, DAY + timedelta(days=1), NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-5 kasten: in 100, out 0, cache write 0, cache read 0, "
        "cost 0.0004 usd",
        "- 2026-10-26 claude-opus-5-5 kasten: in 50, out 0, cache write 0, cache read 0, "
        "cost 0.0002 usd",
    ]


def test_808_r2_other_frontmatter_fields_survive_a_rewrite(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100)))
    run(source, vault, CONFIG, DAY, DAY, NOW)
    note = vault / NOTE
    note.write_text(
        note.read_text(encoding="utf-8").replace("type: Reference", "type: Reference\ntags: [ai]"),
        encoding="utf-8",
    )
    session(source, "b.jsonl", record("m2", usage(input=50)))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    front = note.read_text(encoding="utf-8").split("\n")[1:7]
    assert (
        [line.partition(":")[0] for line in front],
        "tags: [ai]" in front,
    ) == (["id", "created", "modified", "type", "tags", "generator"], True)


def test_808_r5_a_note_that_is_not_utf8_is_left_alone_and_named(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100), stamp="2026-11-01T10:00:00Z"))
    # Written in November, as Claude Code would have, so the range does not skip the file.
    november_day = datetime(2026, 11, 1, 12, tzinfo=UTC).timestamp()
    os.utime(source / "a.jsonl", (november_day, november_day))
    november = f"{CONFIG}/Model use/2026-11.md"
    bad = b"---\n\xff\xfe broken\n---\n"
    (vault / CONFIG / "Model use").mkdir(parents=True)
    (vault / NOTE).write_bytes(bad)

    report = run(source, vault, CONFIG, date(2026, 10, 31), date(2026, 11, 1), NOW)

    assert (report, (vault / NOTE).read_bytes(), (vault / november).is_file()) == (
        [f"left alone {NOTE}", f"written {november}"],
        bad,
        True,
    )
