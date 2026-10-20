import asyncio
from typing import TYPE_CHECKING

import httpx
import pytest

from backend.tests.anki_link_web import PUBLIC, deck_file, link
from kasten_backend import files

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable
    from pathlib import Path

    from httpx import AsyncClient

# `resolve` applies to every test here, as its autouse did in the one file. It
# lives in conftest without autouse, so it reaches no test outside these two
# files, and the tests that take it as a parameter do not shadow an import.
pytestmark = pytest.mark.usefixtures("resolve")


async def test_follows_an_https_redirect_to_another_host(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    """A GitHub release asset answers with a 302 to objects.githubusercontent.com."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "github.com":
            return httpx.Response(
                302, headers={"location": "https://objects.githubusercontent.com/x/French.apkg"}
            )
        return deck_file(request)

    answer(handler)

    response = await link(client, "https://github.com/me/decks/releases/download/v1/French.apkg")

    assert response.status_code == 201
    assert (vault / "03 Flashcards" / "French.md").exists()


@pytest.mark.parametrize(
    "url", ["http://example.com/French.apkg", "French.apkg", "file:///etc/passwd", "not a link"]
)
async def test_refuses_a_link_that_is_not_https(
    client: AsyncClient, vault: Path, answer: Callable, url: str
) -> None:
    seen: list[str] = []
    answer(lambda request: seen.append(str(request.url)) or deck_file(request))

    response = await link(client, url)

    assert response.status_code == 400
    assert response.json()["detail"] == "Only https links"
    assert seen == []


async def test_refuses_a_redirect_down_to_http(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.scheme == "https":
            return httpx.Response(302, headers={"location": "http://example.com/French.apkg"})
        return deck_file(request)

    answer(handler)

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 400
    assert response.json()["detail"] == "Only https links"
    assert seen == ["https://example.com/French.apkg"]
    assert not (vault / "03 Flashcards").exists()


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "fd00::1"])
async def test_refuses_an_address_off_the_internet(
    client: AsyncClient, vault: Path, sockets: list[str], resolve: Callable, address: str
) -> None:
    """The real transport, stopped at the socket: no socket opens to such an address."""
    resolve({"inside.example": [address]})

    response = await link(client, "https://inside.example/French.apkg")

    assert response.status_code == 400
    assert response.json()["detail"] == "That address is not on the internet"
    assert sockets == []


async def test_opens_the_address_it_checked(
    client: AsyncClient, vault: Path, sockets: list[str], resolve: Callable
) -> None:
    """The connect goes to the checked address and not the name, so rebinding has no turn."""
    resolve({"decks.example": [PUBLIC]})

    await link(client, "https://decks.example/French.apkg")

    assert sockets == [PUBLIC]


async def test_refuses_a_redirect_off_the_internet(
    client: AsyncClient,
    vault: Path,
    sockets: list[str],
    resolve: Callable,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The first hop answered by hand, the second through the real transport's check."""
    real = files._PublicTransport

    class Redirecting(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.url.host == "example.com":
                return httpx.Response(302, headers={"location": "https://metadata.example/"})
            return await real().handle_async_request(request)

    monkeypatch.setattr(files, "_PublicTransport", Redirecting)
    resolve({"metadata.example": ["169.254.169.254"]})

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 400
    assert sockets == []
    assert not (vault / "03 Flashcards").exists()


class Endless(httpx.AsyncByteStream):
    """A body that never ends, counting the chunks anybody asked it for.

    `upto` ends it after that many, for a test that has to see a reader that
    would have read it all finish rather than hang.
    """

    def __init__(self, upto: int | None = None) -> None:
        self.chunks = 0
        self.upto = upto

    async def __aiter__(self) -> AsyncIterator[bytes]:
        while self.upto is None or self.chunks < self.upto:
            self.chunks += 1
            yield b"PK" + b"x" * 1022


async def test_stops_reading_at_the_cap_whatever_the_length_says(
    client: AsyncClient, vault: Path, answer: Callable, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "ASSET_LIMIT_BYTES", 10 * 1024)
    stream = Endless()
    answer(lambda request: httpx.Response(200, headers={"content-length": "10"}, stream=stream))

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 413
    assert response.json()["detail"] == "That file is over the 10 KiB limit"
    assert stream.chunks == 11
    assert not (vault / "03 Flashcards").exists()


async def test_a_link_keeps_the_100_mib_cap_an_upload_does_not_have(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    # The cap as it ships, not lowered: an upload may weigh 1 GiB, and this
    # is what says a link did not rise with it.
    stream = Endless()
    answer(lambda request: httpx.Response(200, stream=stream))

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 413
    assert response.json()["detail"] == "That file is over the 100 MiB limit"
    assert stream.chunks == 100 * 1024 + 1


async def test_does_not_read_a_redirect_body(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    """httpx reads a 3xx body whole and past any cap, so a redirect's is never read."""
    stream = Endless(upto=1000)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "example.com":
            return httpx.Response(
                302, headers={"location": "https://cdn.example/French.apkg"}, stream=stream
            )
        return deck_file(request)

    answer(handler)

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 201
    assert stream.chunks <= 1


async def test_gives_up_on_a_link_that_redirects_forever(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    answer(lambda request: httpx.Response(302, headers={"location": "/French.apkg"}))

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 502
    assert response.json()["detail"] == "That page redirects too many times"
    assert not (vault / "03 Flashcards").exists()


class Dripping(httpx.AsyncByteStream):
    """A body whose first byte never comes, so only a deadline over the whole fetch ends it."""

    async def __aiter__(self) -> AsyncIterator[bytes]:
        await asyncio.Event().wait()
        yield b""


async def test_gives_up_on_a_fetch_that_takes_too_long(
    client: AsyncClient, vault: Path, answer: Callable, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(files, "DECK_TIMEOUT_SECONDS", 0.05)
    answer(lambda request: httpx.Response(200, stream=Dripping()))

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 504
    assert response.json()["detail"] == "That link took too long to answer"
