"""The grok session files, read into the model-use lines beside Claude Code's and codex's.

Nothing here reads a real session file. The grok records are written out by the
helpers in `model_use_records`, with made-up folders and no prompt text. Each test
runs over its own folder under tmp_path with no config note, so the bundled price
table counts.
"""

import json
import time
from typing import TYPE_CHECKING

import pytest

from backend.tests.model_use_records import (
    CONFIG,
    grok_counts,
    grok_session,
    grok_turn,
    record,
    session,
    usage,
)
from backend.tests.test_model_use_codex import (
    CLAUDE_LINE,
    CODEX_LINE,
    DAY,
    NOW,
    call,
    meta,
    turn,
    usage_lines,
    write_note,
)
from kasten_backend.model_use import run
from kasten_backend.model_use_lines import parse_line

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


@pytest.fixture
def berlin(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Run with the process in Europe/Berlin, so a turn's day is read on that clock."""
    monkeypatch.setenv("TZ", "Europe/Berlin")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


pytestmark = pytest.mark.usefixtures("berlin")


@pytest.fixture
def world(tmp_path: Path) -> tuple[Path, Path]:
    """An empty session folder and an empty vault, with no config note in the vault."""
    source, vault = tmp_path / "sessions", tmp_path / "vault"
    source.mkdir()
    vault.mkdir()
    return source, vault


# 22454 in holds 1664 cached and 1000 written, so 19790 are plain. At grok-4.7's row:
# 19790 * 2 + 1000 * 2 + 1664 * 0.5 + 193 * 6 = 43570 millionths.
GROK_LINE = (
    "- 2026-10-25 grok/grok-4.7 proj: in 19790, out 193, cache write 1000, "
    "cache read 1664, cost 0.0436 usd"
)


def test_1129_a1_a_grok_session_counts_per_day_model_and_project(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    grok_session(source, grok_turn())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [GROK_LINE]


def test_1129_a2_a_grok_line_names_its_tool_and_reads_back_as_grok(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    grok_session(source, grok_turn())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    read = [parse_line(line) for line in usage_lines(vault)]
    assert [(u.tool, u.model) for u in read if u is not None] == [("grok", "grok-4.7")]


def test_1129_a3_claude_code_and_codex_lines_come_out_as_on_main_beside_grok_files(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(source, "claude.jsonl", record("m1", usage(input=1_000_000)))
    session(source, "codex.jsonl", meta(), turn(), call())
    grok_session(source, grok_turn())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [CLAUDE_LINE, CODEX_LINE, GROK_LINE]


def test_1129_a4_the_bundled_table_prices_grok_turns_and_long_prompts(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    grok_session(
        source,
        grok_turn("p1", {"grok-4.7": grok_counts(100000, 1000, 0, 0)}),
        grok_turn("p2", {"grok-4.7": grok_counts(300000, 1000, 100000, 0)}),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # The first prompt is 100,000 tokens and reads the plain row, 0.206. The second is
    # 300,000, past 200,000, so it reads the long row, 0.912. Their sum is 1.118.
    assert usage_lines(vault) == [
        "- 2026-10-25 grok/grok-4.7 proj: in 300000, out 2000, cache write 0, "
        "cache read 100000, cost 1.1180 usd"
    ]


def test_1129_i1_a_grok_run_replaces_its_lines_and_keeps_claude_code_and_codex_lines(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    write_note(
        vault,
        CLAUDE_LINE,
        CODEX_LINE,
        "- 2026-10-25 grok/grok-4.7 proj: in 1, out 1, cache write 0, cache read 0, "
        "cost 0.0001 usd",
    )
    grok_session(source, grok_turn())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [CLAUDE_LINE, CODEX_LINE, GROK_LINE]


def test_1129_i2_a_grok_turn_counts_once_and_once_per_model(world: tuple[Path, Path]) -> None:
    source, vault = world
    grok_session(
        source,
        grok_turn("p1"),
        # The same prompt ended twice: the one with more output counts.
        grok_turn("p2", {"grok-4.7": grok_counts(1000, 10, 0, 0)}),
        grok_turn("p2", {"grok-4.7": grok_counts(1000, 50, 0, 0)}),
        # One turn that used two models.
        grok_turn(
            "p3",
            {"grok-4.7": grok_counts(1000, 0, 0, 0), "grok-4.5": grok_counts(2000, 20, 0, 0)},
        ),
    )
    # A second session file that copies the first turn.
    grok_session(source, grok_turn("p1"), session_id="s2")

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 grok/grok-4.5 proj: in 2000, out 20, cache write 0, cache read 0, "
        "cost 0.0041 usd",
        "- 2026-10-25 grok/grok-4.7 proj: in 21790, out 243, cache write 1000, "
        "cache read 1664, cost 0.0479 usd",
    ]


def test_1129_i3_a_grok_model_with_no_row_says_cost_unknown(world: tuple[Path, Path]) -> None:
    source, vault = world
    grok_session(source, grok_turn(models={"grok-4.7-build": grok_counts()}))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 grok/grok-4.7-build proj: in 19790, out 193, cache write 1000, "
        "cache read 1664, cost unknown"
    ]


def test_1129_i4_broken_grok_records_are_passed_over(world: tuple[Path, Path]) -> None:
    source, vault = world
    grok_session(
        source,
        grok_turn("p0"),
        "{not json",
        grok_turn("p1", usage=None),
        grok_turn("p2", usage={"inputTokens": 5}),
        grok_turn("", {"grok-4.7": grok_counts(9000, 9)}),
        grok_turn("p3", {"grok-4.7": grok_counts(9000, 9)}, stamp=None),
        grok_turn("p4", {"grok-4.7": grok_counts(9000, 9)}, stamp="2026-10-25"),
        grok_turn("p5", {"grok-4.6": "not counts", "grok-4.5": grok_counts(9000, 9, 0, 0)}),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 grok/grok-4.5 proj: in 9000, out 9, cache write 0, cache read 0, "
        "cost 0.0181 usd",
        GROK_LINE,
    ]


def test_1129_i5_groks_other_session_files_add_nothing_and_stop_nothing(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    grok_session(source, grok_turn())
    grok_session(
        source,
        json.dumps({"type": "system", "content": "made up"}),
        json.dumps({"type": "assistant", "content": "made up", "model_id": "grok-4.7"}),
        name="chat_history.jsonl",
    )
    grok_session(
        source,
        json.dumps({"type": "turn_started", "model_id": "grok-4.7", "ts": 1}),
        name="events.jsonl",
    )
    grok_session(source, json.dumps({"prompt_index": 0}), name="rewind_points.jsonl")
    session(
        source,
        "%2Fhome%2Fme%2FCode%2Fproj/prompt_history.jsonl",
        json.dumps({"prompt": "made up", "session_id": "s1", "timestamp": 1, "is_bash": False}),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [GROK_LINE]


def test_1129_i6_a_turn_of_several_calls_is_held_to_the_long_context_row_per_call(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    grok_session(source, grok_turn("p1", {"grok-4.7": grok_counts(300000, 1000, 0, 0, calls=2)}))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # Two calls of 150,000 each stay under 200,000, so the plain row: 0.6 + 0.006.
    assert usage_lines(vault) == [
        "- 2026-10-25 grok/grok-4.7 proj: in 300000, out 1000, cache write 0, "
        "cache read 0, cost 0.6060 usd"
    ]
