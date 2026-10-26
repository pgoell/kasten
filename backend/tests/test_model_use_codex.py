"""The codex session files, read into the model-use lines beside Claude Code's.

Nothing here reads a real session file. The codex records are written out by the
helpers below, with made-up folders and no prompt text. Each test runs over its own
folder under tmp_path with no config note, so the bundled price table counts.
"""

import json
import time
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

import pytest

from backend.tests.model_use_records import CONFIG, NOTE, record, session, usage
from kasten_backend.model_use import run

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

DAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 26, 8, 0, tzinfo=UTC)
PROJECT = "/home/me/Code/proj"
STAMP = "2026-10-25T10:00:00.000Z"
LATER = "2026-10-25T11:00:00.000Z"
MARKED = (
    "---\nid: 0190a000-0000-7000-8000-000000000002\ncreated: 2026-10-01T00:00:00+00:00\n"
    "modified: 2026-10-01T00:00:00+00:00\ntype: Reference\ngenerator: kasten-model-use\n---\n"
    "# Model use 2026-10\n\nThe collector writes this note, and its lines are rewritten "
    "for the days a run covers.\n\n"
)
CODEX_LINE = (
    "- 2026-10-25 codex/gpt-6-astra proj: in 9822, out 213, cache write 0, "
    "cache read 12032, cost 0.1209 usd"
)
CLAUDE_LINE = (
    "- 2026-10-25 claude-opus-5-5 kasten: in 1000000, out 0, cache write 0, "
    "cache read 0, cost 4.0000 usd"
)
OLD_DAY = (
    "- 2026-10-24 claude-opus-5-5 kasten: in 1, out 2, cache write 3, cache read 4, cost 0.0001 usd"
)


@pytest.fixture
def berlin(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Run with the process in Europe/Berlin, two hours ahead of UTC in October."""
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


def rec(kind: str, stamp: str = STAMP, **payload: object) -> str:
    """One codex record, a line of a file: its type, its stamp and its payload."""
    return json.dumps({"timestamp": stamp, "type": kind, "payload": payload})


def meta(cwd: str = PROJECT) -> str:
    """The session's first record, which names the folder the session started in."""
    return rec("session_meta", cwd=cwd)


def turn(model: str = "gpt-6-astra", cwd: str | None = PROJECT) -> str:
    """A turn's record: the model and, when it is given, the folder."""
    payload: dict[str, str] = {"model": model}
    if cwd is not None:
        payload["cwd"] = cwd
    return rec("turn_context", **payload)


def call(
    total: int = 22067,
    tokens_in: int = 21854,
    cached: int = 12032,
    out: int = 213,
    stamp: str = STAMP,
) -> str:
    """A token_count event for one model call, with its running total and the call's counts."""
    info = {
        "total_token_usage": {"total_tokens": total},
        "last_token_usage": {
            "input_tokens": tokens_in,
            "cached_input_tokens": cached,
            "cache_write_input_tokens": 0,
            "output_tokens": out,
            "reasoning_output_tokens": 0,
            "total_tokens": tokens_in + out,
        },
        "model_context_window": 272000,
    }
    return rec("event_msg", stamp, type="token_count", info=info)


def write_note(vault: Path, *lines: str) -> None:
    """The October note as the collector writes it, holding these lines."""
    path = vault / NOTE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(MARKED + "\n".join(lines) + "\n", encoding="utf-8")


def usage_lines(vault: Path) -> list[str]:
    """The usage lines of the October note, or none when the run wrote no note."""
    path = vault / NOTE
    if not path.is_file():
        return []
    text = path.read_text(encoding="utf-8")
    return [line for line in text.split("\n") if line.startswith("- ")]


def test_1099_a1_a_codex_session_counts_per_day_model_and_project(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "rollout-a.jsonl", meta(), turn(), call())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [CODEX_LINE]


def test_1099_a2_a_codex_line_names_its_tool_and_an_old_line_reads_as_claude_code(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    write_note(vault, OLD_DAY)
    session(source, "rollout-a.jsonl", meta(), turn(), call())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    lines = usage_lines(vault)
    assert (lines[:1], [text.startswith("- 2026-10-25 codex/") for text in lines[1:]]) == (
        [OLD_DAY],
        [True],
    )


def test_1099_a3_claude_code_lines_come_out_as_on_main_beside_codex_files(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(source, "claude.jsonl", record("m1", usage(input=1_000_000)))
    session(source, "codex.jsonl", meta(), turn(), call())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [CLAUDE_LINE, CODEX_LINE]


def test_1099_a4_the_bundled_table_prices_codex_calls_and_long_prompts(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(
        source,
        "rollout-a.jsonl",
        meta(),
        turn(),
        call(total=101000, tokens_in=100000, cached=0, out=1000),
        call(total=302000, tokens_in=300000, cached=100000, out=1000),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    # The first prompt is 100,000 tokens and reads the plain row, 1.05. The second is
    # 300,000, over 272,000, so it reads the long row, 4.275. Their sum is 5.325.
    assert usage_lines(vault) == [
        "- 2026-10-25 codex/gpt-6-astra proj: in 300000, out 2000, cache write 0, "
        "cache read 100000, cost 5.3250 usd"
    ]


def test_1099_i1_a_run_over_one_tool_keeps_the_other_tools_lines_of_the_day(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    write_note(
        vault,
        CLAUDE_LINE,
        "- 2026-10-25 codex/gpt-6-astra proj: in 1, out 1, cache write 0, cache read 0, "
        "cost 0.0001 usd",
    )
    session(
        source, "rollout-a.jsonl", meta(), turn(), call(total=1000, tokens_in=1000, cached=0, out=0)
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        CLAUDE_LINE,
        "- 2026-10-25 codex/gpt-6-astra proj: in 1000, out 0, cache write 0, cache read 0, "
        "cost 0.0100 usd",
    ]


def test_1099_i2_a_codex_call_counts_once(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "rollout-a.jsonl",
        meta(),
        turn(),
        call(total=22067),
        # The same event again, with the same running total: codex writes it twice.
        call(total=22067),
        call(total=44000, tokens_in=10000, cached=0, out=100, stamp=LATER),
    )
    # A second file that copies the first call, same stamp and total.
    session(source, "rollout-copy.jsonl", meta(), turn(), call(total=22067))

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 codex/gpt-6-astra proj: in 19822, out 313, cache write 0, "
        "cache read 12032, cost 0.2259 usd"
    ]


def test_1099_i3_model_and_project_come_from_the_latest_turn_context(
    world: tuple[Path, Path],
) -> None:
    source, vault = world
    session(
        source,
        "rollout-a.jsonl",
        meta(),
        # The first turn names a model but no folder, so the session's folder counts.
        turn(cwd=None),
        call(total=1010, tokens_in=1000, cached=0, out=10),
        turn(model="gpt-5.5", cwd="/home/me/Code/other"),
        call(total=3030, tokens_in=2000, cached=0, out=20),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 codex/gpt-5.5 other: in 2000, out 20, cache write 0, cache read 0, "
        "cost 0.0106 usd",
        "- 2026-10-25 codex/gpt-6-astra proj: in 1000, out 10, cache write 0, cache read 0, "
        "cost 0.0105 usd",
    ]


def test_1099_i4_broken_codex_records_are_passed_over(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(
        source,
        "rollout-a.jsonl",
        meta(),
        "{not json",
        rec("event_msg", type="token_count", info=None),
        # Before any turn there is no model, so this call is passed over.
        call(total=1010, tokens_in=1000, cached=0, out=10),
        turn(),
        call(),
    )

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [CODEX_LINE]


def test_1099_i5_a_codex_model_with_no_row_says_cost_unknown(world: tuple[Path, Path]) -> None:
    source, vault = world
    session(source, "rollout-a.jsonl", meta(), turn(model="gpt-9-unknown"), call())

    run(source, vault, CONFIG, DAY, DAY, NOW)

    assert usage_lines(vault) == [
        "- 2026-10-25 codex/gpt-9-unknown proj: in 9822, out 213, cache write 0, "
        "cache read 12032, cost unknown"
    ]
