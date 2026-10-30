import asyncio
import threading
from typing import TYPE_CHECKING

import pytest

from backend.tests.anki_build import BASIC, CAT_EXPORT, apkg
from kasten_backend import ankiweb, files
from kasten_backend.routes import anki as anki_routes

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from httpx import AsyncClient

    from kasten_backend.anki_deck import Deck


def counted(*chunks: bytes) -> tuple[AsyncIterator[bytes], list[int]]:
    """A body httpx pulls one chunk at a time, and a list recording how many it pulled."""
    pulled = [0]

    async def body() -> AsyncIterator[bytes]:
        for chunk in chunks:
            pulled[0] += 1
            yield chunk

    return body(), pulled


async def test_refuses_a_body_over_the_cap_before_reading_it_all(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "UPLOAD_LIMIT_BYTES", 32)
    # Sixteen bytes at a time crosses 32 on the third chunk, so three is the
    # exact number a handler that stops the moment the count passes the cap
    # pulls. A handler that reads the whole body first pulls all twenty.
    body, pulled = counted(*[b"PK\x03\x04" + b"x" * 12] * 20)

    response = await client.post("/api/anki", content=body)

    assert response.status_code == 413
    assert response.json()["detail"] == "That file is over the 32 byte limit"
    assert pulled == [3]
    assert not (vault / "03 Flashcards").exists()


async def test_an_import_after_a_refusal_over_the_cap_lands(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = files.UPLOAD_LIMIT_BYTES
    monkeypatch.setattr(files, "UPLOAD_LIMIT_BYTES", 32)
    body, _ = counted(*[b"PK\x03\x04" + b"x" * 12] * 20)
    refused = await client.post("/api/anki", content=body)
    monkeypatch.setattr(files, "UPLOAD_LIMIT_BYTES", before)
    export = apkg(notes=((1, BASIC, "a\x1fb"),), cards=((1, 1, 10, 0),), decks=((10, "AWS"),))

    response = await client.post("/api/anki", content=export)

    assert refused.status_code == 413
    assert response.status_code == 201
    assert (vault / "03 Flashcards" / "AWS.md").exists()


@pytest.mark.parametrize("way", ["file", "link"])
async def test_a8_an_import_leaves_the_server_answering_while_it_reads(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch, way: str
) -> None:
    started, release = threading.Event(), threading.Event()
    released: list[bool] = []

    def held(*args: object, **kwargs: object) -> list[Deck]:
        started.set()
        # Times out rather than hangs when the read blocks the event loop,
        # since then nothing can answer the request that would release it.
        released.append(release.wait(3))
        return []

    async def fetched(url: str) -> bytes:
        return CAT_EXPORT

    monkeypatch.setattr(anki_routes, "read_apkg", held)
    monkeypatch.setattr(ankiweb, "fetch_deck", fetched)
    importing = asyncio.create_task(
        client.post("/api/anki", content=CAT_EXPORT)
        if way == "file"
        else client.post("/api/anki/link", json={"url": "https://example.com/deck.apkg"})
    )
    try:
        assert await asyncio.to_thread(started.wait, 5)
        # A hang ceiling, not a latency bound: a blocked loop never answers at all.
        health = await asyncio.wait_for(client.get("/api/health"), 30)
        assert health.status_code == 200
        assert not importing.done()
    finally:
        release.set()

    assert (await importing).status_code == 201
    assert released == [True]
