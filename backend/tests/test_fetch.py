"""Reading a web page so the client can turn it into a note.

The one endpoint that goes out to the internet rather than to the vault. It
answers with the page's HTML and the address it finally came from, and does
nothing else with it: the extraction runs in the browser, where defuddle lives.

The requests here never leave the process. `httpx.MockTransport` answers them,
mounted by swapping the client the endpoint builds, so what is tested is the
handling rather than somebody else's website.
"""

from functools import partial
from typing import TYPE_CHECKING

import httpx
import pytest

from kasten_backend import main

if TYPE_CHECKING:
    from collections.abc import Callable

    from httpx import AsyncClient


@pytest.fixture
def answer(monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], None]:
    """Hand back a way to say what the internet replies with.

    The class the endpoint builds is replaced rather than a seam being left in
    the code for this: the fixture the request itself rides on was built before
    the swap, so nothing but the fetch under test picks up the transport.
    """

    def use(handler: Callable) -> None:
        monkeypatch.setattr(
            main.httpx,
            "AsyncClient",
            partial(httpx.AsyncClient, transport=httpx.MockTransport(handler)),
        )

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
