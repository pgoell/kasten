import sqlite3
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from backend.tests.anki_build import BASIC, PNG, apkg, legacy_type, sqlite3_bytes, zipped

if TYPE_CHECKING:
    from httpx import AsyncClient


def legacy_collection(decks: str, flds: object) -> bytes:
    """An old-schema export holding one note whose fields are `flds`, of whatever type."""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "collection"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE notes (id, mid, flds)")
            db.execute("CREATE TABLE cards (id, nid, did, ord)")
            db.execute("CREATE TABLE col (decks, models)")
            db.execute("INSERT INTO notes VALUES (1, 1, ?)", (flds,))
            db.execute("INSERT INTO cards VALUES (1, 1, 1, 0)")
            db.execute("INSERT INTO col VALUES (?, ?)", (decks, legacy_type()))
        db.close()
        return zipped("collection.anki2", path.read_bytes())


@pytest.mark.parametrize(
    "export",
    [
        zipped("collection.anki21b", b"junk"),
        legacy_collection('{"1": {}}', "a"),
        legacy_collection('{"1": {"name": "D"}}', b"a\x1fb"),
        legacy_collection('{"1": {"name": 5}}', "a"),
        zipped(
            "collection.anki21",
            sqlite3_bytes(
                "CREATE TABLE notes (id, mid, flds)",
                "CREATE TABLE cards (id, nid, did, ord)",
                "CREATE TABLE decks (id, name)",
                "CREATE TABLE notetypes (id, name, config)",
                "CREATE TABLE fields (ntid, ord, name)",
                "CREATE TABLE templates (ntid, ord, name, config)",
                "INSERT INTO notes VALUES (1, 1, 'a')",
                "INSERT INTO cards VALUES (1, 1, 1, 0)",
                "INSERT INTO notetypes VALUES (1, 'B', x'')",
                "INSERT INTO fields VALUES (1, 0, 'F')",
                row=("INSERT INTO decks VALUES (1, X'41')", ()),
            ),
        ),
    ],
    ids=[
        "anki21b-not-zstd",
        "deck-without-name",
        "flds-blob",
        "legacy-deck-name-int",
        "deck-name-blob",
    ],
)
async def test_import_refuses_an_export_it_cannot_read(
    client: AsyncClient, vault: Path, export: bytes
) -> None:
    response = await client.post("/api/anki", content=export)

    assert response.status_code == 400
    assert "unreadable" in response.json()["detail"]
    assert not (vault / "03 Flashcards").exists()


ADVICE = "Save it as UTF-8, then import again."
ONE = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))
GROWN = apkg(
    notes=((1, BASIC, "a\x1fb"), (2, BASIC, 'c\x1f<img src="cat.png">')),
    cards=((1, 1, 10, 0), (2, 2, 10, 0)),
    decks=((10, "AWS"),),
    media=(("cat.png", PNG),),
)


def spoiled(vault: Path, name: str) -> Path:
    """The deck note `name` with bytes added that are not UTF-8, as a latin-1 editor leaves it."""
    note = vault / "03 Flashcards" / f"{name}.md"
    note.write_bytes(note.read_bytes() + b"caf\xff\n")
    return note


async def test_an_import_over_a_deck_note_that_is_not_utf8_is_refused_and_kept(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=ONE)
    before = spoiled(vault, "AWS").read_bytes()

    response = await client.post("/api/anki", content=ONE)

    assert response.status_code == 409
    assert response.json()["detail"].endswith(ADVICE)
    assert "03 Flashcards/AWS.md is not UTF-8" in response.json()["detail"]
    assert (vault / "03 Flashcards" / "AWS.md").read_bytes() == before


async def test_a_deck_note_that_is_not_utf8_stops_every_deck_of_the_export(
    client: AsyncClient, vault: Path
) -> None:
    both = apkg(
        notes=((1, BASIC, "a\x1fb"), (2, BASIC, "c\x1fd")),
        decks=((10, "AWS"), (20, "GCP")),
        cards=((1, 1, 10, 0), (2, 2, 20, 0)),
    )
    await client.post("/api/anki", content=both)
    gcp = spoiled(vault, "GCP")
    folder = vault / "03 Flashcards"
    before = {path: path.read_bytes() for path in folder.rglob("*") if path.is_file()}
    grown = apkg(
        notes=((1, BASIC, "a\x1fb"), (3, BASIC, "e\x1ff"), (2, BASIC, "c\x1fd")),
        cards=((1, 1, 10, 0), (3, 3, 10, 0), (2, 2, 20, 0)),
        decks=((10, "AWS"), (20, "GCP")),
    )

    response = await client.post("/api/anki", content=grown)

    assert (response.status_code, gcp.name) == (409, "GCP.md")
    assert {path: path.read_bytes() for path in folder.rglob("*") if path.is_file()} == before


async def test_a_deck_note_saved_as_utf8_again_imports_and_the_refusal_left_no_media(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=ONE)
    note = vault / "03 Flashcards" / "AWS.md"
    clean = note.read_bytes()
    spoiled(vault, "AWS")
    files = sorted(p.name for p in (vault / "03 Flashcards").rglob("*") if p.is_file())

    refused = await client.post("/api/anki", content=GROWN)
    left = sorted(p.name for p in (vault / "03 Flashcards").rglob("*") if p.is_file())
    note.write_bytes(clean)
    landed = await client.post("/api/anki", content=GROWN)

    assert (refused.status_code, left) == (409, files)
    assert "cat.png" not in left
    assert (landed.status_code, landed.json()["media"]) == (201, 1)


async def test_the_move_refusal_keeps_its_words_and_shares_the_advice(
    client: AsyncClient, vault: Path
) -> None:
    await client.post("/api/anki", content=ONE)
    spoiled(vault, "AWS")
    moved = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 20, 0),), decks=((20, "GCP"),))

    move = await client.post("/api/anki", content=moved)
    deck = await client.post("/api/anki", content=ONE)

    assert move.json()["detail"] == (
        "03 Flashcards/AWS.md is not UTF-8, so GCP's cards cannot move out of it. " + ADVICE
    )
    assert deck.json()["detail"].endswith(ADVICE)
