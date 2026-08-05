from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_reads_a_note_at_the_vault_root(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index\n\nWith a trailing newline.\n")

    response = await client.get("/api/files/index.md")

    assert response.status_code == 200
    assert response.json() == {
        "path": "index.md",
        "content": "# index\n\nWith a trailing newline.\n",
    }


async def test_reads_a_note_inside_a_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "daily").mkdir()
    (vault / "daily" / "2026-08-05.md").write_text("# today")

    response = await client.get("/api/files/daily/2026-08-05.md")

    assert response.status_code == 200
    assert response.json()["content"] == "# today"


async def test_keeps_the_bytes_a_note_was_written_with(client: AsyncClient, vault: Path) -> None:
    # The vault is the source of truth, so what comes back is what is on disk.
    (vault / "unicode.md").write_text("# Grüße\n\nEmdash free, ✅ and 日本語.\n", encoding="utf-8")

    response = await client.get("/api/files/unicode.md")

    assert response.json()["content"] == "# Grüße\n\nEmdash free, ✅ and 日本語.\n"


async def test_reports_a_note_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.get("/api/files/missing.md")

    assert response.status_code == 404


async def test_refuses_to_climb_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    (vault.parent / "secret.md").write_text("# not yours")

    response = await client.get("/api/files/%2E%2E%2Fsecret.md")

    assert response.status_code == 404
    assert "not yours" not in response.text


async def test_refuses_an_absolute_path(client: AsyncClient, vault: Path) -> None:
    (vault.parent / "secret.md").write_text("# not yours")

    response = await client.get(f"/api/files/{vault.parent}/secret.md")

    assert response.status_code == 404
    assert "not yours" not in response.text


async def test_refuses_a_symlink_that_points_out_of_the_vault(
    client: AsyncClient, vault: Path
) -> None:
    (vault.parent / "secret.md").write_text("# not yours")
    (vault / "innocent.md").symlink_to(vault.parent / "secret.md")

    response = await client.get("/api/files/innocent.md")

    assert response.status_code == 404
    assert "not yours" not in response.text


async def test_refuses_a_file_that_is_not_markdown(client: AsyncClient, vault: Path) -> None:
    (vault / "notes.txt").write_text("plain")

    response = await client.get("/api/files/notes.txt")

    assert response.status_code == 404


async def test_refuses_a_hidden_file(client: AsyncClient, vault: Path) -> None:
    # Hidden files stay out of the listing, so they stay unreadable too.
    (vault / ".obsidian.md").write_text("# hidden")

    response = await client.get("/api/files/.obsidian.md")

    assert response.status_code == 404


async def test_refuses_a_null_byte_rather_than_raising(client: AsyncClient, vault: Path) -> None:
    # Every filesystem call raises on an embedded null, which would turn a
    # hostile path into a 500.
    (vault / "note.md").write_text("# note")

    response = await client.get("/api/files/%00note.md")

    assert response.status_code == 404


async def test_refuses_a_directory(client: AsyncClient, vault: Path) -> None:
    (vault / "daily.md").mkdir()

    response = await client.get("/api/files/daily.md")

    assert response.status_code == 404


async def test_still_lists_the_vault_at_the_bare_path(client: AsyncClient, vault: Path) -> None:
    # The read route hangs off the same prefix, so guard the listing against it.
    (vault / "index.md").write_text("# index")

    response = await client.get("/api/files")

    assert response.status_code == 200
    assert response.json() == ["index.md"]
