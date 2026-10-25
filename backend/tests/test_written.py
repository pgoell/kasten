"""The days notes count on through `GET /api/written`, dated the way search dates its hits.

Every test goes through the endpoint, never the module, so each one fails on a
branch without the route for a reason of its own: a 404, or an assertion reached.
"""

import os
from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, name: str, text: str = "# Note\n") -> Path:
    """Write a note at `name` under the vault, with `text` as given."""
    note = vault / name
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")
    return note


def set_mtime(note: Path, moment: datetime) -> None:
    """Give a note the modification time `moment`, which is what a note with no date is dated by."""
    seconds = moment.timestamp()
    os.utime(note, (seconds, seconds))


def snapshot(root: Path) -> dict[str, tuple[bytes, int]]:
    """Every file under `root` with its bytes and its modification time."""
    return {
        str(path): (path.read_bytes(), path.stat().st_mtime_ns)
        for path in root.rglob("*")
        if path.is_file()
    }


async def test_806_a_dated_name_counts_on_its_day(client: AsyncClient, vault: Path) -> None:
    note = write(vault, "Notes/2026-03-10 Meeting.md", "---\ncreated: 2026-03-20\n---\n# Meeting\n")
    set_mtime(note, datetime(2026, 3, 25, tzinfo=UTC))

    r = await client.get("/api/written", params={"from": "2026-03-01", "to": "2026-03-31"})

    assert {"status": r.status_code, "days": r.json()} == {"status": 200, "days": ["2026-03-10"]}


async def test_806_a_created_day_or_instant_answers_as_written(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "Notes/Morning.md", "---\ncreated: 2026-03-12\n---\n# Morning\n")
    write(vault, "Notes/Evening.md", "---\ncreated: 2026-03-14T09:30:00+02:00\n---\n# Evening\n")

    r = await client.get("/api/written", params={"from": "2026-03-01", "to": "2026-03-31"})

    assert {"status": r.status_code, "days": r.json()} == {
        "status": 200,
        "days": ["2026-03-12", "2026-03-14T09:30:00+02:00"],
    }


async def test_806_a_note_with_neither_answers_its_mtime_in_utc(
    client: AsyncClient, vault: Path
) -> None:
    note = write(vault, "Notes/Scratch.md")
    set_mtime(note, datetime(2026, 3, 5, 12, 0, tzinfo=UTC))

    r = await client.get("/api/written", params={"from": "2026-03-01", "to": "2026-03-31"})

    assert {"status": r.status_code, "days": r.json()} == {
        "status": 200,
        "days": ["2026-03-05T12:00:00+00:00"],
    }


async def test_806_the_day_either_side_of_the_range_is_kept(
    client: AsyncClient, vault: Path
) -> None:
    for name in (
        "2026-03-08 Too early.md",
        "2026-03-09 Day before.md",
        "2026-03-10 In.md",
        "2026-03-12 In.md",
        "2026-03-13 Day after.md",
        "2026-03-14 Too late.md",
    ):
        write(vault, f"Notes/{name}")

    r = await client.get("/api/written", params={"from": "2026-03-10", "to": "2026-03-12"})

    assert {"status": r.status_code, "days": r.json()} == {
        "status": 200,
        "days": ["2026-03-09", "2026-03-10", "2026-03-12", "2026-03-13"],
    }


async def test_806_a_note_in_the_archive_is_left_out(client: AsyncClient, vault: Path) -> None:
    write(vault, "Notes/2026-03-10 Live.md")
    write(vault, "98 Archive/2026-03-10 Filed.md")

    r = await client.get("/api/written", params={"from": "2026-03-10", "to": "2026-03-10"})

    assert {"status": r.status_code, "days": r.json()} == {"status": 200, "days": ["2026-03-10"]}


async def test_806_from_after_to_is_400(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/written", params={"from": "2026-03-11", "to": "2026-03-10"})

    assert r.status_code == 400


async def test_806_an_impossible_day_is_422(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/written", params={"from": "2026-02-01", "to": "2026-02-30"})

    assert r.status_code == 422


async def test_806_nothing_is_written(client: AsyncClient, vault: Path) -> None:
    write(vault, "Notes/2026-03-10 Dated.md", "# Dated\n")
    undated = write(vault, "Notes/Undated.md", "# Undated\n")
    set_mtime(undated, datetime(2026, 3, 5, 12, 0, tzinfo=UTC))
    before = snapshot(vault)

    r = await client.get("/api/written", params={"from": "2026-03-01", "to": "2026-03-31"})

    assert {"status": r.status_code, "unchanged": snapshot(vault) == before} == {
        "status": 200,
        "unchanged": True,
    }
