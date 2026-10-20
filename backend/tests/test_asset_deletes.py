from typing import TYPE_CHECKING

import pytest

from backend.tests.asset_bodies import BOOK, PDF, PNG

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_takes_an_image_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "99 Misc").mkdir()
    (vault / "99 Misc" / "shot.png").write_bytes(PNG)

    response = await client.delete("/api/assets/99 Misc/shot.png")

    assert response.status_code == 200
    assert response.json()["path"] == "99 Misc/shot.png"
    assert not (vault / "99 Misc" / "shot.png").exists()
    # The folder goes with it, the way a note's delete takes the one it emptied.
    assert not (vault / "99 Misc").exists()
    assert (await client.get("/api/assets/99 Misc/shot.png")).status_code == 404


async def test_puts_a_deleted_image_back(client: AsyncClient, vault: Path) -> None:
    # The restore has no rule of its own for an image: the entry says where it
    # came from, and `resolve_folder_path` takes any legal path.
    (vault / "shot.png").write_bytes(PNG)
    deleted = await client.delete("/api/assets/shot.png")

    response = await client.patch(f"/api/trash/{deleted.json()['entry']}")

    assert response.status_code == 200
    assert (vault / "shot.png").read_bytes() == PNG
    assert (await client.get("/api/assets/shot.png")).status_code == 200


@pytest.mark.parametrize(
    "book",
    [("DDIA.epub", BOOK), ("DDIA.pdf", PDF), ("Plan.PDF", PDF)],
    ids=["epub", "pdf", "upper-case pdf"],
)
async def test_refuses_to_delete_a_book(
    client: AsyncClient, vault: Path, book: tuple[str, bytes]
) -> None:
    # A book travels with the note beside it, and this route decides nothing
    # about that pair. Both formats, because the refusal reads a tuple now and
    # a suffix left out of it is a book the app can delete and never restore.
    name, content = book
    (vault / name).write_bytes(content)

    response = await client.delete(f"/api/assets/{name}")

    assert response.status_code == 404
    assert response.json()["detail"] == "No such image"
    assert (vault / name).exists()


async def test_reports_deleting_an_image_that_is_not_there(
    client: AsyncClient, vault: Path
) -> None:
    response = await client.delete("/api/assets/99 Misc/missing.png")

    assert response.status_code == 404


async def test_refuses_to_delete_a_note_through_the_asset_route(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.delete("/api/assets/index.md")

    assert response.status_code == 404
    assert (vault / "index.md").exists()
