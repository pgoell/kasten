from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_lists_markdown_files_as_sorted_relative_paths(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# index")
    (vault / "daily").mkdir()
    (vault / "daily" / "2026-08-05.md").write_text("# today")

    response = await client.get("/api/files")

    assert response.status_code == 200
    assert response.json() == ["daily/2026-08-05.md", "index.md"]


async def test_ignores_files_that_are_not_markdown(client: AsyncClient, vault: Path) -> None:
    (vault / "note.md").write_text("# note")
    (vault / "image.png").write_bytes(b"")
    (vault / "notes.txt").write_text("plain")

    response = await client.get("/api/files")

    assert response.json() == ["note.md"]


async def test_ignores_hidden_files_and_directories(client: AsyncClient, vault: Path) -> None:
    (vault / "note.md").write_text("# note")
    (vault / ".obsidian.md").write_text("# hidden")
    (vault / ".git").mkdir()
    (vault / ".git" / "COMMIT_EDITMSG.md").write_text("# internals")

    response = await client.get("/api/files")

    assert response.json() == ["note.md"]


async def test_reports_an_empty_vault_when_the_directory_is_missing(
    client: AsyncClient, missing_vault: Path
) -> None:
    # A fresh checkout that has not created the vault yet must still serve.
    response = await client.get("/api/files")

    assert response.status_code == 200
    assert response.json() == []
