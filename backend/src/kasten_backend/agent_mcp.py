"""The MCP tools at `/agent/mcp`: thin wrappers over `agent.py`, defined nowhere in `routes/`.

Mounted at `/agent`, since the SDK's app owns `/mcp`. At `/agent/mcp` it would answer
307, which many clients will not follow on POST. Only POST is served: a GET would
hold an SSE stream open for nothing.
"""

from contextlib import asynccontextmanager
from datetime import date  # noqa: TC003  the SDK reads the annotation at runtime
from importlib.metadata import version
from pathlib import Path
from typing import TYPE_CHECKING, Any

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, InputRequiredResult, ToolAnnotations
from starlette.responses import JSONResponse

from kasten_backend import agent, agent_mcp_finance, files, page_store, skills, token_activity, vcs
from kasten_backend.agent_oauth import challenge
from kasten_backend.agent_routes import BEARER, REFUSED
from kasten_backend.config import DEFAULTS, get_settings
from kasten_backend.graph import MOST_DEPTH, GraphError
from kasten_backend.tokens import identify

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from mcp.server.mcpserver.context import Context
    from starlette.types import ASGIApp, Receive, Scope, Send

PATH = "/mcp"
"""The endpoint inside the SDK's own app, which the `/agent` mount completes."""

# Read off the package, not spelled in Python: prose in a string is unreadable in a diff.
TEMPLATE = (Path(__file__).parent / "mcp-instructions.md").read_text(encoding="utf-8").strip()
"""What a model is told about this vault before it calls anything, folders unnamed.

No channel reaches every client, so `instructions` and `read_guide` carry the same text.
Claude Code cuts instructions at 2KiB, so the key facts go first. Keep
`plugins/kasten/skills/vault/SKILL.md` in step: nothing reads one off the other.
"""

INSTRUCTIONS = DEFAULTS.fill(TEMPLATE)
"""The instructions on the default layout. `instructions()` is what is served."""


def instructions() -> str:
    """The instructions naming the folders this vault is configured with."""
    return get_settings().fill(TEMPLATE)


REDUNDANT = (
    "\n\nYou have just read this, so `read_guide` would only repeat it back. "
    "Do not call it: the clients it exists for are the ones that never saw this "
    "paragraph."
)
"""The one line the tool's own answer must never carry.

Only the `instructions` field gets it: a `read_guide` caller has not read the text yet.
"""

_serving: list[ASGIApp] = []
"""What the lifespan built, or nothing when the process is not serving.

A list, not a rebound global, so `mounted` can stay a plain function that reads it per request.
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


async def list_skills() -> list[dict[str, Any]]:
    """The Claude Code skills in the vault's skills folder, each with its description and files.

    Read only.
    """
    return [found.model_dump() for found in await skills.list_skills(get_settings())]


async def read_skill(path: str) -> dict[str, Any]:
    """Read one skill file, such as `close-day/SKILL.md`, relative to the skills folder.

    Read only: nothing writes a skill.
    """
    found = await skills.read_skill(get_settings(), path)
    if found is None:
        raise ToolError("No such skill file")

    return found.model_dump()


async def search_notes(query: str, archive: bool = False) -> list[dict[str, Any]]:
    """Every line in the vault holding `query`, ignoring case: notes, then pdf, epub and html.

    A note's hit is `path`, `line` and `text`. A hit in a file adds `place`:
    `kind` (pdf, epub or html), `label` (`page 3`, `Chapter 2, 41%` or the
    heading above the line), `page` (the pdf page, else null) and `anchor` (the
    html heading's id, else null). Its `line` counts lines of the file's
    extracted text, and read_note does not open the file, so cite its path and label.
    """
    hits = await agent.search_notes(get_settings(), query, archive)

    # Unset rather than null, so a note's hit answers as it did before files were searched.
    return [hit.model_dump(exclude_unset=True) for hit in hits]


async def save_note(path: str, content: str, sha: str | None = None) -> dict[str, Any]:
    """Write one note whole. `sha` is the digest of the note you read, or null to create it."""
    return await _written(agent.save_note(get_settings(), path, content, sha))


async def append_note(path: str, text: str, sha: str | None = None) -> dict[str, Any]:
    """Add text to the end of one note, creating it when there is none there."""
    return await _written(agent.append_note(get_settings(), path, text, sha))


async def dump(text: str, date: date) -> dict[str, Any]:
    """Add a thought to the `## Dump` section of the user's daily note for `date`.

    The dump is where the user collects the day's loose thoughts, and it is read
    at the end of the day to plan the next. Use this, not append_note, when the
    user asks you to dump, note or remember something for later without naming
    a note. `date` is the user's own local date as YYYY-MM-DD; there is no
    default, because the server may keep another timezone. The note and the
    section are made when missing, and the text lands as a paragraph of its own.
    """
    try:
        return await _written(agent.dump(get_settings(), text, date))
    except agent.EmptyCaptureError as empty:
        raise ToolError(str(empty)) from empty


async def save_file(
    path: str, url: str | None = None, content: str | None = None
) -> dict[str, Any]:
    """Save a file into the vault at `path`. Pass `url` or `content`, never both.

    `url` downloads a PDF, epub, image or sound from a public address. `path`
    ends in .pdf, .epub, .png, .jpg, .jpeg, .gif, .webp, .mp3, .m4a, .ogg or
    .wav, and the bytes must be that format. A file filed beside a note is the
    note's path with the suffix swapped, `20 Literature/DDIA.md` beside
    `20 Literature/DDIA.pdf`, and the app opens it in the reader next to the
    note. A file you hold only as an attachment has no URL and cannot come in
    this way.

    `content` is an HTML page's text, and `path` ends in .html. A later save to
    the same .html path replaces the page. Every other path is never
    overwritten: a taken path is refused. Up to 100MiB either way.
    """
    root = get_settings().vault_path
    try:
        if url is not None and content is None:
            landed = await files.download(root, path, url)
        elif content is not None and url is None:
            landed = await page_store.store_page(root, path, _page(content))
        else:
            raise ToolError(
                "Pass url for a PDF, epub, image or sound, or content for an .html page"
            )
    except files.RefusedError as refused:
        raise ToolError(str(refused)) from refused

    return {"path": landed}


async def _page(text: str) -> AsyncIterator[bytes]:
    """The page's text as the one chunk `page_store.store_page` reads."""
    yield text.encode()


async def query_graph(
    query: str = "", around: str | None = None, depth: int = 1, archive: bool = False
) -> dict[str, Any]:
    """The vault as a graph of notes and the links between them, or the rows a pattern matches.

    A filter narrows the notes: `type:Concept tag:#ai -path:"98 Archive"`,
    `rel:depends-on`, `is:orphan`, or bare words matching a name. A pattern asks
    a question and answers in `rows`: clauses split by `;`, each
    `subject relation object` or `subject filter`, where a subject or object is
    a `?variable` or a `[[note]]` and the relation is a name, `?variable`, `*`
    for any typed relation or `links` for any link. Example:
    `?paper supports [[GraphRAG]]; ?paper type:Source`. `around` and `depth`
    keep only the notes within that many links of one note. Prefer a pattern
    or `around` over the whole graph, which lists every note in the vault.
    """
    try:
        found = await agent.graph(
            get_settings(), query, around, max(0, min(depth, MOST_DEPTH)), archive
        )
    except GraphError as error:
        raise ToolError(str(error)) from error

    return found.model_dump()


async def read_guide() -> str:
    """How this vault is filed, what the other tools do, and what they cannot do.

    Call this first. It reads nothing from the vault and takes no argument: the
    text is compiled into the server, which is what makes it the one capability
    here that touches no note.
    """
    return instructions()


TOOLS = (
    list_notes,
    read_note,
    search_notes,
    query_graph,
    save_note,
    append_note,
    dump,
    save_file,
    read_guide,
    list_skills,
    read_skill,
    *agent_mcp_finance.TOOLS,
)
"""The ten capabilities, the guide and the finance reads, in the order the reference lists them.

`read_guide` is an extra tool, not a capability: it reads a string baked into the image,
never the vault. See docs/explanation/the-agent-boundary.md and its finance-reads page.
"""

READING = (
    frozenset(
        {
            "list_notes",
            "read_note",
            "search_notes",
            "query_graph",
            "read_guide",
            "list_skills",
            "read_skill",
        }
    )
    | agent_mcp_finance.READING
)
"""Which tools only read, told to the client as `readOnlyHint`.

Without it chatgpt.com asks you to confirm every call, so a search would need one press per note.
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
    """The SDK's DNS-rebinding protection, set to the `Host` this vault answers to.

    Passing None would make the SDK allow only localhost, so every request through Caddy gets a 421.
    """
    if not host:
        return TransportSecuritySettings(enable_dns_rebinding_protection=False)

    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[host, f"{host}:*"],
        # Browser products send no `Origin`, so the check passes. Naming these stops a
        # 403 on every tool call when one is sent.
        allowed_origins=[
            f"https://{host}",
            f"http://{host}",
            "https://claude.ai",
            "https://claude.com",
            "https://chatgpt.com",
        ],
    )


def _gate(inner: ASGIApp) -> ASGIApp:
    """`inner`, behind the bearer check the `/agent/` routes carry.

    An ASGI wrapper rather than a dependency, because a dependency does not reach a mounted app.
    It sets `vcs.writer` as `require_token` does, so MCP writes are not logged as browser edits.
    """

    async def gated(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await inner(scope, receive, send)
            return

        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1")
        header = headers.get(b"authorization", b"").decode("latin-1")
        found = (
            await identify(get_settings().tokens_path, header.removeprefix(BEARER))
            if header.startswith(BEARER)
            else None
        )
        if found is not None:
            token_activity.named(found[0], revoked=found[1])
        # Before the method check, so a caller with no token learns nothing about this endpoint.
        if found is None or found[1]:
            await JSONResponse(
                {"detail": REFUSED},
                status_code=401,
                # The one thing that turns this refusal into a sign-in. A browser product has no
                # field for it, so this header is how it learns there is an authorization server.
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

        held = vcs.writer.set(found[0])
        try:
            await inner(scope, receive, send)
        finally:
            vcs.writer.reset(held)

    return gated


class _Recorded(MCPServer):
    """The server, with each tool call named in the activity log.

    Overridden at `call_tool`, the one method every call passes. The SDK turns a
    raised error into an error result, so failure is read off the result too.
    """

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        context: Context[Any, Any] | None = None,
    ) -> CallToolResult | InputRequiredResult:
        token_activity.called(name, arguments)
        answered = False
        try:
            result = await super().call_tool(name, arguments, context)
            answered = True
        finally:
            if not answered:
                token_activity.failed()

        if isinstance(result, CallToolResult) and result.is_error:
            token_activity.failed()
        return result


def build() -> tuple[ASGIApp, MCPServer]:
    """The streamable-HTTP app behind the bearer check, and the server behind it.

    The server is returned too: its session manager exists only after this call.
    """
    server: MCPServer = _Recorded(
        name="kasten",
        version=version("kasten-backend"),
        instructions=instructions() + REDUNDANT,
    )
    for tool in TOOLS:
        # Snake_case here, `readOnlyHint` on the wire, which is where the test reads it.
        server.add_tool(tool, annotations=ToolAnnotations(read_only_hint=tool.__name__ in READING))

    inner = server.streamable_http_app(
        streamable_http_path=PATH,
        # Stateless and JSON: each POST carries a whole exchange, and every answer is one message.
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
    """What `main.py` mounts at `/agent`: what the lifespan built, or nothing yet.

    The mount is registered once, but the app behind it changes on every lifespan entry.
    """
    if not _serving:
        await JSONResponse({"detail": "The agent endpoint is not running"}, status_code=503)(
            scope, receive, send
        )
        return

    await _serving[-1](scope, receive, send)
