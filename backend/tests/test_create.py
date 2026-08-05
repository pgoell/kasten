from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_creates_a_note_at_the_vault_root(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/index.md")

    assert response.status_code == 201
    assert response.json() == {"path": "index.md", "content": ""}
    assert (vault / "index.md").read_text() == ""


async def test_creates_a_note_inside_a_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "daily").mkdir()

    response = await client.post("/api/files/daily/2026-08-05.md")

    assert response.status_code == 201
    assert response.json() == {"path": "daily/2026-08-05.md", "content": ""}
    assert (vault / "daily" / "2026-08-05.md").read_text() == ""


async def test_refuses_to_write_over_a_note_that_is_there(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.post("/api/files/index.md")

    assert response.status_code == 409
    assert (vault / "index.md").read_text() == "# index"


async def test_lists_the_note_it_created(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/files/index.md")
    response = await client.get("/api/files")

    assert response.json() == ["index.md"]


async def test_makes_the_folders_on_the_way(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/reading/2026/borges.md")

    assert response.status_code == 201
    assert response.json() == {"path": "reading/2026/borges.md", "content": ""}
    assert (vault / "reading" / "2026").is_dir()
    assert (vault / "reading" / "2026" / "borges.md").read_text() == ""


async def test_answers_with_the_canonical_path_not_the_url_spelling(
    client: AsyncClient, vault: Path
) -> None:
    # The client navigates to what comes back, so `ideas/../kasten.md` must not
    # end up in `?note=`.
    response = await client.post("/api/files/ideas%2F..%2Fkasten.md")

    assert response.status_code == 201
    assert response.json() == {"path": "kasten.md", "content": ""}
    assert (vault / "kasten.md").read_text() == ""


async def test_refuses_a_note_inside_a_file(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.post("/api/files/index.md/nested.md")

    assert response.status_code == 400
    assert (vault / "index.md").read_text() == "# index"


async def test_refuses_a_symlink_loop_rather_than_raising(client: AsyncClient, vault: Path) -> None:
    # A loop is the one link `resolve` cannot follow, and it hands the path back
    # still a link, which the write then raises on.
    (vault / "a.md").symlink_to(vault / "b.md")
    (vault / "b.md").symlink_to(vault / "a.md")

    response = await client.post("/api/files/a.md")

    assert response.status_code == 400
    assert not (vault / "a.md").is_file()


async def test_refuses_to_climb_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    response = await client.post("/api/files/%2E%2E%2Fsecret.md")

    assert response.status_code == 400
    assert not (vault.parent / "secret.md").exists()


async def test_refuses_an_absolute_path(client: AsyncClient, vault: Path) -> None:
    response = await client.post(f"/api/files/{vault.parent}/secret.md")

    assert response.status_code == 400
    assert not (vault.parent / "secret.md").exists()


async def test_refuses_a_symlink_that_points_out_of_the_vault(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "innocent.md").symlink_to(vault.parent / "secret.md")

    response = await client.post("/api/files/innocent.md")

    assert response.status_code == 400
    assert not (vault.parent / "secret.md").exists()


async def test_refuses_a_name_that_is_not_markdown(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/notes.txt")

    assert response.status_code == 400
    assert not (vault / "notes.txt").exists()


async def test_refuses_a_hidden_name(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/files/.obsidian.md")

    assert response.status_code == 400
    assert not (vault / ".obsidian.md").exists()


async def test_refuses_a_null_byte_rather_than_raising(client: AsyncClient, vault: Path) -> None:
    # Every filesystem call raises on an embedded null, which would turn a
    # hostile path into a 500. There is no name to check, so check the vault.
    response = await client.post("/api/files/%00note.md")

    assert response.status_code == 400
    # The rule below guards against stalling an event loop, and a test reading
    # one throwaway directory has no loop worth protecting.
    assert list(vault.iterdir()) == []  # noqa: ASYNC240
