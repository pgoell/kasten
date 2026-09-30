import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import JJ, descriptions
from kasten_backend.periodic import daily_note

if TYPE_CHECKING:
    from httpx import AsyncClient

DAY = "01 Periodic/00 Daily/2026-09-29.md"

FIXTURE = Path(__file__).parents[2] / "frontend" / "tests" / "fixtures" / "daily-notes.json"
"""The daily notes `periodic.ts` must also produce, which its own test reads too."""


def body(text: str) -> str:
    """The note under its frontmatter, which the stamp dates to the second."""
    return text.split("\n---\n", 1)[1]


def test_makes_the_daily_note_the_periodic_key_makes() -> None:
    for day, expected in json.loads(FIXTURE.read_text()).items():
        assert daily_note(date.fromisoformat(day)) == expected


async def test_makes_the_note_where_the_vault_has_none(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/dump", json={"text": "call Jonas", "date": "2026-09-29"})

    assert response.status_code == 200
    written = (vault / DAY).read_text()
    assert response.json() == {"path": DAY, "content": written}
    assert "type: Periodic Note\n" in written
    assert "\nid: " in written
    assert body(written) == (
        "\n# 2026-09-29 Tuesday\n\n"
        "[[01 Periodic/00 Daily/2026-09-28]] | [[01 Periodic/01 Weekly/2026-W40]]"
        " | [[01 Periodic/00 Daily/2026-09-30]]\n\n"
        "## TODOs\n\n## Dump\ncall Jonas\n"
    )


async def test_adds_the_section_at_the_end_of_a_note_without_one(
    client: AsyncClient, vault: Path
) -> None:
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("---\nid: kept\n---\n# today\n\n## TODOs\n- [ ] a\n\n\n")

    await client.post("/api/dump", json={"text": "an idea", "date": "2026-09-29"})

    written = (vault / DAY).read_text()
    assert "id: kept\n" in written
    assert body(written) == "# today\n\n## TODOs\n- [ ] a\n\n## Dump\nan idea\n"


async def test_appends_a_paragraph_before_the_section_after_the_dump(
    client: AsyncClient, vault: Path
) -> None:
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("# today\n\n## Dump\nfirst\n\n## Inbox cleanup\n\nmoved\n")

    await client.post("/api/dump", json={"text": "second\nstill second", "date": "2026-09-29"})

    assert body((vault / DAY).read_text()) == (
        "# today\n\n## Dump\nfirst\n\nsecond\nstill second\n\n## Inbox cleanup\n\nmoved\n"
    )


async def test_appends_at_the_end_when_the_dump_is_last(client: AsyncClient, vault: Path) -> None:
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("# today\n\n## Dump\nfirst\n### a heading inside it\nstill the dump\n")

    await client.post("/api/dump", json={"text": "  trimmed  \n", "date": "2026-09-29"})

    # A `###` is part of what was dumped, so the section runs past it.
    assert body((vault / DAY).read_text()).endswith("still the dump\n\ntrimmed\n")


async def test_writes_into_the_day_the_sender_named(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/dump", json={"text": "late", "date": "2027-01-01"})

    assert (vault / "01 Periodic/00 Daily/2027-01-01.md").is_file()


@pytest.mark.parametrize("text", ["", "   \n\t "])
async def test_refuses_text_with_nothing_in_it(client: AsyncClient, vault: Path, text: str) -> None:
    response = await client.post("/api/dump", json={"text": text, "date": "2026-09-29"})

    assert response.status_code == 422
    assert not (vault / DAY).exists()


async def test_refuses_a_date_that_is_not_one(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/dump", json={"text": "x", "date": "2026-02-30"})

    assert response.status_code == 422


@pytest.mark.skipif(JJ is None, reason="jj is not installed")
async def test_records_the_capture_as_a_change(client: AsyncClient, versioned_vault: Path) -> None:
    await client.post("/api/dump", json={"text": "call Jonas", "date": "2026-09-29"})

    assert descriptions(versioned_vault)[0] == f"vault: {DAY}"
