"""`GET /api/model-use` answers the collector's usage lines from its monthly notes.

The notes are written here as literal text, not by the collector, so each test
fails on a branch without the route for a reason of its own: a 404. The #1129 test
runs the collector over a made-up grok file, since what it proves is that the line
the collector writes for grok reaches the year review.
"""

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

from backend.tests.model_use_records import CONFIG, grok_session, grok_turn
from kasten_backend.model_use import run

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

NOTE = "99 Misc/01 Config/Model use/2026-10.md"
MARKED = (
    "---\nid: 0190a000-0000-7000-8000-000000000001\ncreated: 2026-10-01T00:00:00+00:00\n"
    "modified: 2026-10-01T00:00:00+00:00\ntype: Reference\ngenerator: kasten-model-use\n---\n"
    "# Model use 2026-10\n\nThe collector writes this note, and its lines are rewritten "
    "for the days a run covers.\n\n"
)
OPUS_25 = (
    "- 2026-10-25 claude-opus-5-5 kasten: in 150, out 15, cache write 1000, "
    "cache read 5000, cost 0.0069 usd"
)
HAIKU_25 = (
    "- 2026-10-25 claude-haiku-5-5 blattwerk: in 1000, out 0, cache write 0, "
    "cache read 0, cost unknown"
)
OPUS_24 = (
    "- 2026-10-24 claude-opus-5-5 kasten: in 1, out 2, cache write 3, cache read 4, cost 0.0001 usd"
)
OPUS_27 = (
    "- 2026-10-27 claude-opus-5-5 kasten: in 9, out 9, cache write 9, cache read 9, "
    "cost 0.0009 usd, unpriced 36"
)


def write(vault: Path, text: str, path: str = NOTE) -> None:
    """Write a note under the vault, folders made as needed."""
    target = vault / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


async def test_808_i6_skips_lines_that_do_not_parse_and_notes_without_the_marker(
    client: AsyncClient, vault: Path
) -> None:
    write(
        vault, MARKED + f"{OPUS_25}\n- 2026-10-25 claude-opus-5-5 kasten: in 1\nA note of mine.\n"
    )
    write(vault, f"# Not mine\n\n{OPUS_24}\n", path="99 Misc/01 Config/Model use/2026-09.md")

    r = await client.get("/api/model-use", params={"from": "2026-09-01", "to": "2026-10-31"})

    assert (r.status_code, r.json()) == (
        200,
        [
            {
                "day": "2026-10-25",
                "model": "claude-opus-5-5",
                "project": "kasten",
                "input": 150,
                "output": 15,
                "cache_write": 1000,
                "cache_read": 5000,
                "cost": 0.0069,
                "unpriced": 0,
            }
        ],
    )


async def test_808_i6_answers_only_the_days_in_range_sorted_with_no_cost_for_unpriced(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, MARKED + "\n".join([OPUS_27, HAIKU_25, OPUS_25, OPUS_24]) + "\n")

    r = await client.get("/api/model-use", params={"from": "2026-10-25", "to": "2026-10-26"})

    assert r.status_code == 200
    assert [(line["day"], line["model"], line["cost"], line["unpriced"]) for line in r.json()] == [
        ("2026-10-25", "claude-haiku-5-5", None, 1000),
        ("2026-10-25", "claude-opus-5-5", 0.0069, 0),
    ]


async def test_808_i6_a_range_with_no_notes_is_an_empty_list(
    client: AsyncClient, vault: Path
) -> None:
    r = await client.get("/api/model-use", params={"from": "2026-10-01", "to": "2026-10-31"})

    assert (r.status_code, r.json()) == (200, [])


async def test_1099_a5_the_route_answers_a_codex_line(client: AsyncClient, vault: Path) -> None:
    write(
        vault,
        MARKED + "- 2026-10-25 codex/gpt-6-astra proj: in 9822, out 213, cache write 0, "
        "cache read 12032, cost 0.1209 usd\n",
    )

    r = await client.get("/api/model-use", params={"from": "2026-10-25", "to": "2026-10-25"})

    assert (r.status_code, r.json()) == (
        200,
        [
            {
                "day": "2026-10-25",
                "model": "gpt-6-astra",
                "project": "proj",
                "input": 9822,
                "output": 213,
                "cache_write": 0,
                "cache_read": 12032,
                "cost": 0.1209,
                "unpriced": 0,
            }
        ],
    )


async def test_1129_a5_the_route_answers_a_grok_line_the_collector_wrote(
    client: AsyncClient, vault: Path, tmp_path: Path
) -> None:
    source = tmp_path / "grok-sessions"
    # Noon UTC, so the turn's day is the 25th on any clock the suite runs on.
    grok_session(source, grok_turn(stamp=1792929600))
    run(source, vault, CONFIG, date(2026, 10, 25), date(2026, 10, 25), datetime.now(UTC))

    r = await client.get("/api/model-use", params={"from": "2026-10-25", "to": "2026-10-25"})

    assert (r.status_code, r.json()) == (
        200,
        [
            {
                "day": "2026-10-25",
                "model": "grok-4.7",
                "project": "proj",
                "input": 19790,
                "output": 193,
                "cache_write": 1000,
                "cache_read": 1664,
                "cost": 0.0436,
                "unpriced": 0,
            }
        ],
    )


async def test_808_i6_a_bad_date_is_422(client: AsyncClient) -> None:
    r = await client.get("/api/model-use", params={"from": "2026-02-01", "to": "2026-02-30"})

    assert r.status_code == 422


async def test_808_i6_from_after_to_is_400(client: AsyncClient) -> None:
    r = await client.get("/api/model-use", params={"from": "2026-10-26", "to": "2026-10-25"})

    assert r.status_code == 400
