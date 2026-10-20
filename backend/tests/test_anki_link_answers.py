import io
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
import pytest

from backend.tests.anki_link_web import DECK, apkg, deck_file, link

if TYPE_CHECKING:
    from collections.abc import Callable

    from httpx import AsyncClient

# `resolve` applies to every test here: see test_anki_link_refusals.py.
pytestmark = pytest.mark.usefixtures("resolve")


RECORDED = Path(__file__).parent / "fixtures" / "ankiweb" / "info.html"
"""What `https://ankiweb.net/shared/info/2109889812` answered a server on 2026-10-17."""

LOGIN = "That link asks for a login: download the .apkg in a browser and import it here"

DOCS = Path(__file__).parents[2] / "docs"
"""The repo's documentation bundle, which the link import has to be written up in."""


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


def test_the_docs_tell_the_link_way() -> None:
    how_to = (DOCS / "how-to" / "import-an-anki-deck.md").read_text(encoding="utf-8")
    api = (DOCS / "reference" / "http-api" / "cards.md").read_text(encoding="utf-8")

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
