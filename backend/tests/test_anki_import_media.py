import re
import signal
import subprocess
import sys
from typing import TYPE_CHECKING, Any

import pytest

from backend.tests.anki_build import BASIC, CAT_EXPORT, MP3, PNG, apkg, mark, unhashed
from kasten_backend.anki import route as anki_routes

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


async def test_import_writes_media_named_near_the_limit(client: AsyncClient, vault: Path) -> None:
    # Its temp, 14 bytes longer, once ran past the filesystem's 255 bytes (#1278).
    name = f"{'x' * 251}.png"
    export = apkg(
        notes=((1, BASIC, f'<img src="{name}"> which cat?\x1fthe tabby'),),
        cards=((1, 1, 10, 0),),
        decks=((10, "Cats"),),
        media=((name, PNG),),
    )

    response = await client.post("/api/anki", content=export)

    assert response.status_code == 201
    assert response.json()["media"] == 1
    assert (vault / "03 Flashcards" / "Cats media" / name).read_bytes() == PNG


@pytest.mark.parametrize("name", [f"{'x' * 252}.png", ".hidden.png"], ids=["long", "hidden"])
async def test_import_skips_a_media_name_the_write_would_refuse(
    client: AsyncClient, vault: Path, name: str
) -> None:
    # A name over the filesystem's 255 bytes, and a hidden name, which no vault path may hold.
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


# Runs the import in a child that SIGKILLs itself at a write, so no `finally` takes it back (#1311).
KILLED = """
import asyncio, os, pathlib, signal, sys
from kasten_backend.config import Settings
from kasten_backend.anki import route as anki

vault, export, point, nth = sys.argv[1:]
calls = 0

def kill_on(nth):
    global calls
    calls += 1
    if calls == int(nth):
        os.kill(os.getpid(), signal.SIGKILL)

real_store, real_create, real_write = anki.store, anki.create_note, pathlib.Path.write_text

async def store(*args, **kwargs):
    if point == "store":
        kill_on(nth)
    return await real_store(*args, **kwargs)

def create_note(*args, **kwargs):
    if point == "note":
        kill_on(nth)
    return real_create(*args, **kwargs)

def write_text(self, data, *args, **kwargs):
    if point == "cut" and ".md" in self.name and "index.md" not in self.name:
        real_write(self, data[: len(data) // 2], *args, **kwargs)
        os.kill(os.getpid(), signal.SIGKILL)
    return real_write(self, data, *args, **kwargs)

anki.store, anki.create_note, pathlib.Path.write_text = store, create_note, write_text
root = pathlib.Path(vault)
settings = Settings(vault_path=root, text_cache_path=root.parent / "text-cache")
data = pathlib.Path(export).read_bytes()
asyncio.run(anki._import_bytes(data, settings, carry=False, limit=len(data)))
"""


def killed_import(vault: Path, export: bytes, point: str, nth: int) -> None:
    sent = vault.parent / "export.apkg"
    sent.write_bytes(export)
    child = subprocess.run(  # noqa: S603
        [sys.executable, "-c", KILLED, str(vault), str(sent), point, str(nth)],
        capture_output=True,
        timeout=60,
        check=False,
    )
    assert child.returncode == -signal.SIGKILL, child.stderr.decode()


def tree(root: Path) -> dict[str, bytes]:
    """Every file under `root`, hidden ones too, a note's block and marker hashes left out."""
    found: dict[str, bytes] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            data = path.read_bytes()
            if path.suffix == ".md":
                data = re.sub(r"^---\n.*?\n---\n", "", unhashed(data.decode()), flags=re.S).encode()
            found[str(path.relative_to(root))] = data
    return found


def emptied(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        path.unlink() if path.is_file() else path.rmdir()


@pytest.mark.parametrize(
    ("point", "nth"),
    [("store", 2), ("note", 1), ("note", 2), ("cut", 1)],
    ids=["after-first-media", "after-all-media", "after-first-note", "mid-note"],
)
async def test_the_retry_of_an_import_killed_mid_write_imports_in_full(
    client: AsyncClient, vault: Path, point: str, nth: int
) -> None:
    await client.post("/api/anki", content=CAT_EXPORT)
    expected = tree(vault)
    emptied(vault)
    killed_import(vault, CAT_EXPORT, point, nth)
    partway = tree(vault)

    retry = await client.post("/api/anki", content=CAT_EXPORT)

    assert partway not in ({}, expected)
    assert retry.status_code == 201, retry.text
    assert tree(vault) == expected


async def test_the_retry_of_a_killed_import_never_overwrites_media_whose_bytes_differ(
    client: AsyncClient, vault: Path
) -> None:
    killed_import(vault, CAT_EXPORT, "note", 1)
    changed = vault / "03 Flashcards" / "Cats media" / "purr.mp3"
    changed.write_bytes(b"mine")

    retry = await client.post("/api/anki", content=CAT_EXPORT)

    assert retry.status_code == 409
    assert retry.json() == {"detail": "03 Flashcards/Cats media/purr.mp3 is already in the vault"}
    assert changed.read_bytes() == b"mine"
    assert not (vault / "03 Flashcards" / "Cats.md").exists()


async def test_a_folder_at_a_media_path_is_still_refused(client: AsyncClient, vault: Path) -> None:
    (vault / "03 Flashcards" / "Cats media" / "cat.png").mkdir(parents=True)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 409
    assert not (vault / "03 Flashcards" / "Cats.md").exists()


async def test_a_retry_that_fails_keeps_the_media_it_adopted(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    killed_import(vault, CAT_EXPORT, "store", 3)
    adopted = tree(vault)

    async def fails(*_: Any, **__: Any) -> str:
        raise OSError("disk full")

    monkeypatch.setattr(anki_routes, "store", fails)

    with pytest.raises(OSError, match="disk full"):
        await client.post("/api/anki", content=CAT_EXPORT)

    assert tree(vault) == adopted
    monkeypatch.undo()
    retry = await client.post("/api/anki", content=CAT_EXPORT)
    assert retry.status_code == 201
    assert retry.json()["media"] == 1
