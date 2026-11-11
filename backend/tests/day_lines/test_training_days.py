"""`POST /api/training/days/{day}`: a job's training lines under the day's `## Training`."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

DAILY = "01 Periodic/00 Daily"
RIDE = "- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131"
WALK = "- 🚶 [[Gehen]] 35 min 2.9 km"


async def test_1720_lines_land_under_training_copies_too(client: AsyncClient, vault: Path) -> None:
    note = vault / DAILY / "2026-11-10.md"
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(
        "# 2026-11-10 Tuesday\n\n## Training\n- 🏋 [[Kniebeuge]] 80 kg 8 8\n\n## Log\n- 💧 500 ml\n",
        encoding="utf-8",
    )

    first = await client.post("/api/training/days/2026-11-10", json={"lines": [RIDE, WALK]})
    # A second ride that reads the same as the first is its own line.
    again = await client.post("/api/training/days/2026-11-10", json={"lines": [RIDE]})

    assert first.status_code == 200
    assert first.json() == {"path": f"{DAILY}/2026-11-10.md", "added": [RIDE, WALK]}
    assert again.json()["added"] == [RIDE]
    text = note.read_text(encoding="utf-8")
    assert f"- 🏋 [[Kniebeuge]] 80 kg 8 8\n{RIDE}\n{WALK}\n{RIDE}\n\n## Log" in text


async def test_1720_a_missing_note_is_made_as_the_daily_key_makes_it(
    client: AsyncClient, vault: Path
) -> None:
    r = await client.post("/api/training/days/2026-11-11", json={"lines": [RIDE]})

    assert r.status_code == 200
    text = (vault / DAILY / "2026-11-11.md").read_text(encoding="utf-8")
    assert "type: Periodic Note" in text
    assert "# 2026-11-11 Wednesday" in text
    assert text.rstrip().endswith(f"## Training\n{RIDE}")


async def test_1720_refuses_a_line_that_is_no_training_line(
    client: AsyncClient, vault: Path
) -> None:
    bad = await client.post("/api/training/days/2026-11-11", json={"lines": [RIDE, "- ride"]})
    split = await client.post("/api/training/days/2026-11-11", json={"lines": [f"{RIDE}\n# x"]})
    no_day = await client.post("/api/training/days/2026-02-30", json={"lines": [RIDE]})

    assert (bad.status_code, split.status_code, no_day.status_code) == (422, 422, 422)
    assert not (vault / DAILY / "2026-11-11.md").exists()
