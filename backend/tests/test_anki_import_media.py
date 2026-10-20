from typing import TYPE_CHECKING, Any

import pytest

from backend.tests.anki_build import BASIC, CAT_EXPORT, MP3, PNG, apkg, mark, unhashed
from kasten_backend.routes import anki as anki_routes

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_import_writes_media_beside_each_deck(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 201
    assert response.json()["media"] == 3
    folder = vault / "03 Flashcards"
    assert (folder / "Cats media" / "cat.png").read_bytes() == PNG
    assert (folder / "Cats media" / "purr.mp3").read_bytes() == MP3
    assert (folder / "Pets" / "Cats media" / "cat.png").read_bytes() == PNG
    assert not (folder / "Pets" / "Cats media" / "bad.png").exists()
    cats = (folder / "Cats.md").read_text(encoding="utf-8")
    pets = unhashed((folder / "Pets" / "Cats.md").read_text(encoding="utf-8"))
    assert (
        "![](03%20Flashcards/Cats%20media/cat.png) which cat?::"
        "the tabby ![](03%20Flashcards/Cats%20media/purr.mp3)"
    ) in cats
    assert f"![](03%20Flashcards/Pets/Cats%20media/cat.png) and here?::{mark(2)}\n" in pets
    served = await client.get("/api/assets/03%20Flashcards/Cats%20media/purr.mp3")
    assert served.content == MP3


async def test_import_refuses_media_already_in_the_vault(client: AsyncClient, vault: Path) -> None:
    taken = vault / "03 Flashcards" / "Pets" / "Cats media" / "cat.png"
    taken.parent.mkdir(parents=True)
    taken.write_bytes(b"mine")

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 409
    assert taken.read_bytes() == b"mine"
    assert not (vault / "03 Flashcards" / "Cats.md").exists()
    assert not (vault / "03 Flashcards" / "Cats media").exists()


@pytest.mark.parametrize("name", [f"{'x' * 246}.png", ".hidden.png"], ids=["long", "hidden"])
async def test_import_skips_a_media_name_the_write_would_refuse(
    client: AsyncClient, vault: Path, name: str
) -> None:
    # A name that fits 255 bytes but whose temp beside it, `.{name}.{8 hex}.tmp`,
    # does not; and a hidden name, which no vault path may hold.
    export = apkg(
        notes=((1, BASIC, f'<img src="{name}"> which cat?\x1fthe tabby'),),
        cards=((1, 1, 10, 0),),
        decks=((10, "Cats"),),
        media=((name, PNG),),
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 201
    assert response.json()["media"] == 0
    note = unhashed((vault / "03 Flashcards" / "Cats.md").read_text(encoding="utf-8"))
    assert f"\nwhich cat?::the tabby{mark(1)}\n" in note
    assert not (vault / "03 Flashcards" / "Cats media").exists()


async def test_import_that_fails_partway_leaves_no_media_behind(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = anki_routes.store
    calls = 0

    async def second_fails(*args: Any, **kwargs: Any) -> str:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("disk full")
        return await real(*args, **kwargs)

    monkeypatch.setattr(anki_routes, "store", second_fails)

    with pytest.raises(OSError, match="disk full"):
        await client.post("/api/anki", content=CAT_EXPORT)

    folder = vault / "03 Flashcards"
    assert [path for path in folder.rglob("*") if path.is_file()] == []


async def test_a_merge_keeps_media_already_there(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/anki", content=CAT_EXPORT)
    taken = vault / "03 Flashcards" / "Cats media" / "cat.png"
    taken.write_bytes(b"mine")

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 201
    assert response.json()["media"] == 0
    assert taken.read_bytes() == b"mine"
