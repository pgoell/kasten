from datetime import date
from typing import TYPE_CHECKING

from asgi_lifespan import LifespanManager

from kasten_backend.agent_mcp import INSTRUCTIONS, instructions
from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app
from kasten_backend.periodic import daily_note, daily_path

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient

FRIEND = {
    "KASTEN_INBOX_PATH": "Inbox",
    "KASTEN_PERIODIC_PATH": "Journal",
    "KASTEN_ARCHIVE_PATH": "Archive",
    "KASTEN_IMAGES_PATH": "Attachments",
    "KASTEN_CONFIG_PATH": "Meta",
}
"""A vault laid out by somebody else, sharing no folder name with the defaults."""


def friend(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point the process at the layout above, the way an env file would."""
    for name, value in FRIEND.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()


async def test_serves_the_default_layout(client: AsyncClient, vault: Path) -> None:
    response = await client.get("/api/layout")

    assert response.status_code == 200
    assert response.json() == {
        "inbox": "00 Inbox",
        "periodic": "01 Periodic",
        "archive": "98 Archive",
        "images": "99 Misc/02 Assets/01 Images",
        "config": "99 Misc/01 Config",
    }


async def test_serves_the_layout_it_was_given(client: AsyncClient, vault: Path) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        vault_path=vault, inbox_path="Inbox", images_path="Attachments", config_path="Meta"
    )

    response = await client.get("/api/layout")

    assert response.json()["inbox"] == "Inbox"
    assert response.json()["images"] == "Attachments"
    assert response.json()["config"] == "Meta"


async def test_startup_writes_the_guides_into_the_configured_folder(
    startup_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    friend(monkeypatch)

    async with LifespanManager(app):
        pass

    assert not (startup_vault / "99 Misc").exists()
    assert (startup_vault / "Meta/reading-this-vault.md").is_file()
    assert (startup_vault / "Meta/01 Agents/Ontology.md").is_file()
    assert (startup_vault / "Meta/01 Agents/How-To-Exam.md").is_file()
    index = (startup_vault / "Meta/01 Agents/How-To-Index.md").read_text(encoding="utf-8")
    assert "](Meta/reading-this-vault.md)" in index
    assert "](Inbox/)" in index
    todo = (startup_vault / "Meta/01 Agents/How-To-TODO.md").read_text(encoding="utf-8")
    assert "cat 'Journal/00 Daily/2026-08-10.md'" in todo
    assert "01 Periodic" not in todo


async def test_the_instructions_name_the_configured_folders(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    friend(monkeypatch)

    text = instructions()

    assert '"Meta/reading-this-vault.md"' in text
    assert '"Inbox/00 Agent/"' in text
    assert "99 Misc" not in text
    assert "00 Inbox" not in text


def test_the_default_instructions_are_the_ones_served() -> None:
    assert instructions() == INSTRUCTIONS
    assert '"00 Inbox/00 Agent/"' in INSTRUCTIONS


def test_the_daily_note_lives_under_the_configured_folder() -> None:
    day = date(2026, 8, 10)

    assert daily_path(day, "Journal") == "Journal/00 Daily/2026-08-10.md"
    assert "[[Journal/01 Weekly/2026-W33]]" in daily_note(day, "Journal")
    assert "[[Journal/00 Daily/2026-08-09]]" in daily_note(day, "Journal")


async def test_startup_leaves_an_untyped_note_alone_when_told_to(
    startup_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    note = startup_vault / "imported.md"
    note.parent.mkdir(parents=True)
    note.write_text("from another notebook\n", encoding="utf-8")
    monkeypatch.setenv("KASTEN_TYPE_BACKFILL", "false")
    get_settings.cache_clear()

    async with LifespanManager(app):
        pass

    assert note.read_text(encoding="utf-8") == "from another notebook\n"


async def test_startup_types_an_untyped_note_by_default(startup_vault: Path) -> None:
    note = startup_vault / "imported.md"
    note.parent.mkdir(parents=True)
    note.write_text("from another notebook\n", encoding="utf-8")

    async with LifespanManager(app):
        pass

    assert "type: Note" in note.read_text(encoding="utf-8")


async def test_the_dump_lands_in_the_configured_daily_folder(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    friend(monkeypatch)

    response = await client.post(
        "/agent/dump", json={"text": "answer Jonas", "date": "2026-09-29"}, headers=bearer
    )

    assert response.json()["path"] == "Journal/00 Daily/2026-09-29.md"
    assert (agent_vault / "Journal/00 Daily/2026-09-29.md").is_file()
