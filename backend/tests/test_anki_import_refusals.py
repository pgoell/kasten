import sqlite3
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from backend.tests.anki_build import legacy_type, sqlite3_bytes, zipped

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
