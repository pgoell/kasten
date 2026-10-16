import json
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import JJ, descriptions
from kasten_backend import agent
from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app
from kasten_backend.periodic import daily_note

if TYPE_CHECKING:
    from httpx import AsyncClient

DAY = "01 Periodic/00 Daily/2026-09-29.md"

ID = "0b7e7c1e-3c55-4a8e-9f62-1d2a3b4c5d6e"
"""A capture id the way a phone mints one at typing."""

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


@pytest.fixture
def receipts(vault: Path, tmp_path: Path) -> Path:
    """Where the ids written so far are kept, beside a token store in the test's own dir.

    The `vault` fixture's settings leave `tokens_path` at its cwd-relative
    default, which would put the receipts in the repo. This override replaces
    it, and the `vault` fixture's teardown clears it.
    """
    tokens = tmp_path / "tokens.json"
    app.dependency_overrides[get_settings] = lambda: Settings(vault_path=vault, tokens_path=tokens)
    return tokens.with_name("dump-receipts.json")


def paragraphs(vault: Path, text: str) -> int:
    """How many times `text` stands as a paragraph in the day's note."""
    return body((vault / DAY).read_text()).count(f"\n{text}\n")


def kept(receipts: Path) -> list[str] | None:
    """The ids the receipts file holds, or None when there is no file."""
    return json.loads(receipts.read_text()) if receipts.exists() else None


def seed(receipts: Path, ids: list[str]) -> None:
    """Leave `ids` in the receipts file, as an earlier run of the server would have."""
    receipts.write_text(json.dumps(ids))


async def test_a_retry_with_the_same_id_writes_one_paragraph(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    capture = {"text": "call Jonas", "date": "2026-09-29", "id": ID}

    first = await client.post("/api/dump", json=capture)
    # The answer to the first was lost, so the phone sends it again.
    second = await client.post("/api/dump", json=capture)

    assert second.status_code == 200
    assert second.json() == first.json() == {"path": DAY, "content": (vault / DAY).read_text()}
    assert paragraphs(vault, "call Jonas") == 1


async def test_two_ids_with_the_same_text_write_two_paragraphs(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    other = "5f0c2d1e-9a8b-4c7d-8e6f-0a1b2c3d4e5f"
    await client.post("/api/dump", json={"text": "water", "date": "2026-09-29", "id": ID})
    await client.post("/api/dump", json={"text": "water", "date": "2026-09-29", "id": other})

    assert paragraphs(vault, "water") == 2
    assert kept(receipts) == [ID, other]


async def test_two_captures_without_an_id_write_two_paragraphs(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    # An old client, or the agent's dump, which never sends one.
    for _ in range(2):
        await client.post("/api/dump", json={"text": "water", "date": "2026-09-29"})

    assert paragraphs(vault, "water") == 2
    assert kept(receipts) is None


async def test_the_receipts_are_read_from_disk(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    # Written by an earlier run of the server, which nothing in this process saw.
    seed(receipts, [ID])
    (vault / DAY).parent.mkdir(parents=True)
    (vault / DAY).write_text("# today\n\n## Dump\nfirst\n")

    capture = {"text": "again", "date": "2026-09-29", "id": ID}
    response = await client.post("/api/dump", json=capture)

    assert response.status_code == 200
    assert response.json() == {"path": DAY, "content": "# today\n\n## Dump\nfirst\n"}
    assert (vault / DAY).read_text() == "# today\n\n## Dump\nfirst\n"


async def test_the_receipts_keep_the_last_thousand_ids(
    client: AsyncClient, vault: Path, receipts: Path
) -> None:
    seed(receipts, [f"old-{n}" for n in range(1000)])

    await client.post("/api/dump", json={"text": "new", "date": "2026-09-29", "id": ID})

    assert kept(receipts) == [*(f"old-{n}" for n in range(1, 1000)), ID]


async def test_a_failed_write_leaves_no_receipt(
    client: AsyncClient, vault: Path, receipts: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_: object) -> None:
        raise OSError("disk full")

    capture = {"text": "call Jonas", "date": "2026-09-29", "id": ID}
    with monkeypatch.context() as patch:
        patch.setattr(agent, "create_note", refuse)
        with pytest.raises(OSError, match="disk full"):
            await client.post("/api/dump", json=capture)

    assert kept(receipts) is None

    await client.post("/api/dump", json=capture)

    assert paragraphs(vault, "call Jonas") == 1
    assert kept(receipts) == [ID]


def spoil(receipts: Path, text: str) -> None:
    """Leave `text` in the receipts file, which no receipt write would have left."""
    receipts.write_text(text)


@pytest.mark.parametrize("text", ["{", "{}", "[1, 2]"])
async def test_a_corrupt_receipts_file_reads_as_none(
    client: AsyncClient, vault: Path, receipts: Path, text: str
) -> None:
    spoil(receipts, text)

    response = await client.post(
        "/api/dump", json={"text": "call Jonas", "date": "2026-09-29", "id": ID}
    )

    assert response.status_code == 200
    assert paragraphs(vault, "call Jonas") == 1
    # The next receipt write replaces what could not be read.
    assert kept(receipts) == [ID]


async def test_a_failed_receipt_write_still_answers_with_the_note(
    client: AsyncClient, vault: Path, receipts: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_: object) -> None:
        raise OSError("read-only")

    monkeypatch.setattr(agent, "_receipt", refuse)

    response = await client.post(
        "/api/dump", json={"text": "call Jonas", "date": "2026-09-29", "id": ID}
    )

    # The paragraph landed, so the phone must hear so and drop the record.
    assert response.status_code == 200
    assert response.json() == {"path": DAY, "content": (vault / DAY).read_text()}
    assert paragraphs(vault, "call Jonas") == 1


async def test_only_the_browser_capture_takes_an_id(client: AsyncClient) -> None:
    schema = (await client.get("/openapi.json")).json()

    def properties(route: str) -> dict[str, object]:
        body = schema["paths"][route]["post"]["requestBody"]["content"]["application/json"]
        name = body["schema"]["$ref"].rsplit("/", 1)[1]
        return schema["components"]["schemas"][name]["properties"]

    assert "id" in properties("/api/dump")
    assert "id" not in properties("/agent/dump")
