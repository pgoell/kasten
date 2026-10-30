"""Fetching an Anki deck from a link, including the AnkiWeb page that links to one.

AnkiWeb draws a shared deck's page in JavaScript, so this reads that page for its `.apkg` link.
The connection and its caps are `files.py`'s, read at call time, so a test can lower them.
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
"""What an AnkiWeb page with no download link is refused with.

AnkiWeb draws the page in JavaScript, and kasten takes neither its private API nor its captcha.
"""

_CHALLENGES = (b"captcha", b"cf-challenge", b"challenge-platform")
"""Words a page that wants a human carries: a captcha, Cloudflare's challenge."""

_HREF = re.compile(rb"""href\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
"""An `href` in a page, read with a pattern rather than a parser: only the address matters."""


async def fetch_deck(url: str) -> bytes:
    """The bytes of the Anki export `url` names: a `.apkg`, or the file an AnkiWeb page offers.

    https only on every hop, since a link that drops to http can be swapped on the wire. The
    address is checked as `download` checks it. Upstream refusals are 502s, and a body that is
    not a zip is a 400.
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

    A 404 is judged first, since a site's own 404 page may load a captcha script. The body is
    read before the rest, since a challenge comes with a 403 and is told apart by its words.
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

    Not `store`, which writes to disk: an import reads the export from memory, and
    `content-length` is ignored, as `ASSET_LIMIT_BYTES` explains.
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
