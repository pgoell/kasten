"""The model-use collector: session files in, prices and projects applied, lines out.

Nothing here reads a real session file. Each test writes its own records; the
note's own rules (rerun, foreign lines, the rewrite) are in test_model_use_notes.py.
"""

import os
import time
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

import pytest

from backend.tests.model_use_records import (
    CONFIG,
    NOTE,
    PRICES,
    config,
    record,
    session,
    usage,
    usage_lines,
)
from kasten_backend.model_use import BUNDLED, main, run
from kasten_backend.model_use_config import read_config
from kasten_backend.model_use_lines import format_line, parse_line

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

    from kasten_backend.model_use_lines import Usage

DAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)


def parsed(line: str) -> Usage:
    """The usage a line holds, which a test expects to be one."""
    usage = parse_line(line)
    assert usage is not None
    return usage


@pytest.fixture
def world(tmp_path: Path) -> tuple[Path, Path]:
    """An empty session folder and an empty vault, both under tmp_path, with prices in the vault."""
    source, vault = tmp_path / "projects", tmp_path / "vault"
    source.mkdir()
    vault.mkdir()
    config(vault)
    return source, vault


@pytest.fixture
def berlin(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Run with the process in Europe/Berlin, two hours ahead of UTC in October."""
    monkeypatch.setenv("TZ", "Europe/Berlin")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


def test_808_a1_a_usage_line_reads_back_as_written() -> None:
    lines = [
        "- 2026-10-26 claude-opus-5-5 kasten: in 1204, out 48210, cache write 512800, "
        "cache read 30120400, cost 11.8823 usd",
        "- 2026-10-26 claude-haiku-5-5 Code kasten: in 310, out 9120, cache write 88000, "
        "cache read 1200300, cost 0.0347 usd, unpriced 12",
        "- 2026-10-26 claude-mystery-1 kasten: in 5, out 7, cache write 0, cache read 0, "
        "cost unknown",
    ]

    assert [format_line(parsed(line)) for line in lines] == lines
    assert parse_line("- kasten notes, not a usage line") is None


def test_808_a2_counts_each_day_model_and_project(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "-home-pascal-Code-kasten/a.jsonl",
        record("m1", usage(input=100, output=10, write=1000, read=5000)),
        record("m2", usage(input=50, output=5)),
        record(
            "m3", usage(input=1000), model="claude-haiku-5-5", cwd="/home/pascal/Code/blattwerk"
        ),
        record("m4", usage(input=1_000_000), stamp="2026-10-26T10:00:00Z"),
    )

    run(source, vault, CONFIG, DAY, date(2026, 10, 26), NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-haiku-5-5 blattwerk: in 1000, out 0, cache write 0, "
        "cache read 0, cost 0.0001 usd",
        "- 2026-10-25 claude-opus-5-5 kasten: in 150, out 15, cache write 1000, "
        "cache read 5000, cost 0.0069 usd",
        "- 2026-10-26 claude-opus-5-5 kasten: in 1000000, out 0, cache write 0, "
        "cache read 0, cost 4.0000 usd",
    ]


def test_808_a2_subagent_files_count_too(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "-home-pascal-Code-kasten/abc.jsonl", record("m1", usage(input=100)))
    session(
        source,
        "-home-pascal-Code-kasten/abc/subagents/agent-1.jsonl",
        record("m2", usage(input=50)),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-5 kasten: in 150, out 0, cache write 0, "
        "cache read 0, cost 0.0006 usd"
    ]


@pytest.mark.usefixtures("berlin")
def test_808_a2_the_day_is_the_local_day_of_the_timestamp(world: tuple[Path, Path]) -> None:
    source, vault = world
    # 23:30 UTC on the 24th is 01:30 on the 25th in Berlin, so the line is the 25th.
    session(source, "a.jsonl", record("m1", usage(input=1), stamp="2026-10-24T23:30:00Z"))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert [line[:12] for line in usage_lines(vault)] == ["- 2026-10-25"]


def test_808_a2_a_month_with_no_lines_is_not_created(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=1)))

    report = run(source, vault, CONFIG, date(2026, 11, 1), date(2026, 11, 2), NOW)

    assert {"report": report, "made": (vault / CONFIG / "Model use").exists()} == {
        "report": [],
        "made": False,
    }


def test_808_a2_the_command_writes_the_range_and_prints_each_note(
    world: tuple[Path, Path], capsys: pytest.CaptureFixture[str]
) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=1)))

    status = main([str(source), str(vault), "--from", "2026-10-25", "--to", "2026-10-25"])

    assert (status, capsys.readouterr().out) == (0, f"written {NOTE}\n")


def test_808_a3_cache_writes_are_priced_apart_by_5m_and_1h(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "a.jsonl",
        record(
            "m1",
            usage(
                write=1_000_000,
                cache_creation={
                    "ephemeral_5m_input_tokens": 1_000_000,
                    "ephemeral_1h_input_tokens": 0,
                },
            ),
        ),
        record(
            "m2",
            usage(
                write=1_000_000,
                cache_creation={
                    "ephemeral_5m_input_tokens": 0,
                    "ephemeral_1h_input_tokens": 1_000_000,
                },
            ),
        ),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # 5m is 5 and 1h is 8 per million, so all at 5m would read 10 and all at 1h 16.
    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-5 kasten: in 0, out 0, cache write 2000000, "
        "cache read 0, cost 13.0000 usd"
    ]


def test_808_a3_a_fast_message_takes_the_fast_row(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=1_000_000, speed="fast")))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # The fast input rate is 8, where the plain one is 4.
    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-5 kasten: in 1000000, out 0, cache write 0, "
        "cache read 0, cost 8.0000 usd"
    ]


def test_808_a3_a_prompt_above_the_over_count_takes_the_over_row(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "a.jsonl",
        record("m1", usage(input=200_000), model="claude-haiku-5-5"),
        record("m2", usage(input=100_000), model="claude-haiku-5-5"),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # 200,000 is over 100,000 and reads 0.5 a million; 100,000 is not over it and reads 0.1.
    assert usage_lines(vault) == [
        "- 2026-10-25 claude-haiku-5-5 kasten: in 300000, out 0, cache write 0, "
        "cache read 0, cost 0.1100 usd"
    ]


def test_808_a3_a_dated_model_id_takes_the_row_of_its_name(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "a.jsonl",
        record("m1", usage(input=1_000_000), model="claude-haiku-4-5-20251001"),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-haiku-4-5-20251001 kasten: in 1000000, out 0, cache write 0, "
        "cache read 0, cost 1.0000 usd"
    ]


def test_808_i1_a_model_with_no_row_says_cost_unknown(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=5, output=7), model="claude-mystery-1"))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-mystery-1 kasten: in 5, out 7, cache write 0, "
        "cache read 0, cost unknown"
    ]


def test_808_i1_a_group_with_some_unpriced_messages_names_their_tokens(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(
        source,
        "a.jsonl",
        record("m1", usage(input=1000), model="claude-haiku-5-5"),
        # Haiku has no fast row, and a fast message never falls back to a plain one.
        record("m2", usage(input=10, output=1000, speed="fast"), model="claude-haiku-5-5"),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-haiku-5-5 kasten: in 1010, out 1000, cache write 0, "
        "cache read 0, cost 0.0001 usd, unpriced 1010"
    ]


def test_808_i2_bad_json_synthetic_and_incomplete_records_are_passed_over(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(
        source,
        "a.jsonl",
        record("m1", usage(input=10, output=2)),
        "{not json",
        record("m2", usage(input=99), model="<synthetic>"),
        record("m3"),
        record("m4", usage(input=99), cwd=None),
        record("m5", usage(input=99), stamp=None),
        record("m6", usage(input=99), kind="user"),
    )

    report = run(source, vault, CONFIG, DAY, DAY, NOW)

    assert (report, usage_lines(vault)) == (
        [f"written {NOTE}"],
        [
            "- 2026-10-25 claude-opus-5-5 kasten: in 10, out 2, cache write 0, "
            "cache read 0, cost 0.0001 usd"
        ],
    )


def test_808_i2_a_broken_config_line_is_named_and_the_rest_is_read(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    config(
        vault,
        "# Model use prices\n\n## Prices\n"
        "- claude-opus-5-5: input 4, output 20, cache write 5m 5, "
        "cache write 1h 8, cache read 0.2\n"
        "- claude-broken input 1\n"
        "Free text, not read.\n\n## Projects\n- /home/pascal/Code/kasten: kasten\n",
    )
    session(source, "a.jsonl", record("m1", usage(input=1_000_000)))

    report = run(source, vault, CONFIG, DAY, DAY, NOW)

    assert (report[0], usage_lines(vault)) == (
        "Skipped line 5 of model-use.md: - claude-broken input 1",
        [
            "- 2026-10-25 claude-opus-5-5 kasten: in 1000000, out 0, cache write 0, "
            "cache read 0, cost 4.0000 usd"
        ],
    )


def test_808_i4_one_message_counts_once_across_files_and_records(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "a.jsonl",
        record("m1", usage(input=100, output=1)),
        record("m1", usage(input=100, output=9)),
    )
    session(source, "a/subagents/agent-1.jsonl", record("m1", usage(input=100, output=1)))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # The record with the most output tokens counts, once: 100 input, not 300.
    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-5 kasten: in 100, out 9, cache write 0, "
        "cache read 0, cost 0.0006 usd"
    ]


def test_808_i8_a_folder_matches_only_at_a_boundary(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "a.jsonl",
        record("m1", usage(input=1), cwd="/home/pascal/Code/kasten-old"),
        record("m2", usage(input=1), cwd="/home/pascal/Code/kasten/backend"),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert [parsed(line).project for line in usage_lines(vault)] == ["kasten", "kasten-old"]


def test_808_i8_the_longest_folder_wins(world: tuple[Path, Path]) -> None:
    source, vault = world
    config(vault, PRICES + "- /home/pascal/Code/kasten/backend: backend\n")
    session(
        source,
        "a.jsonl",
        record("m1", usage(input=1), cwd="/home/pascal/Code/kasten/backend/src"),
        record("m2", usage(input=1), cwd="/home/pascal/Code/kasten/frontend"),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert [parsed(line).project for line in usage_lines(vault)] == ["backend", "kasten"]


def test_808_i8_a_colon_in_a_project_name_is_dropped(world: tuple[Path, Path]) -> None:
    source, vault = world
    odd = PRICES.replace("- /home/pascal/Code/kasten: kasten", "- /home/pascal/Code/odd: Odd: name")
    config(vault, odd)
    session(source, "a.jsonl", record("m1", usage(input=1), cwd="/home/pascal/Code/odd"))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-5 Odd name: in 1, out 0, cache write 0, "
        "cache read 0, cost 0.0000 usd"
    ]


def test_808_a3_without_a_config_note_the_bundled_prices_count(tmp_path: Path) -> None:
    source, vault = tmp_path / "projects", tmp_path / "vault"
    source.mkdir()
    vault.mkdir()
    session(source, "a.jsonl", record("m1", usage(input=1_000_000)))
    bundled = read_config(BUNDLED.read_text(encoding="utf-8")).prices
    row = next(p for p in bundled if p.model == "claude-opus-5-5" and not p.fast and p.over is None)

    report = run(source, vault, CONFIG, DAY, DAY, NOW)

    assert (report, usage_lines(vault)) == (
        [f"No model-use.md in {CONFIG}: using the bundled prices of {BUNDLED}", f"written {NOTE}"],
        [
            "- 2026-10-25 claude-opus-5-5 kasten: in 1000000, out 0, cache write 0, "
            f"cache read 0, cost {row.input:.4f} usd"
        ],
    )


def test_808_a3_the_bundled_price_table_has_no_broken_line() -> None:
    parsed = read_config(BUNDLED.read_text(encoding="utf-8"))

    assert (parsed.skipped, len(parsed.prices) > 0) == ([], True)


def test_808_r1_a_missing_source_is_refused_and_writes_nothing(
    world: tuple[Path, Path], tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=100)))
    days = ["--from", "2026-10-25", "--to", "2026-10-25"]
    main([str(source), str(vault), *days])
    before = (vault / NOTE).read_bytes()
    empty = tmp_path / "empty"
    empty.mkdir()
    typo = tmp_path / "typo"

    statuses = [main([str(typo), str(vault), *days]), main([str(empty), str(vault), *days])]

    err = capsys.readouterr().err
    assert (
        statuses,
        (vault / NOTE).read_bytes() == before,
        str(typo) in err,
        str(empty) in err,
    ) == ([2, 2], True, True, True)


def test_808_r3_a_new_point_release_has_no_price(tmp_path: Path) -> None:
    source, vault = tmp_path / "projects", tmp_path / "vault"
    source.mkdir()
    vault.mkdir()
    session(source, "a.jsonl", record("m1", usage(input=1_000_000), model="claude-opus-5-6"))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # The bundled table has claude-opus-5 but no 5-6 row, and `-6` is not a date.
    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-6 kasten: in 1000000, out 0, cache write 0, "
        "cache read 0, cost unknown"
    ]


def test_808_r7_a_cwd_of_root_still_counts(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "a.jsonl", record("m1", usage(input=1_000_000), cwd="/"))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 claude-opus-5-5 /: in 1000000, out 0, cache write 0, "
        "cache read 0, cost 4.0000 usd"
    ]


def test_808_r9_a_file_older_than_the_range_is_not_read(world: tuple[Path, Path]) -> None:
    source, vault = world
    # The message is inside the range, but the file was last written before the range began.
    session(source, "old.jsonl", record("m1", usage(input=1_000_000)))
    long_ago = datetime(2026, 10, 1, tzinfo=UTC).timestamp()
    os.utime(source / "old.jsonl", (long_ago, long_ago))

    report = run(source, vault, CONFIG, DAY, DAY, NOW)

    assert (report, (vault / NOTE).exists()) == ([], False)
