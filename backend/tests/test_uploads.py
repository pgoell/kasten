"""A file sent in pieces through `/api/uploads`, and the two routes that finish one.

Every test goes through HTTP and imports nothing from `uploads.py`, so each one
fails on a status or a body against a backend that has no such routes. The
fetch cap is lowered rather than a 100MB file written, which is what a file
over it proves just as well.
"""

import asyncio
import hashlib
import io
import json
import os
import sqlite3
import tempfile
import time
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from kasten_backend import files
from kasten_backend.main import app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

GIB = 1024 * 1024 * 1024

PDF = b"%PDF-1.7\n" + bytes(range(256)) * 40
"""A pdf by its magic, ten kilobytes, with no two neighbouring pieces alike."""

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


def apkg() -> bytes:
    """A legacy export of one Basic card in the deck `French`.

    A copy of `test_anki_link.apkg`, which pytest's importlib mode gives no
    way to import.
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
            db.execute("INSERT INTO cards VALUES (1, 1, 10, 0, 0, 0, 0, 0)")
            db.execute(
                "INSERT INTO col VALUES (?, ?, 1767225600)",
                (json.dumps({"10": {"name": "French"}}), json.dumps(BASIC)),
            )
        db.close()
        blob = path.read_bytes()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr("collection.anki2", blob)
    return buffer.getvalue()


async def start(client: AsyncClient, size: int) -> str:
    started = await client.post("/api/uploads", json={"size": size})
    assert started.status_code == 201
    return started.json()["id"]


async def send(client: AsyncClient, data: bytes, piece: int) -> str:
    """Start an upload of `data` and send it in pieces of `piece` bytes, in order."""
    key = await start(client, len(data))
    for n, at in enumerate(range(0, len(data), piece)):
        put = await client.put(f"/api/uploads/{key}/{n}", content=data[at : at + piece])
        assert put.status_code == 204
    return key


async def chunked(*chunks: bytes) -> AsyncIterator[bytes]:
    """A body that hands the loop over between chunks, so two of them can take turns.

    `sleep(0)` waits for nothing: it lets every other ready task run one step,
    which a plain generator never does, `ASGITransport` pulling it straight
    through. Twenty steps, because a request takes several to reach the route.
    """
    for chunk in chunks:
        yield chunk
        for _ in range(20):
            await asyncio.sleep(0)


async def broken(chunk: bytes) -> AsyncIterator[bytes]:
    """A body that sends `chunk` and then breaks off, as a dropped connection does."""
    yield chunk
    raise ConnectionResetError("The line dropped")


async def test_a_deck_over_the_fetch_cap_imports_through_parts(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    deck = apkg()
    monkeypatch.setattr(files, "ASSET_LIMIT_BYTES", len(deck) // 2)
    key = await send(client, deck, len(deck) // 3 + 1)

    response = await client.post("/api/anki", params={"upload": key})

    assert response.status_code == 201
    assert response.json()["notes"] == ["03 Flashcards/French.md"]
    assert "Bonjour::hello" in (vault / "03 Flashcards" / "French.md").read_text(encoding="utf-8")


async def test_a_pdf_over_the_fetch_cap_lands_through_parts(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "ASSET_LIMIT_BYTES", 1024)
    key = await send(client, PDF, 4000)

    response = await client.post("/api/assets/books/Big.pdf", params={"upload": key})

    assert response.status_code == 201
    assert (vault / "books" / "Big.pdf").read_bytes() == PDF


async def test_an_upload_may_weigh_one_gib_and_no_more(client: AsyncClient, vault: Path) -> None:
    taken = await client.post("/api/uploads", json={"size": GIB})
    refused = await client.post("/api/uploads", json={"size": GIB + 1})

    assert taken.status_code == 201
    assert refused.status_code == 413


async def test_an_upload_of_nothing_is_refused(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/uploads", json={"size": 0})

    assert response.status_code == 400
    assert response.json()["detail"] == "An upload needs a size of at least one byte"


async def test_a_refusal_over_the_cap_names_the_limit(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    declared = await client.post("/api/uploads", json={"size": GIB + 1})
    # `raising=False`, so the lowered cap reads as a refusal and not as an
    # error on a backend that has no such cap.
    monkeypatch.setattr(files, "UPLOAD_LIMIT_BYTES", 1024 * 1024, raising=False)
    sent = await client.post("/api/assets/books/Big.pdf", content=b"%PDF-" + bytes(1024 * 1024))

    assert declared.status_code == 413
    assert declared.json()["detail"] == "That file is over the 1 GiB limit"
    assert sent.status_code == 413
    assert sent.json()["detail"] == "That file is over the 1 MiB limit"
    assert not (vault / "books" / "Big.pdf").exists()


async def test_a_piece_out_of_turn_is_refused(client: AsyncClient, vault: Path) -> None:
    key = await start(client, 10)

    response = await client.put(f"/api/uploads/{key}/1", content=b"x" * 5)

    assert response.status_code == 409
    assert response.json()["detail"] == "Piece 1 is out of turn: the next is piece 0"


async def test_a_piece_past_the_declared_size_is_refused_and_cut_back(
    client: AsyncClient, vault: Path
) -> None:
    key = await start(client, 10)

    over = await client.put(f"/api/uploads/{key}/0", content=b"%PDF-" + b"x" * 6)
    fits = await client.put(f"/api/uploads/{key}/0", content=b"%PDF-" + b"y" * 5)
    finished = await client.post("/api/assets/books/Small.pdf", params={"upload": key})

    assert over.status_code == 413
    assert over.json()["detail"] == "That piece runs past the size the upload declared"
    assert fits.status_code == 204
    assert finished.status_code == 201
    assert (vault / "books" / "Small.pdf").read_bytes() == b"%PDF-yyyyy"


async def test_a_piece_that_breaks_off_is_sent_again_whole(
    client: AsyncClient, vault: Path
) -> None:
    key = await start(client, len(PDF))
    first = await client.put(f"/api/uploads/{key}/0", content=PDF[:4000])

    with pytest.raises(ConnectionResetError):
        await client.put(f"/api/uploads/{key}/1", content=broken(PDF[4000:6000]))
    again = await client.put(f"/api/uploads/{key}/1", content=PDF[4000:8000])
    last = await client.put(f"/api/uploads/{key}/2", content=PDF[8000:])
    finished = await client.post("/api/assets/books/Whole.pdf", params={"upload": key})

    assert [first.status_code, again.status_code, last.status_code] == [204, 204, 204]
    assert finished.status_code == 201
    landed = (vault / "books" / "Whole.pdf").read_bytes()
    assert hashlib.sha256(landed).hexdigest() == hashlib.sha256(PDF).hexdigest()


async def test_the_last_piece_sent_again_replaces_itself(client: AsyncClient, vault: Path) -> None:
    key = await start(client, len(PDF))
    await client.put(f"/api/uploads/{key}/0", content=PDF[:4000])
    await client.put(f"/api/uploads/{key}/1", content=b"x" * 4000)

    again = await client.put(f"/api/uploads/{key}/1", content=PDF[4000:8000])
    await client.put(f"/api/uploads/{key}/2", content=PDF[8000:])
    finished = await client.post("/api/assets/books/Again.pdf", params={"upload": key})

    assert again.status_code == 204
    assert finished.status_code == 201
    assert (vault / "books" / "Again.pdf").read_bytes() == PDF


async def test_an_idle_upload_is_swept_by_the_next_one(
    client: AsyncClient, vault: Path, tmp_path: Path
) -> None:
    idle = await start(client, 10)
    live = await start(client, 10)
    await client.put(f"/api/uploads/{idle}/0", content=b"x" * 5)
    await client.put(f"/api/uploads/{live}/0", content=b"x" * 5)
    over_an_hour = time.time() - 3601
    os.utime(tmp_path / "uploads" / idle, (over_an_hour, over_an_hour))

    await start(client, 10)
    gone = await client.put(f"/api/uploads/{idle}/1", content=b"x" * 5)
    kept = await client.put(f"/api/uploads/{live}/1", content=b"x" * 5)

    assert gone.status_code == 404
    assert gone.json()["detail"] == "No such upload"
    assert not (tmp_path / "uploads" / idle).exists()
    assert kept.status_code == 204


async def test_finishing_onto_a_taken_path_is_refused(client: AsyncClient, vault: Path) -> None:
    (vault / "books").mkdir()
    (vault / "books" / "Taken.pdf").write_bytes(b"%PDF-1.4 the first")
    key = await send(client, PDF, 4000)

    response = await client.post("/api/assets/books/Taken.pdf", params={"upload": key})

    assert response.status_code == 409
    assert response.json()["detail"] == "Something is already there"
    assert (vault / "books" / "Taken.pdf").read_bytes() == b"%PDF-1.4 the first"


@pytest.mark.parametrize("route", ["/api/assets/books/Short.pdf", "/api/anki"])
async def test_finishing_short_of_the_size_is_refused(
    client: AsyncClient, vault: Path, route: str
) -> None:
    key = await start(client, len(PDF))
    await client.put(f"/api/uploads/{key}/0", content=PDF[:4000])

    response = await client.post(route, params={"upload": key})

    assert response.status_code == 409
    assert response.json()["detail"] == "That upload is not finished"
    assert not (vault / "books").exists()
    assert not (vault / "03 Flashcards").exists()


@pytest.mark.parametrize(
    ("method", "route"),
    [
        ("PUT", "/api/uploads/0123abcd/0"),
        ("POST", "/api/anki?upload=0123abcd"),
        ("POST", "/api/assets/books/Gone.pdf?upload=0123abcd"),
    ],
    ids=["piece", "anki", "asset"],
)
async def test_an_unknown_upload_is_refused(
    client: AsyncClient, vault: Path, method: str, route: str
) -> None:
    response = await client.request(method, route, content=b"")

    assert response.status_code == 404
    assert response.json()["detail"] == "No such upload"


async def test_the_temp_is_gone_after_a_finish_landed_or_refused(
    client: AsyncClient, vault: Path, tmp_path: Path
) -> None:
    landed = await send(client, PDF, 4000)
    refused = await send(client, PDF, 4000)

    first = await client.post("/api/assets/books/Landed.pdf", params={"upload": landed})
    second = await client.post("/api/assets/books/Refused.epub", params={"upload": refused})
    again = await client.put(f"/api/uploads/{landed}/2", content=PDF[8000:])

    assert first.status_code == 201
    assert second.status_code == 400
    assert list((tmp_path / "uploads").iterdir()) == []
    assert again.status_code == 404


async def test_a_joined_pdf_named_epub_is_refused(client: AsyncClient, vault: Path) -> None:
    key = await send(client, PDF, 4000)

    response = await client.post("/api/assets/books/Book.epub", params={"upload": key})

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert not (vault / "books" / "Book.epub").exists()


async def test_two_pieces_at_once_do_not_interleave(client: AsyncClient, vault: Path) -> None:
    # The same piece twice, the second a resend. Without a lock between them
    # the second starts while the first is half written, both count as piece
    # 0, and the piece after them lands over the start of the file.
    one = [b"%PDF-" + b"a" * 9995, b"a" * 10000, b"a" * 10000]
    other = [b"%PDF-" + b"b" * 14995, b"b" * 15000]
    key = await start(client, 30000 + len(PDF))

    sent = await asyncio.gather(
        client.put(f"/api/uploads/{key}/0", content=chunked(*one)),
        client.put(f"/api/uploads/{key}/0", content=chunked(*other)),
    )
    rest = await client.put(f"/api/uploads/{key}/1", content=PDF)
    finished = await client.post("/api/assets/books/Both.pdf", params={"upload": key})

    assert [response.status_code for response in sent] == [204, 204]
    assert rest.status_code == 204
    assert finished.status_code == 201
    landed = (vault / "books" / "Both.pdf").read_bytes()
    assert landed in (b"".join(one) + PDF, b"".join(other) + PDF)


async def test_the_upload_folder_is_outside_the_vault_and_wiped_at_start(
    tmp_path: Path, startup_vault: Path
) -> None:
    folder = tmp_path / "uploads"
    folder.mkdir()
    (folder / "left-by-a-crash").write_bytes(b"x")

    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        wiped = list(folder.iterdir())
        key = await start(client, 10)

    assert wiped == []
    assert list(folder.iterdir()) == [folder / key]
    assert not folder.is_relative_to(startup_vault)
