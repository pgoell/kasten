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


async def test_lists_a_folder_named_like_a_note_as_a_folder(
    client: AsyncClient, vault: Path
) -> None:
    # `resolve_note` refuses a directory, so listing one was a row in the tree
    # that answered 404 when you opened it. What is inside it still lists.
    (vault / "archive.md").mkdir()
    (vault / "archive.md" / "note.md").write_text("# note")

    response = await client.get("/api/files")

    assert response.json() == ["archive.md/note.md"]


async def test_does_not_walk_into_a_symlinked_folder(client: AsyncClient, vault: Path) -> None:
    # A link pointing at an ancestor would otherwise walk forever, and one
    # pointing out of the vault would list what the reads refuse to open.
    (vault / "real").mkdir()
    (vault / "real" / "note.md").write_text("# note")
    (vault / "loop").symlink_to(vault)

    response = await client.get("/api/files")

    assert response.json() == ["real/note.md"]
