"""Putting a book or an image into the vault, from a body or from the internet.

One implementation behind three callers: `POST /api/assets/{path}` in the
browser, `POST /agent/files/{path}` for a token holder with a shell, and the
MCP tool `save_file`, which has no way to carry bytes and hands a URL instead.
The rules about what may land, where, and how big, live here once.

No HTTP framework. A refusal is a `RefusedError` carrying the status it earns,
which `main.py` answers for every route and the MCP tool turns into a tool
error, so all three refuse in the same words.
"""

import asyncio
import ipaddress
import os
import secrets
import socket
from typing import TYPE_CHECKING

import httpcore
import httpx

# From the module rather than off `httpcore`, which binds the name to a stub
# when anyio is missing and so types it as a union of the two. anyio is a
# FastAPI dependency and always here.
from httpcore._backends.anyio import AnyIOBackend

from kasten_backend.change import vault_change, vault_write
from kasten_backend.vault import ASSET_MAGIC, relative_path, resolve_asset_path

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Iterable
    from pathlib import Path

ASSET_LIMIT_BYTES = 100 * 1024 * 1024
"""The most of one book or image this will take before giving up.

One cap for both, because the cap is about what a request may cost and not about
what a format usually weighs. Twenty times a fat epub, so it is not a number
anybody meets by reading. It is counted off the bytes as they arrive rather than
read off `content-length`, for the reason `PAGE_LIMIT_BYTES` is: a header is a
claim. `api.ts` holds the client's copy, which is checked before a byte is sent
and must never exceed this one.

Cloudflare sits in front of production with a body limit of its own near this
number, so a real oversize upload is usually refused before it arrives. This is
the backstop for dev, for the LAN, for a client that did not check, and for a
download, which no proxy in front of kasten sees at all.
"""

HEAD_BYTES = max(len(magic) for magic in ASSET_MAGIC.values())
"""How much of an upload the suffix check needs, which is the longest magic.

Derived rather than typed, so a format whose magic is longer than every one
before it widens this by arriving in the table.
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

httpx applies it to each step, the connect and every read, and not to the
whole transfer, so a 90MB download that keeps arriving is not cut off.
"""

PAGE_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
"""What this calls itself when it asks for a page.

A browser's string rather than kasten's, because a great many sites answer an
unfamiliar agent with a challenge page or a 403, and the page being asked for
is one the reader is sitting in front of and could have opened in a tab. It is
a request for one page, made by hand, not a crawl.
"""

TOO_BIG = "That book is too big"
"""What a body over the cap is refused with, whichever kind of file it was."""


class RefusedError(Exception):
    """A file or a page this will not take, and the status the refusal earns.

    Its own class with the status on it, because three surfaces answer it and two
    of them are not HTTP: the MCP tool reads the sentence and drops the number.
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

    The backend sits on the docker network beside Postgres, the shell and
    whatever else the box runs, none of which expects a request from it. Every
    address the name resolves to is checked, not only the one opened, so a name
    with one private address among public ones is refused whole. An IPv4
    address hidden in an IPv6 one is checked as the IPv4 address it is.
    `is_global` leaves out loopback, private, link-local, shared (CGNAT and
    Tailscale) and reserved space, and multicast is refused on its own because
    some of it counts as global.
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

    The check lives in the connect rather than in front of the request. Checked
    in front, httpx resolved the name a second time to connect, and a name that
    answered a public address the first time and `127.0.0.1` the second walked
    past it. Here there is one lookup, and the socket opens on the address that
    lookup checked. Every redirect hop connects through here too, so a public
    page pointing back at the box meets the same refusal with no loop of its
    own. TLS still verifies the certificate against the hostname: httpcore
    hands `start_tls` the origin's name, never the address.
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

    The pool is replaced after `super().__init__` because httpx builds it there
    and takes no network backend of its own. Passing a transport also turns off
    the proxies httpx would read off the environment, which is wanted: through a
    proxy the address checked would be the proxy's and never the page's.
    """

    def __init__(self) -> None:
        """Build the default transport and swap in a pool that only connects out."""
        super().__init__()
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(), network_backend=_PublicOnly()
        )


def reader() -> httpx.AsyncClient:
    """The client every fetch out of the box goes through, `/api/fetch` and `download`.

    A function rather than a client built at each call site, so there is one
    place that decides how kasten reaches the internet, and one seam a test
    replaces to answer for the internet.
    """
    return httpx.AsyncClient(
        timeout=PAGE_TIMEOUT_SECONDS,
        headers={"user-agent": PAGE_AGENT},
        follow_redirects=True,
        max_redirects=PAGE_REDIRECTS,
        transport=_PublicTransport(),
    )


async def open_public(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """Open `url` as a stream. The caller closes what comes back.

    http and https and nothing else, checked before anything is opened:
    `file://` would read this container's disk. The address is `_PublicOnly`'s
    to check, on every hop.
    """
    try:
        request = client.build_request("GET", url)
    except httpx.InvalidURL as error:
        raise RefusedError(400, "Only http and https addresses") from error
    if request.url.scheme not in ("http", "https") or not request.url.host:
        raise RefusedError(400, "Only http and https addresses")

    try:
        return await client.send(request, stream=True)
    except httpx.TooManyRedirects as error:
        raise RefusedError(502, "That page redirects too many times") from error


async def store(root: Path, path: str, chunks: AsyncIterator[bytes]) -> str:
    """Put the bytes `chunks` yields at `path`, never over a file already there.

    Answers with the vault-relative path that landed. Every refusal leaves the
    path as it found it, a free one with no temp beside it. An exception the
    iterator raises, a client hanging up mid-body or a download breaking off,
    propagates after the same cleanup.
    """
    asset = resolve_asset_path(root, path)
    if asset is None:
        raise RefusedError(400, "The vault will not take that path")
    relative = relative_path(root, asset)
    # A courtesy in front of the guarantee, not the guarantee itself. It is
    # here so you learn the path is taken before you send 30MB; the `os.link`
    # below is what actually refuses an overwrite. Deleting this would cost the
    # early answer, and trusting it would cost the promise.
    if asset.exists():
        raise RefusedError(409, "Something is already there")

    # The way `create_note` makes them, and for the reason its docstring gives:
    # a note's folder can vanish between picking the file and sending it, and
    # opening a file under a missing parent raises rather than answers.
    asset.parent.mkdir(parents=True, exist_ok=True)

    # Eight random hex characters rather than a fixed name. Two uploads aimed
    # at one path would otherwise interleave their bytes into one temp, and the
    # winner's cleanup would unlink the name the loser is still writing behind.
    # Opened `"xb"` rather than through `tempfile.mkstemp`: mkstemp creates the
    # file 0600 and the hard link below publishes that mode, so every book
    # would land readable by its owner alone in a vault whose whole point is
    # being readable without kasten. Hidden and `.tmp`, so the listing, the
    # watcher and jj all skip whatever a crash leaves behind.
    temporary = asset.with_name(f".{asset.name}.{secrets.token_hex(4)}.tmp")
    # Opened above the `try`, so the `finally` can only ever unlink a file this
    # call made.
    output = temporary.open("xb")
    try:
        with output:
            size = 0
            head = b""
            async for chunk in chunks:
                size += len(chunk)
                # Before the write, so an over-cap body is refused rather than
                # landing on the disk first.
                if size > ASSET_LIMIT_BYTES:
                    raise RefusedError(413, TOO_BIG)
                if len(head) < HEAD_BYTES:
                    head = (head + chunk)[:HEAD_BYTES]
                output.write(chunk)

        # A usability check and never a security one. The shell pane drops a
        # file straight into the vault without coming near this, so nothing
        # downstream can rely on it having run. It earns its place because
        # there is no delete for a book: a PDF or a half-copied file sent by
        # mistake would squat on the sidecar path until you open a terminal,
        # and a URL that answers with a login page rather than the paper would
        # do the same. Compared after the stream rather than the moment the
        # fourth byte arrives. Refusing early would save something real, a 90MB
        # PDF renamed `.epub` streaming whole before the 400, and the flat check
        # wins anyway because one user moves seconds of data. The suffix is
        # what picks the bytes: `resolve_asset_path` above answers for the
        # names in `ASSET_MAGIC` and no others, so the lookup cannot miss.
        if not head.startswith(ASSET_MAGIC[asset.suffix]):
            raise RefusedError(400, "That file is not what its name says")

        # A link and not an `os.replace`, though `write_note` replaces in the
        # next module over. Replace overwrites, and no delete and no history
        # means an overwritten book is gone for good. A link creates the target
        # or raises, and the filesystem decides which, so no window exists in
        # which two requests both believe the path is free.
        try:
            # The lock covers the link and nothing before it. Holding it across
            # the stream above would serialise every browser save behind one
            # slow upload.
            async with vault_write(), vault_change(root, relative):
                os.link(temporary, asset)
        except FileExistsError as taken:
            # Around the link alone, so it cannot swallow the temp's own
            # `open("xb")` colliding, which means something else entirely and
            # should stay a 500.
            raise RefusedError(409, "Something is already there") from taken
    finally:
        # Every path out, the successful one included: after the link the temp
        # is a second name for a file the target now also names, so unlinking
        # it leaves the book whole.
        temporary.unlink(missing_ok=True)

    return relative


async def download(root: Path, path: str, url: str) -> str:
    """Put the file at `url` into the vault at `path`, by way of `store`.

    For a caller that holds a link and not the bytes, which is every MCP client:
    a tool call is JSON a model writes, and a model cannot write out a PDF. The
    address meets the same checks `GET /api/fetch` makes, every hop of it, and
    the bytes the same checks an upload meets, the cap and the magic included.

    The path is checked before anything is opened, so a typo costs nothing on
    the wire.
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
