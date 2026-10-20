"""Importing an Anki deck from a link rather than a file.

The requests never leave the process, the way they do not in `test_fetch.py`:
DNS is stubbed, `httpx.MockTransport` answers for the internet, and the address
tests keep the real transport and stop it at the socket. The one AnkiWeb page
here that was ever on the network is `fixtures/ankiweb/info.html`, recorded once
from a real shared deck; the page with a download link on it is made up, since
AnkiWeb serves none to a server today.
"""

import io
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    from httpx import AsyncClient


PUBLIC = "93.184.215.14"
"""An address on the public internet, which every name resolves to by default."""

BASIC = {
    "1": {
        "name": "Basic",
        "type": 0,
        "flds": [{"name": "Front", "ord": 0}, {"name": "Back", "ord": 1}],
        "tmpls": [
            {"name": "Card 1", "ord": 0, "qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr>{{Back}}"}
        ],
    }
}
"""Anki's Basic note type, the one shape these exports need."""


def apkg(deck: str = "French", *, review: bool = False) -> bytes:
    """A legacy export of one Basic card in `deck`, in review in Anki when `review`.

    Its own small builder rather than `test_anki.apkg`, which pytest's
    importlib mode gives no way to import. That file tests what an export
    turns into; this one only needs one to arrive.
    """
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "collection"
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT)")
            db.execute(
                "CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER,"
                " ord INTEGER, type INTEGER, ivl INTEGER, factor INTEGER, due INTEGER)"
            )
            db.execute("CREATE TABLE col (decks TEXT, models TEXT, crt INTEGER)")
            db.execute("INSERT INTO notes VALUES (1, 1, 'Bonjour\x1fhello')")
            db.execute(
                "INSERT INTO cards VALUES (1, 1, 10, 0, ?, 4, 2500, 10)", (2 if review else 0,)
            )
            db.execute(
                "INSERT INTO col VALUES (?, ?, 1767225600)",
                (json.dumps({"10": {"name": deck}}), json.dumps(BASIC)),
            )
        db.close()
        blob = path.read_bytes()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("collection.anki2", blob)
    return buffer.getvalue()


DECK = apkg()


def deck_file(request: httpx.Request) -> httpx.Response:
    """A server that answers every request with the deck."""
    return httpx.Response(200, content=DECK, headers={"content-type": "application/octet-stream"})


async def link(client: AsyncClient, url: str, **params: str) -> httpx.Response:
    return await client.post("/api/anki/link", json={"url": url}, params=params)
