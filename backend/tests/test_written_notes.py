"""The notes written in a range, with their tags and project, through `GET /api/written/notes`.

The days are the ones `GET /api/written` answers, and a test holds the two to
each other on one vault. Every test goes through the endpoint, so each one fails
on a branch without the route for a reason of its own: a 404, or an assertion
reached.
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


async def test_807_a2_each_note_answers_its_path_day_tags_and_project(
    client: AsyncClient, vault: Path
) -> None:
    write(
        vault,
        "02 Projects/FDE/2026-03-10 Kickoff.md",
        "# Kickoff\n\nTalk about #client and #alpha.\n",
    )

    r = await client.get("/api/written/notes", params={"from": "2026-03-01", "to": "2026-03-31"})

    assert {"status": r.status_code, "notes": r.json()} == {
        "status": 200,
        "notes": [
            {
                "path": "02 Projects/FDE/2026-03-10 Kickoff.md",
                "day": "2026-03-10",
                "tags": ["#alpha", "#client"],
                "project": "02 Projects/FDE",
            }
        ],
    }


async def test_807_a2_the_days_agree_with_written(client: AsyncClient, vault: Path) -> None:
    for name in (
        "2026-03-08 Too early.md",
        "2026-03-09 Day before.md",
        "2026-03-10 In.md",
        "2026-03-12 In.md",
        "2026-03-13 Day after.md",
        "2026-03-14 Too late.md",
    ):
        write(vault, f"Notes/{name}")
    params = {"from": "2026-03-10", "to": "2026-03-12"}

    written = await client.get("/api/written", params=params)
    notes = await client.get("/api/written/notes", params=params)

    assert notes.status_code == 200
    assert {
        "written": written.json(),
        "notes": [note["day"] for note in notes.json()],
    } == {
        "written": ["2026-03-09", "2026-03-10", "2026-03-12", "2026-03-13"],
        "notes": ["2026-03-09", "2026-03-10", "2026-03-12", "2026-03-13"],
    }


async def test_807_a2_a_note_in_the_archive_is_left_out(client: AsyncClient, vault: Path) -> None:
    write(vault, "Notes/2026-03-10 Live.md")
    write(vault, "98 Archive/2026-03-10 Filed.md")

    r = await client.get("/api/written/notes", params={"from": "2026-03-10", "to": "2026-03-10"})

    assert r.status_code == 200
    assert {"status": r.status_code, "paths": [note["path"] for note in r.json()]} == {
        "status": 200,
        "paths": ["Notes/2026-03-10 Live.md"],
    }


async def test_807_a2_tags_are_read_as_search_reads_them(client: AsyncClient, vault: Path) -> None:
    write(
        vault,
        "Notes/2026-03-10 Tags.md",
        "# Tags\n\nWork on #beta/sub and #alpha, then `#code` and #alpha again.\n",
    )

    r = await client.get("/api/written/notes", params={"from": "2026-03-10", "to": "2026-03-10"})

    assert r.status_code == 200
    assert {"status": r.status_code, "tags": r.json()[0]["tags"]} == {
        "status": 200,
        "tags": ["#alpha", "#beta/sub"],
    }


async def test_807_a2_the_project_is_the_first_p_tag_naming_a_folder(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "02 Projects/FDE/Index.md", "# FDE\n")
    write(vault, "Notes/2026-03-10 Call.md", "# Call\n\nPlan with #p/fde today.\n")

    r = await client.get("/api/written/notes", params={"from": "2026-03-10", "to": "2026-03-10"})

    assert r.status_code == 200
    assert {"status": r.status_code, "project": r.json()[0]["project"]} == {
        "status": 200,
        "project": "02 Projects/FDE",
    }


async def test_807_a2_a_p_tag_naming_no_folder_falls_back_to_the_folder(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "02 Projects/FDE/2026-03-10 Kickoff.md", "# Kickoff\n\n#p/nothing\n")

    r = await client.get("/api/written/notes", params={"from": "2026-03-10", "to": "2026-03-10"})

    assert r.status_code == 200
    assert {"status": r.status_code, "project": r.json()[0]["project"]} == {
        "status": 200,
        "project": "02 Projects/FDE",
    }


async def test_807_a2_a_note_in_no_project_has_none(client: AsyncClient, vault: Path) -> None:
    write(vault, "Notes/2026-03-10 Loose.md", "# Loose\n")

    r = await client.get("/api/written/notes", params={"from": "2026-03-10", "to": "2026-03-10"})

    assert r.status_code == 200
    assert {"status": r.status_code, "project": r.json()[0]["project"]} == {
        "status": 200,
        "project": None,
    }


async def test_807_a2_an_edited_note_answers_its_new_tags(client: AsyncClient, vault: Path) -> None:
    note = write(vault, "Notes/2026-03-10 Edit.md", "# Edit\n\n#alpha\n")
    params = {"from": "2026-03-10", "to": "2026-03-10"}
    first = await client.get("/api/written/notes", params=params)
    assert first.status_code == 200
    before = first.json()[0]["tags"]

    # The same size, so only the modification time says the note changed.
    note.write_text("# Edit\n\n#gamma\n", encoding="utf-8")
    set_mtime(note, datetime(2026, 3, 11, 9, 0, tzinfo=UTC))
    second = await client.get("/api/written/notes", params=params)

    assert {"before": before, "after": second.json()[0]["tags"]} == {
        "before": ["#alpha"],
        "after": ["#gamma"],
    }


async def test_807_a2_from_after_to_is_400(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/written/notes", params={"from": "2026-03-11", "to": "2026-03-10"})

    assert r.status_code == 400


async def test_807_a2_an_impossible_day_is_422(client: AsyncClient, vault: Path) -> None:
    r = await client.get("/api/written/notes", params={"from": "2026-02-01", "to": "2026-02-30"})

    assert r.status_code == 422


async def test_807_a2_nothing_is_written(client: AsyncClient, vault: Path) -> None:
    write(vault, "02 Projects/FDE/2026-03-10 Dated.md", "# Dated\n#p/fde\n")
    undated = write(vault, "Notes/Undated.md", "# Undated\n")
    set_mtime(undated, datetime(2026, 3, 5, 12, 0, tzinfo=UTC))
    before = snapshot(vault)

    r = await client.get("/api/written/notes", params={"from": "2026-03-01", "to": "2026-03-31"})

    assert {"status": r.status_code, "unchanged": snapshot(vault) == before} == {
        "status": 200,
        "unchanged": True,
    }
