"""The same five capabilities, served as MCP tools at `/agent/mcp`.

Thin wrappers over `agent.py` and nothing else. The rules about what an agent
may do live there, so the two surfaces cannot drift into disagreeing about them.

The tools live here and never in `main.py`. That module already imports a
`write_note` from `vault.py` and resolves it as a global inside `PUT
/api/files`; a tool of a colliding name defined there would silently redirect
the browser's own save.

Three things about the wiring are load-bearing and each has a test:

* The endpoint answers at exactly `/agent/mcp`. The SDK's app owns `/mcp`
  internally, so it is mounted at `/agent` and the inner path supplies the rest.
  Mounting it at `/agent/mcp` would nest the endpoint a level deeper and answer
  the documented URL with a 307 that many clients will not follow on a POST.
* A mounted sub-application does not run its own lifespan. The session manager
  is entered by the lifespan in `main.py`, or the first request is a 500. It is
  single-use, so the app is built on the way in and each entry builds a fresh
  one.
* The bearer check is an ASGI wrapper rather than a FastAPI dependency, because
  a dependency does not reach a mounted app. It sets and resets `vcs.writer` the
  way `require_token` does; without that, every MCP write, which is the primary
  surface, would land in `jj log` as a browser edit with the suite still green.

The wrapper also decides the method set, and `POST` is the whole of it.
Streamable HTTP names three: `POST` carries every exchange, `DELETE` ends a
session this configuration does not have, and `GET` opens a standalone
server-to-client SSE stream. The SDK answers `DELETE` with a 405 already, but it
accepts a `GET` and holds the stream open even when stateless, where each
request gets a fresh transport and nothing will ever be written to it. On an
endpoint reachable from the internet that is a connection held open for nothing,
so it is refused here rather than left to the SDK.
"""

from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING, Any

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from starlette.responses import JSONResponse

from kasten_backend import agent, vcs
from kasten_backend.agent_oauth import challenge
from kasten_backend.agent_routes import BEARER, REFUSED
from kasten_backend.config import get_settings
from kasten_backend.tokens import verify

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from starlette.types import ASGIApp, Receive, Scope, Send

PATH = "/mcp"
"""The endpoint inside the SDK's own app, which the `/agent` mount completes."""

# Read off the package rather than spelled in Python, the way `guide.py` and
# `okf.py` read theirs: prose in a Python string is prose nobody can read in a
# diff.
INSTRUCTIONS = (Path(__file__).parent / "mcp-instructions.md").read_text(encoding="utf-8").strip()
"""What a model is told about this vault before it calls anything.

Two channels carry it, because no one channel reaches every client. The
`instructions` field below is dropped by claude.ai and Claude Desktop and read
by Claude Code, codex and ChatGPT. `tools/list` is dropped by nobody, which is
why `read_guide` hands the same text back on request.

Claude Code truncates a server's instructions at 2KiB, mid-word and silently, so
this stays well inside it, and what a client needs first, the shape of the vault
and the limits of the tools, is in the opening lines.
"""

REDUNDANT = (
    "\n\nYou have just read this, so `read_guide` would only repeat it back. "
    "Do not call it: the clients it exists for are the ones that never saw this "
    "paragraph."
)
"""The one line the tool's own answer must never carry.

Only the `instructions` field gets it. A client reading this already holds the
text, and a client calling `read_guide` by definition does not, so telling the
second one to skip the call it just made would be nonsense.
"""

_serving: list[ASGIApp] = []
"""What the lifespan built, or nothing when the process is not serving.

A list rather than a rebound module global so the mount below can be a plain
function: it reads this on every request, and the app it reads is a different
object after every lifespan entry.
"""


async def list_notes(folder: str = "") -> list[str]:
    """Every note in the vault, or in one folder of it, as sorted relative paths."""
    return await agent.list_notes(get_settings(), folder)


async def read_note(path: str) -> dict[str, Any]:
    """Read one note, with the digest a conditional write presents back."""
    found = await agent.read_note(get_settings(), path)
    if found is None:
        raise ToolError("No such note")

    return found.model_dump()


async def search_notes(query: str, archive: bool = False) -> list[dict[str, Any]]:
    """Every line in the vault holding `query`, ignoring case."""
    hits = await agent.search_notes(get_settings(), query, archive)

    return [hit.model_dump() for hit in hits]


async def save_note(path: str, content: str, sha: str | None = None) -> dict[str, Any]:
    """Write one note whole. `sha` is the digest of the note you read, or null to create it."""
    return await _written(agent.save_note(get_settings(), path, content, sha))


async def append_note(path: str, text: str, sha: str | None = None) -> dict[str, Any]:
    """Add text to the end of one note, creating it when there is none there."""
    return await _written(agent.append_note(get_settings(), path, text, sha))


async def read_guide() -> str:
    """How this vault is filed, what the other tools do, and what they cannot do.

    Call this first. It reads nothing from the vault and takes no argument: the
    text is compiled into the server, which is what makes it the one capability
    here that touches no note.
    """
    return INSTRUCTIONS


TOOLS = (list_notes, read_note, search_notes, save_note, append_note, read_guide)
"""The five, in the order the reference page lists them, and the guide behind them.

`read_guide` is a sixth tool and not a sixth capability. It reads a string
compiled into the image, never the vault, so the audit this prefix exists for is
still a list of five things.
"""

READING = frozenset({"list_notes", "read_note", "search_notes", "read_guide"})
"""Which of the five only read, told to the client as `readOnlyHint`.

chatgpt.com treats a tool without it as a write and asks you to confirm every
call, so an unannotated `read_note` turns a search across the vault into one
button press per note.
"""


async def _written(write: Any) -> dict[str, Any]:
    """Await one write and turn its refusals into tool errors.

    Both surfaces refuse in the same words, the sentence coming off
    `agent.CHANGED` rather than being written twice.
    """
    try:
        landed = await write
    except agent.ConflictError as changed:
        held = (
            "the note does not exist"
            if changed.current is None
            else f"its digest is {changed.current}"
        )
        raise ToolError(f"{changed}: {held}. Read it again and present that digest.") from changed
    except agent.TooLargeError as big:
        raise ToolError(str(big)) from big

    if landed is None:
        raise ToolError("The vault will not take that path")

    return landed.model_dump()


def _security(host: str) -> TransportSecuritySettings:
    """The SDK's DNS-rebinding protection, told which `Host` this vault answers to.

    Explicit in both directions rather than left to the default. Passing None
    makes the SDK auto-enable a localhost-only allowlist, which answers 421 to
    every request arriving through Caddy; disabling the protection outright
    would drop a supported layer for no reason.
    """
    if not host:
        return TransportSecuritySettings(enable_dns_rebinding_protection=False)

    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[host, f"{host}:*"],
        # The browser products call from their own backends, where the SDK's
        # check passes on an absent `Origin` rather than a matching one. These
        # three are for the case where one is sent: the `Host` allowlist above
        # already pins the vault, so naming them costs nothing and the failure
        # they prevent is a 403 on every tool call with a valid token in hand.
        allowed_origins=[
            f"https://{host}",
            f"http://{host}",
            "https://claude.ai",
            "https://claude.com",
            "https://chatgpt.com",
        ],
    )


def _gate(inner: ASGIApp) -> ASGIApp:
    """`inner`, behind the same bearer check the `/agent/` routes carry."""

    async def gated(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return

        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1")
        header = headers.get(b"authorization", b"").decode("latin-1")
        name = (
            await verify(get_settings().tokens_path, header.removeprefix(BEARER))
            if header.startswith(BEARER)
            else None
        )
        # Before the method check, so a caller with no token learns nothing
        # about what this endpoint accepts.
        if name is None:
            await JSONResponse(
                {"detail": REFUSED},
                status_code=401,
                # The one thing that turns this refusal into a sign-in. A
                # browser product has no field for a header, so this header is
                # how it learns there is an authorization server at all.
                headers={"WWW-Authenticate": challenge(host, scope.get("scheme") == "https")},
            )(scope, receive, send)
            return

        if scope["method"] != "POST":
            await JSONResponse(
                {"detail": "This endpoint takes POST"},
                status_code=405,
                headers={"Allow": "POST"},
            )(scope, receive, send)
            return

        held = vcs.writer.set(name)
        try:
            await inner(scope, receive, send)
        finally:
            vcs.writer.reset(held)

    return gated


def build() -> tuple[ASGIApp, MCPServer]:
    """The streamable-HTTP app wrapped in the bearer check, and the server behind it.

    The server comes back too because its session manager exists only after this
    call, and the lifespan is what enters it.
    """
    server: MCPServer = MCPServer(
        name="kasten",
        version=version("kasten-backend"),
        instructions=INSTRUCTIONS + REDUNDANT,
    )
    for tool in TOOLS:
        # The SDK's model is snake_case with a camelCase alias, so this is
        # `readOnlyHint` on the wire, which is where the test reads it.
        server.add_tool(tool, annotations=ToolAnnotations(read_only_hint=tool.__name__ in READING))

    inner = server.streamable_http_app(
        streamable_http_path=PATH,
        # Stateless, so there is no session to keep and a POST carries the whole
        # exchange. JSON rather than a stream for the same reason: every one of
        # these five answers in one message.
        stateless_http=True,
        json_response=True,
        transport_security=_security(get_settings().agent_host),
    )

    return _gate(inner), server


@asynccontextmanager
async def serving() -> AsyncIterator[None]:
    """Build the endpoint and run its session manager for as long as the app is up."""
    app, server = build()
    _serving.append(app)
    try:
        async with server.session_manager.run():
            yield
    finally:
        _serving.remove(app)


async def mounted(scope: Scope, receive: Receive, send: Send) -> None:
    """What `main.py` mounts at `/agent`: whatever the lifespan built, or nothing yet.

    A stable object, because a mount is registered once and the app behind it is
    a different one after every lifespan entry.
    """
    if not _serving:
        await JSONResponse({"detail": "The agent endpoint is not running"}, status_code=503)(
            scope, receive, send
        )
        return

    await _serving[-1](scope, receive, send)
