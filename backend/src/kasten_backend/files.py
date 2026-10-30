"""Putting a book or an image into the vault, from a body or from the internet.

Three callers share it: the browser's `POST /api/assets/{path}`, the agent's
`POST /agent/files/{path}`, and the MCP tool `save_file`, which takes a URL. A refusal is a
`RefusedError`, so all three refuse in the same words.
"""

import asyncio
import ipaddress
import os
import secrets
import socket
from typing import TYPE_CHECKING

import httpcore
import httpx

# Imported from the module: `httpcore` binds this name to a stub when anyio is missing,
# which types it as a union of the two.
from httpcore._backends.anyio import AnyIOBackend

from kasten_backend.change import vault_change, vault_write
from kasten_backend.vault import HEAD_BYTES, fits, relative_path, resolve_asset_path

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterable
    from pathlib import Path

ASSET_LIMIT_BYTES = 100 * 1024 * 1024
"""The most of one file fetched by link, or sent by a token holder, before giving up.

Counted off the bytes as they arrive, not `content-length`, since a header is a claim.
A download is what it guards most: no proxy in front of kasten sees one.
"""

UPLOAD_LIMIT_BYTES = 1024 * 1024 * 1024
"""The most of one file the browser may put into the vault or import as a deck.

Higher than `ASSET_LIMIT_BYTES`, since a 106MB Anki deck cannot be split and uploads go in
pieces through `uploads.py`. `api.ts` holds the client's copy, which must never exceed this.
"""

PAGE_FAILED = 400
"""The status at which a page counts as not having been read.

The line HTTP itself draws, and named because a bare 400 in a comparison says
nothing about which of the two numbers on that line is which.
"""

PAGE_REDIRECTS = 20
"""How many redirects a page may take before the reader is told it did not load.

httpx's own default, spelled out because the refusal names it.
"""

PAGE_TIMEOUT_SECONDS = 20.0
"""How long a page has to answer before the reader is told it did not.

Applied to each step, the connect and every read, not the whole transfer, so a 90MB download
that keeps arriving is not cut off.
"""

PAGE_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
"""What this calls itself when it asks for a page.

A browser's string, since many sites answer an unfamiliar agent with a challenge or a 403.
The page is one the reader is sitting in front of, asked for by hand, not a crawl.
"""


OPEN_LIMIT_BYTES = 4 * UPLOAD_LIMIT_BYTES
"""The most the uploads open at once may declare between them.

What bounds the disk the temps take. A client that never finishes an upload fills the temp
folder up to this, for the hour until the sweep takes them.
"""


def amount(limit: int) -> str:
    """`limit` in the largest unit it is a whole number of.

    So a cap a test lowers to a few bytes still reads as a sentence.
    """
    for unit, name in ((1024**3, "GiB"), (1024**2, "MiB"), (1024, "KiB")):
        if limit % unit == 0:
            return f"{limit // unit} {name}"
    return f"{limit} byte"


def too_big(limit: int) -> str:
    """What a body over `limit` is refused with: the limit, so the reader knows what fits."""
    return f"That file is over the {amount(limit)} limit"


DECK_TIMEOUT_SECONDS = 120.0
"""How long fetching a deck from a link may take, start to finish, every hop included.

Over the whole fetch, not each step: a server dripping one byte every nineteen seconds meets
every per-step limit and would hold the request open. Two minutes moves the 100MB cap on any
line a deck is worth fetching over.
"""


class RefusedError(Exception):
    """A file or a page this will not take, and the status the refusal earns.

    The status rides on the class because two of the three surfaces are not HTTP: the MCP tool
    reads the sentence and drops the number.
    """

    def __init__(self, status: int, detail: str) -> None:
        """Refuse with `detail`, which every surface shows word for word."""
        super().__init__(detail)
        self.status = status


async def _addresses(host: str) -> list[str]:
    """Every address the host resolves to, the way the fetch itself will resolve it."""
    found = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [str(entry[4][0]) for entry in found]


async def _public_address(host: str) -> str:
    """The address to open for `host`, once every address it has is on the internet.

    Every address the name resolves to is checked, not only the one opened, so one private
    address among public ones refuses the name. An IPv4 address inside an IPv6 one is checked
    as IPv4. `is_global` leaves out private and shared space, and multicast is refused on its own.
    """
    try:
        found = await _addresses(host)
    except OSError as error:
        raise RefusedError(502, f"Could not find {host}") from error

    for address in found:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if not ip.is_global or ip.is_multicast:
            raise RefusedError(400, "That address is not on the internet")

    return found[0]


class _PublicOnly(httpcore.AsyncNetworkBackend):
    """Opens a socket to the address it checked, and to nothing else.

    The check lives in the connect: checked in front of the request, httpx resolves the name a
    second time, and a name could answer public, then `127.0.0.1`. TLS still verifies the
    certificate against the hostname, as httpcore hands `start_tls` the origin's name.
    """

    def __init__(self) -> None:
        """Wrap the anyio backend httpcore picks by itself under asyncio."""
        self._backend = AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109  httpcore's signature, not ours
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        """Connect to `host` by the one address checked for it."""
        address = await _public_address(host)

        return await self._backend.connect_tcp(
            address, port, timeout, local_address, socket_options
        )

    async def sleep(self, seconds: float) -> None:
        """Wait the way the wrapped backend waits, which a retry asks for."""
        await self._backend.sleep(seconds)


class _PublicTransport(httpx.AsyncHTTPTransport):
    """httpx's own transport, connecting through `_PublicOnly`.

    The pool is swapped after `super().__init__`, since httpx builds its own there and takes no
    network backend. The transport also drops the environment's proxies, which is wanted: through
    one, the checked address would be the proxy's.
    """

    def __init__(self) -> None:
        """Build the default transport and swap in a pool that only connects out."""
        super().__init__()
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(), network_backend=_PublicOnly()
        )


def reader() -> httpx.AsyncClient:
    """The client every fetch out of the box goes through: `/api/fetch`, `download`, `ankiweb`.

    One place that decides how kasten reaches the internet, and one seam a test replaces. It
    follows no redirects: httpx reads every 3xx body whole into memory where no cap sees it, so
    `open_public` follows them by hand.
    """
    return httpx.AsyncClient(
        timeout=PAGE_TIMEOUT_SECONDS,
        headers={"user-agent": PAGE_AGENT},
        transport=_PublicTransport(),
    )


async def open_public(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """Open `url` as a stream, redirects followed. The caller closes what comes back.

    http and https only: `file://` would read this container's disk. A later hop to another
    scheme is the transport's to refuse. Each redirect is closed unread, so the only body read
    is the last, through the caller's cap.
    """
    try:
        request = client.build_request("GET", url)
    except httpx.InvalidURL as error:
        raise RefusedError(400, "Only http and https addresses") from error
    if request.url.scheme not in ("http", "https") or not request.url.host:
        raise RefusedError(400, "Only http and https addresses")

    for _ in range(PAGE_REDIRECTS + 1):
        response = await client.send(request, stream=True)
        if not response.is_redirect:
            return response
        await response.aclose()
        try:
            request = client.build_request("GET", response.url.join(response.headers["location"]))
        except httpx.InvalidURL as error:
            raise RefusedError(502, "That link redirects to no address") from error
    raise RefusedError(502, "That page redirects too many times")


def temporary_name(name: str) -> str:
    """The hidden name `store` streams `name` into before linking it into place.

    Fourteen bytes longer than `name`, so a name near the filesystem's limit still fits as itself.
    The Anki reader asks this to skip one.
    """
    return f".{name}.{secrets.token_hex(4)}.tmp"


async def store(
    root: Path,
    path: str,
    chunks: AsyncIterator[bytes],
    *,
    limit: int | None = None,
    held: bool = False,
) -> str:
    """Put the bytes `chunks` yields at `path`, never over a file already there.

    `limit` is the cap, `ASSET_LIMIT_BYTES` when None, so a test can lower it. Every refusal, and
    any error mid-stream, leaves the path as it found it. `held` is for a caller already inside
    `vault_write`, since the lock is not re-entrant.
    """
    asset = resolve_asset_path(root, path)
    if asset is None:
        raise RefusedError(400, "The vault will not take that path")
    relative = relative_path(root, asset)
    # Answers before the body is sent. `os.link` below is what actually refuses an overwrite.
    if asset.exists():
        raise RefusedError(409, "Something is already there")

    # As `create_note` does: the folder can vanish mid-upload, and opening under a
    # missing parent raises.
    asset.parent.mkdir(parents=True, exist_ok=True)

    # Random, so two uploads aimed at one path cannot share a temp and unlink each other's.
    # Opened `"xb"`, not by mkstemp: its 0600 mode would survive the link and hide every book from
    # the other readers of the vault. Hidden and `.tmp`, so the listing, the watcher and jj skip
    # whatever a crash leaves.
    temporary = asset.with_name(temporary_name(asset.name))
    # Opened above the `try`, so the `finally` only ever unlinks a file this call made.
    cap = ASSET_LIMIT_BYTES if limit is None else limit
    output = temporary.open("xb")
    try:
        with output:
            size = 0
            head = b""
            async for chunk in chunks:
                size += len(chunk)
                # Before the write, so an over-cap body is refused rather than landing on
                # disk first.
                if size > cap:
                    raise RefusedError(413, too_big(cap))
                if len(head) < HEAD_BYTES:
                    head = (head + chunk)[:HEAD_BYTES]
                output.write(chunk)

        # A usability check, never a security one: the shell drops files into the vault
        # past this, so nothing downstream relies on it. It stays because there is no
        # delete for a book, and a mistaken file would squat on its path. Checked after
        # the stream: refusing at the fourth byte would save a 90MB stream, which one
        # user can afford.
        if not fits(asset.suffix.lower(), head):
            raise RefusedError(400, "That file is not what its name says")

        # A link, not `os.replace`: replace would overwrite, and with no delete or
        # history an overwritten book is gone. A link creates the target or raises, so
        # two requests cannot both find it free.
        try:
            # The lock covers the link only: held across the stream, one slow upload
            # would stall every save.
            if held:
                os.link(temporary, asset)
            else:
                async with vault_write(), vault_change(root, relative):
                    os.link(temporary, asset)
        except FileExistsError as taken:
            # Around the link alone: a collision on the temp's own `open("xb")` is
            # something else, and stays a 500.
            raise RefusedError(409, "Something is already there") from taken
    finally:
        # Every path out: after the link the temp is a second name for the book, so
        # unlinking it is safe.
        temporary.unlink(missing_ok=True)

    return relative


async def download(root: Path, path: str, url: str) -> str:
    """Put the file at `url` into the vault at `path`, by way of `store`.

    For a caller holding a link, not the bytes, which is every MCP client: a model cannot write out
    a PDF. The address meets the checks `GET /api/fetch` makes, and the bytes meet an upload's cap
    and magic. The path is checked before anything opens, so a typo costs nothing on the wire.
    """
    if resolve_asset_path(root, path) is None:
        raise RefusedError(400, "The vault will not take that path")

    try:
        async with reader() as client:
            response = await open_public(client, url)
            try:
                if response.status_code >= PAGE_FAILED:
                    raise RefusedError(502, f"That address answered {response.status_code}")
                return await store(root, path, response.aiter_bytes())
            finally:
                await response.aclose()
    except httpx.HTTPError as error:
        raise RefusedError(502, f"Could not read that address: {error}") from error
