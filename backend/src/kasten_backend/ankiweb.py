"""Fetching an Anki deck from a link, including the AnkiWeb page that links to one.

AnkiWeb draws a shared deck's page in JavaScript, so a server is handed a shell
with no link in it, or a page with a link to the `.apkg`. This module hides
that: which answer is a page and not a file, which link on the page is the
download, and the stricter fetch an import makes. The connection, its address
check and its caps are `files.py`'s, and this reads them through `files` at
call time, so a test that lowers one there reaches the fetch here.
"""

import asyncio
import html
import re

import httpx

from kasten_backend import files

ONLY_HTTPS = "Only https links"
"""What a link that is not https is refused with, on the first hop or a later one."""

NO_BROWSER = (
    "AnkiWeb's page needs a browser: open it there, press Download, and import the .apkg here"
)
"""What an AnkiWeb page offering no download link is refused with.

AnkiWeb renders a shared deck's page in JavaScript, so what a server is given
is a shell with no link in it. The way round is AnkiWeb's private API or its
captcha, and kasten takes neither.
"""

_CHALLENGES = (b"captcha", b"cf-challenge", b"challenge-platform")
"""Words a page that wants a human carries: a captcha, Cloudflare's challenge."""

_HREF = re.compile(rb"""href\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
"""An `href` in a page, read with a pattern rather than a parser: only the address matters."""


async def fetch_deck(url: str) -> bytes:
    """The bytes of the Anki export `url` names, a plain `.apkg` or an AnkiWeb deck page.

    Stricter than `download`: https only, on every hop, since a deck is never a
    page that has only http, and a link that drops to http on the way is one a
    stranger on the wire could swap. The address is `_PublicOnly`'s to check,
    as there. An AnkiWeb page is read for the download it offers, which is then
    fetched through the same checks; nothing is put together from the deck's id.

    Every upstream refusal is a 502 for the reason `/api/fetch` gives one, and
    a body that is not a zip is a 400, the status the file import gives it.
    """
    try:
        start = httpx.URL(url)
    except httpx.InvalidURL as error:
        raise files.RefusedError(400, ONLY_HTTPS) from error
    if start.scheme != "https" or not start.host:
        raise files.RefusedError(400, ONLY_HTTPS)

    try:
        async with asyncio.timeout(files.DECK_TIMEOUT_SECONDS), files.reader() as client:
            # A hook rather than a check on `url`, so no hop can be sent
            # without it, the ones `open_public` follows by hand included.
            client.event_hooks["request"].append(_only_https)
            at, body = await _deck_body(client, url)
            if not body.startswith(b"PK") and _ankiweb_page(at):
                link = _download_link(body)
                if link is None:
                    raise files.RefusedError(502, NO_BROWSER)
                at, body = await _deck_body(client, str(at.join(link)))
    except TimeoutError as error:
        raise files.RefusedError(504, "That link took too long to answer") from error
    except httpx.HTTPError as error:
        raise files.RefusedError(502, f"Could not read that link: {error}") from error

    # Every export is a zip, and what else a link answers with, a page most of
    # all, would only reach `read_apkg` to be refused in words about sqlite.
    if not body.startswith(b"PK"):
        if body.lstrip()[:1] == b"<":
            raise files.RefusedError(400, "That link is a web page, not an Anki deck")
        raise files.RefusedError(400, "That link is not an Anki deck")
    return body


async def _only_https(request: httpx.Request) -> None:
    """Refuse a hop that is not https, the first or any redirect."""
    if request.url.scheme != "https":
        raise files.RefusedError(400, ONLY_HTTPS)


async def _deck_body(client: httpx.AsyncClient, url: str) -> tuple[httpx.URL, bytes]:
    """Where `url` ended up and what it answered, once the answer is worth reading.

    Gone is judged first, since a site's own 404 page may load a captcha
    script for a form on it. The body is read before the rest is judged,
    because a challenge comes with a 403 and is told apart from a login only
    by what it says.
    """
    response = await files.open_public(client, url)
    status = response.status_code
    if status in (404, 410):
        await response.aclose()
        raise files.RefusedError(502, f"That deck is gone: the link answered {status}")
    try:
        body = await _capped(response)
    finally:
        await response.aclose()

    page = status < files.PAGE_FAILED and "html" in response.headers.get("content-type", "")
    if (status in (403, 429) or page) and any(word in body.lower() for word in _CHALLENGES):
        raise files.RefusedError(
            502,
            "That link asks for a captcha, which kasten does not get past:"
            " download the .apkg in a browser and import it here",
        )
    if status in (401, 403) or "/account/login" in response.url.path:
        raise files.RefusedError(
            502,
            "That link asks for a login: download the .apkg in a browser and import it here",
        )
    if status >= files.PAGE_FAILED:
        raise files.RefusedError(502, f"That link answered {status}")
    return response.url, body


async def _capped(response: httpx.Response) -> bytes:
    """The body, counted as it arrives and given up on the moment it passes the cap.

    Not `store`, which writes to disk: an import reads the export from memory.
    `content-length` plays no part, for the reason `ASSET_LIMIT_BYTES` gives.
    """
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body += chunk
        if len(body) > files.ASSET_LIMIT_BYTES:
            raise files.RefusedError(413, files.too_big(files.ASSET_LIMIT_BYTES))
    return bytes(body)


def _ankiweb_page(url: httpx.URL) -> bool:
    """Whether `url` is an AnkiWeb shared deck's page rather than a file."""
    return url.host == "ankiweb.net" and url.path.startswith("/shared/info/")


def _download_link(page: bytes) -> str | None:
    """The first link on `page` to an `.apkg` or to AnkiWeb's deck download, if any."""
    for match in _HREF.finditer(page):
        href = html.unescape(match.group(1).decode(errors="replace"))
        try:
            path = httpx.URL(href).path
        except httpx.InvalidURL:
            continue
        if path.endswith(".apkg") or "download-deck" in path:
            return href
    return None
