"""Importing an Anki deck from a link rather than a file.

The requests never leave the process, the way they do not in `test_fetch.py`:
DNS is stubbed, `httpx.MockTransport` answers for the internet, and the address
tests keep the real transport and stop it at the socket. The one AnkiWeb page
here that was ever on the network is `fixtures/ankiweb/info.html`, recorded once
from a real shared deck; the page with a download link on it is made up, since
AnkiWeb serves none to a server today.
"""

import asyncio
import io
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
import pytest

from kasten_backend import files

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from httpx import AsyncClient


PUBLIC = "93.184.215.14"
"""An address on the public internet, which every name resolves to by default."""

RECORDED = Path(__file__).parent / "fixtures" / "ankiweb" / "info.html"
"""What `https://ankiweb.net/shared/info/2109889812` answered a server on 2026-10-17."""

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


@pytest.fixture(autouse=True)
def resolve(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, list[str]]], None]:
    """Hand back a way to say what a name resolves to, and keep DNS off the network."""
    table: dict[str, list[str]] = {}

    async def lookup(host: str) -> list[str]:
        return table.get(host, [PUBLIC])

    monkeypatch.setattr(files, "_addresses", lookup)

    return table.update


@pytest.fixture
def answer(monkeypatch: pytest.MonkeyPatch) -> Callable[[Callable], None]:
    """Hand back a way to say what the internet replies with, keeping the real client."""

    def use(handler: Callable) -> None:
        monkeypatch.setattr(files, "_PublicTransport", lambda: httpx.MockTransport(handler))

    return use


def deck_file(request: httpx.Request) -> httpx.Response:
    """A server that answers every request with the deck."""
    return httpx.Response(200, content=DECK, headers={"content-type": "application/octet-stream"})


async def link(client: AsyncClient, url: str, **params: str) -> httpx.Response:
    return await client.post("/api/anki/link", json={"url": url}, params=params)


async def test_a_link_to_an_apkg_imports_like_the_file(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    answer(deck_file)

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 201
    assert response.json() == {
        "notes": ["03 Flashcards/French.md"],
        "cards": 1,
        "media": 0,
        "added": 1,
        "updated": 0,
        "kept": 0,
        "removed": 0,
    }
    assert "Bonjour::hello" in (vault / "03 Flashcards" / "French.md").read_text(encoding="utf-8")


async def test_carry_applies_to_a_link(client: AsyncClient, vault: Path, answer: Callable) -> None:
    answer(lambda request: httpx.Response(200, content=apkg("On", review=True)))

    await link(client, "https://example.com/On.apkg", carry="true")

    assert "<!--SR:!2026-01-11,4,250-->" in (vault / "03 Flashcards" / "On.md").read_text(
        encoding="utf-8"
    )


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


@pytest.mark.parametrize(
    ("body", "detail"),
    [
        (b"<!doctype html><p>a blog</p>", "That link is a web page, not an Anki deck"),
        (b"%PDF-1.7", "That link is not an Anki deck"),
    ],
)
async def test_refuses_what_is_not_a_deck(
    client: AsyncClient, vault: Path, answer: Callable, body: bytes, detail: str
) -> None:
    answer(lambda request: httpx.Response(200, content=body))

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 400
    assert response.json()["detail"] == detail
    assert not (vault / "03 Flashcards").exists()


@pytest.mark.parametrize("status", [404, 410])
async def test_says_when_the_deck_is_gone(
    client: AsyncClient, vault: Path, answer: Callable, status: int
) -> None:
    answer(lambda request: httpx.Response(status))

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 502
    assert response.json()["detail"] == f"That deck is gone: the link answered {status}"
    assert not (vault / "03 Flashcards").exists()


async def test_a_gone_page_that_loads_recaptcha_reads_as_gone(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    """A site's own 404 page may load a captcha script for a form on it."""
    answer(
        lambda request: httpx.Response(
            404, html='<script src="https://www.google.com/recaptcha/api.js"></script>'
        )
    )

    response = await link(client, "https://example.com/French.apkg")

    assert response.json()["detail"] == "That deck is gone: the link answered 404"


LOGIN = "That link asks for a login: download the .apkg in a browser and import it here"


@pytest.mark.parametrize("status", [401, 403])
async def test_says_when_the_link_wants_a_login(
    client: AsyncClient, vault: Path, answer: Callable, status: int
) -> None:
    answer(lambda request: httpx.Response(status))

    response = await link(client, "https://example.com/French.apkg")

    assert response.status_code == 502
    assert response.json()["detail"] == LOGIN


async def test_says_when_the_link_lands_on_a_login_page(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/shared/info/1":
            return httpx.Response(302, headers={"location": "/account/login"})
        return httpx.Response(200, html="<form>email, password</form>")

    answer(handler)

    response = await link(client, "https://ankiweb.net/shared/info/1")

    assert response.status_code == 502
    assert response.json()["detail"] == LOGIN


async def test_says_when_the_link_asks_for_a_captcha(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    answer(
        lambda request: httpx.Response(
            403, html='<div id="cf-challenge-running">Checking your browser</div>'
        )
    )

    response = await link(client, "https://ankiweb.net/shared/info/1")

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "That link asks for a captcha, which kasten does not get past:"
        " download the .apkg in a browser and import it here"
    )


async def test_follows_the_download_an_ankiweb_page_offers(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    """A made-up page, since AnkiWeb serves none with a link to a server today."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.path == "/shared/info/7":
            return httpx.Response(
                200, html='<a class="btn" href="/shared/download-deck/7?t=a&amp;b=c">Download</a>'
            )
        return deck_file(request)

    answer(handler)

    response = await link(client, "https://ankiweb.net/shared/info/7")

    assert response.status_code == 201
    assert seen == [
        "https://ankiweb.net/shared/info/7",
        "https://ankiweb.net/shared/download-deck/7?t=a&b=c",
    ]
    assert (vault / "03 Flashcards" / "French.md").exists()


async def test_the_download_an_ankiweb_page_offers_meets_the_same_checks(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/shared/info/7":
            return httpx.Response(200, html='<a href="http://ankiweb.net/x/French.apkg">Get</a>')
        return deck_file(request)

    answer(handler)

    response = await link(client, "https://ankiweb.net/shared/info/7")

    assert response.status_code == 400
    assert response.json()["detail"] == "Only https links"


async def test_the_recorded_ankiweb_page_says_it_needs_a_browser(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    """AnkiWeb's real answer to a server: a JavaScript shell with no link in it."""
    seen: list[str] = []
    page = RECORDED.read_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, content=page, headers={"content-type": "text/html"})

    answer(handler)

    response = await link(client, "https://ankiweb.net/shared/info/2109889812")

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "AnkiWeb's page needs a browser: open it there, press Download, and import the .apkg here"
    )
    assert seen == ["https://ankiweb.net/shared/info/2109889812"]
    assert not (vault / "03 Flashcards").exists()


async def test_a_merge_refusal_reads_as_the_file_import_gives_it(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    """A deck note with no marker is refused with a 409, the same words both ways."""
    note = vault / "03 Flashcards" / "French.md"
    note.parent.mkdir()
    note.write_text("#flashcards/French\n\nBonjour::hello\n", encoding="utf-8")
    answer(deck_file)

    by_file = await client.post("/api/anki", content=DECK)
    by_link = await link(client, "https://example.com/French.apkg")

    assert by_link.status_code == by_file.status_code == 409
    assert by_link.json() == by_file.json()
    assert note.read_text(encoding="utf-8") == "#flashcards/French\n\nBonjour::hello\n"


DOCS = Path(__file__).parents[2] / "docs"
"""The repo's documentation bundle, which the link import has to be written up in."""


def test_the_docs_tell_the_link_way() -> None:
    how_to = (DOCS / "how-to" / "import-an-anki-deck.md").read_text(encoding="utf-8")
    api = (DOCS / "reference" / "http-api.md").read_text(encoding="utf-8")

    section = how_to.split("## From a link", 1)[1].split("\n## ", 1)[0]
    assert ".apkg" in section
    assert "https://ankiweb.net/shared/info/<id>" in section
    assert "\n## POST /api/anki/link\n" in api


async def test_a_bad_deck_name_reads_as_the_file_import_gives_it(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    export = apkg("../../etc/passwd")
    answer(lambda request: httpx.Response(200, content=export))

    by_file = await client.post("/api/anki", content=export)
    by_link = await link(client, "https://example.com/French.apkg")

    assert by_link.status_code == by_file.status_code == 400
    assert by_link.json() == by_file.json()


async def test_i4_an_unreadable_member_reads_as_the_file_import_gives_it(
    client: AsyncClient, vault: Path, answer: Callable
) -> None:
    # Flag bit 0, encrypted, in the one member's local header and its central entry.
    export = bytearray(DECK)
    with zipfile.ZipFile(io.BytesIO(DECK)) as bundle:
        export[bundle.start_dir + 8] |= 1
    export[6] |= 1
    answer(lambda request: httpx.Response(200, content=bytes(export)))

    by_file = await client.post("/api/anki", content=bytes(export))
    by_link = await link(client, "https://example.com/French.apkg")

    assert by_link.status_code == by_file.status_code == 400
    assert by_link.json() == by_file.json()
    assert by_link.json()["detail"].startswith("unreadable Anki export: collection.anki2: ")
    assert not (vault / "03 Flashcards").exists()
