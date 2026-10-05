"""Reading a web page so the client can turn it into a note.

The endpoint that goes out to any address on the internet rather than to the
vault. It answers with the page's HTML and the address it finally came from, and does
nothing else with it: the extraction runs in the browser, where defuddle lives.

The requests here never leave the process. `httpx.MockTransport` answers them,
mounted in place of the transport the endpoint builds, so what is tested is the
handling rather than somebody else's website. The address check lives in that
transport, so its tests keep the real one and stop it at the socket instead.
"""

from typing import TYPE_CHECKING

import httpx
import pytest

from kasten_backend import files, main

if TYPE_CHECKING:
    from collections.abc import Callable

    from httpx import AsyncClient


PUBLIC = "93.184.215.14"
"""An address on the public internet, which every name resolves to by default."""


@pytest.fixture(autouse=True)
def resolve(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, list[str]]], None]:
    """Hand back a way to say what a name resolves to, and keep DNS off the network.

    Every name is public unless a test says otherwise, so the tests that are not
    about the address check do not depend on a resolver being reachable.
    """
    table: dict[str, list[str]] = {}

    async def lookup(host: str) -> list[str]:
        return table.get(host, [PUBLIC])

    monkeypatch.setattr(files, "_addresses", lookup)

    return table.update


@pytest.fixture
def answer(monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], None]:
    """Hand back a way to say what the internet replies with.

    The transport `files.reader` builds is replaced, and the client around it
    kept, so the redirect cap and the headers under test are the real ones.
    """

    def use(handler: Callable) -> None:
        monkeypatch.setattr(files, "_PublicTransport", lambda: httpx.MockTransport(handler))

    return use


async def test_answers_with_the_page(client: AsyncClient, answer: Callable) -> None:
    answer(
        lambda request: httpx.Response(
            200, html="<html><body><p>hello</p></body></html>", request=request
        )
    )

    response = await client.get("/api/fetch", params={"url": "https://example.com/post"})

    assert response.status_code == 200
    assert response.json() == {
        "url": "https://example.com/post",
        "html": "<html><body><p>hello</p></body></html>",
    }


async def test_answers_with_the_address_it_ended_at(client: AsyncClient, answer: Callable) -> None:
    """A redirect moves what the page's relative links are relative to.

    The client resolves them against this, so it has to be where the page came
    from and not where the reader pointed.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/post":
            return httpx.Response(301, headers={"location": "https://example.com/2025/post"})
        return httpx.Response(200, html="<html><body><p>hello</p></body></html>")

    answer(handler)

    response = await client.get("/api/fetch", params={"url": "https://example.com/post"})

    assert response.json()["url"] == "https://example.com/2025/post"


@pytest.mark.parametrize(
    "url",
    ["file:///etc/passwd", "ftp://example.com/note.md", "/etc/passwd", "javascript:alert(1)"],
)
async def test_refuses_anything_that_is_not_a_web_address(client: AsyncClient, url: str) -> None:
    """The scheme is the whole rule, and it is checked before anything is opened."""
    response = await client.get("/api/fetch", params={"url": url})

    assert response.status_code == 400


async def test_refuses_what_is_not_a_web_page(client: AsyncClient, answer: Callable) -> None:
    """A PDF is a fine thing to read and not a thing this can turn into markdown."""
    answer(lambda request: httpx.Response(200, headers={"content-type": "application/pdf"}))

    response = await client.get("/api/fetch", params={"url": "https://example.com/paper.pdf"})

    assert response.status_code == 415


async def test_refuses_a_page_too_big_to_read(
    client: AsyncClient, answer: Callable, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Whatever the other end says the length is, the bytes are counted here."""
    monkeypatch.setattr(main, "PAGE_LIMIT_BYTES", 32)
    answer(lambda request: httpx.Response(200, html="<html>" + "x" * 200 + "</html>"))

    response = await client.get("/api/fetch", params={"url": "https://example.com/long"})

    assert response.status_code == 502


async def test_says_when_the_page_could_not_be_read(client: AsyncClient, answer: Callable) -> None:
    """A 404 out there is not a 404 here: the note this was meant to become is
    what the reader asked for, and the address they typed is what failed."""

    answer(lambda request: httpx.Response(404))

    response = await client.get("/api/fetch", params={"url": "https://example.com/gone"})

    assert response.status_code == 502
    assert response.json()["detail"] == "That page answered 404"


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.18.0.3",
        "192.168.1.1",
        "169.254.169.254",
        "100.100.100.100",
        "0.0.0.0",  # noqa: S104  an address to refuse, not one to bind
        "224.0.0.1",
        "240.0.0.1",
        "::1",
        "::",
        "fe80::1",
        "fd00::1",
        "ff02::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
    ],
)
async def test_refuses_an_address_off_the_internet(
    client: AsyncClient, sockets: list[str], resolve: Callable, address: str
) -> None:
    """The backend shares a network with the database and the shell, and the
    clipper is not a way to reach them. No socket opens to such an address."""
    resolve({"inside.example": [address]})

    response = await client.get("/api/fetch", params={"url": "http://inside.example/"})

    assert response.status_code == 400
    assert sockets == []


async def test_refuses_a_name_with_one_private_address_among_public_ones(
    client: AsyncClient, sockets: list[str], resolve: Callable
) -> None:
    """A name with one address inside the box is refused whole."""
    resolve({"mixed.example": [PUBLIC, "127.0.0.1"]})

    response = await client.get("/api/fetch", params={"url": "https://mixed.example/"})

    assert response.status_code == 400
    assert sockets == []


async def test_opens_the_address_it_checked(
    client: AsyncClient, sockets: list[str], resolve: Callable
) -> None:
    """The socket goes to the address the check passed, never the name, so a
    name that answers differently a second time has no second time to answer.
    This is the gap a check made in front of the request left open."""
    resolve({"example.com": [PUBLIC]})

    response = await client.get("/api/fetch", params={"url": "https://example.com/"})

    assert response.status_code == 502
    assert sockets == [PUBLIC]


async def test_refuses_an_address_literal(
    client: AsyncClient, sockets: list[str], resolve: Callable
) -> None:
    """An IP in the address resolves to itself, so it meets the same check."""
    resolve({"::1": ["::1"]})

    response = await client.get("/api/fetch", params={"url": "http://[::1]:8000/api/health"})

    assert response.status_code == 400
    assert sockets == []


async def test_refuses_a_redirect_off_the_internet(
    client: AsyncClient,
    sockets: list[str],
    resolve: Callable,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A public page that points back at the box is the way round a single check.

    The first hop is answered by hand and the second goes to the real transport,
    which is where the check that has to catch it lives.
    """
    real = files._PublicTransport

    class Redirecting(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            if request.url.host == "example.com":
                return httpx.Response(302, headers={"location": "http://postgres:5432/"})
            return await real().handle_async_request(request)

    monkeypatch.setattr(files, "_PublicTransport", Redirecting)
    resolve({"postgres": ["172.18.0.2"]})

    response = await client.get("/api/fetch", params={"url": "https://example.com/post"})

    assert response.status_code == 400
    assert sockets == []


async def test_gives_up_on_a_page_that_redirects_forever(
    client: AsyncClient, answer: Callable
) -> None:
    answer(
        lambda request: httpx.Response(
            302, headers={"location": f"https://example.com/{len(request.url.path)}x"}
        )
    )

    response = await client.get("/api/fetch", params={"url": "https://example.com/"})

    assert response.status_code == 502
    assert response.json()["detail"] == "That page redirects too many times"
