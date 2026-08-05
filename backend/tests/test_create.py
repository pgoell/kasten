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
