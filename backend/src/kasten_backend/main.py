"""FastAPI application entrypoint."""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from importlib.metadata import version
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from kasten_backend import (
    agent_mcp,
    anki,
    db,
    food,
    log,
    push,
    token_activity,
    training,
    uploads,
)
from kasten_backend.agent import ConflictError, EmptyCaptureError, TooLargeError
from kasten_backend.agent_oauth import router as oauth_router
from kasten_backend.agent_routes import (
    note_changed,
    nothing_to_capture,
    reading_router,
    refused,
    too_large,
)
from kasten_backend.agent_routes import router as agent_router
from kasten_backend.books import route as books_route
from kasten_backend.build import build_id
from kasten_backend.change import settled
from kasten_backend.config import Settings, get_settings
from kasten_backend.events import KEEPALIVE, format_retry, format_sse, watch_vault
from kasten_backend.files import RefusedError
from kasten_backend.finance.routes.budget import budget as finance_budget
from kasten_backend.finance.routes.budget import drill as finance_drill
from kasten_backend.finance.routes.budget import range as finance_range
from kasten_backend.finance.routes.feeds import orders as finance_orders
from kasten_backend.finance.routes.feeds import sync as finance_sync
from kasten_backend.finance.routes.plans import goals as finance_goals
from kasten_backend.finance.routes.plans import plans as finance_plans
from kasten_backend.finance.routes.records import records as finance
from kasten_backend.finance.routes.records import sorting as finance_sorting
from kasten_backend.finance.routes.records.guard import FinanceGuard
from kasten_backend.finance.routes.tax import receipts as finance_receipts
from kasten_backend.finance.routes.tax import tax as finance_tax
from kasten_backend.food import plan, recipes
from kasten_backend.guide import write_guide
from kasten_backend.okf import prepare
from kasten_backend.pieces import indexer
from kasten_backend.pieces import route as pieces_route
from kasten_backend.routes import (
    assets,
    github,
    listing,
    model_use,
    moves,
    notes,
    queries,
    rsvp,
    search,
    share,
    tokens,
    web,
)
from kasten_backend.trash import purge_trash
from kasten_backend.vcs import is_versioned, write_ignores

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, AsyncIterator

    from starlette.types import ASGIApp, Message, Receive, Scope, Send

    from kasten_backend.events import VaultEvent

logger = logging.getLogger(__name__)


def warn_unsafe(settings: Settings) -> None:
    """Warn at startup about what this setup leaves open, without refusing to start.

    Dev from a fresh checkout runs with these gaps, so they stay warnings.
    """
    if not settings.agent_host:
        logger.warning(
            "KASTEN_AGENT_HOST is empty: the MCP endpoint answers any Host, so its "
            "DNS-rebinding protection is off, and the OAuth issuer is read off each "
            "request. Set it to the public hostname on a server."
        )
    if not is_versioned(settings.vault_path):
        logger.warning(
            "%s has no .jj directory, so saves are not recorded in any history",
            settings.vault_path,
        )


def _push_stopped(task: asyncio.Task[None]) -> None:
    """Log the error that ended the push sender, which would otherwise stop every push unseen."""
    if not task.cancelled() and (error := task.exception()) is not None:
        logger.error("push sender stopped; no push goes out until a restart", exc_info=error)


clock = time.perf_counter
"""What `SlowRequests` times with; a test swaps it so no test waits on real time."""

PATH_CAP = 1024
"""The most characters of a path a slow-request line keeps."""


def _stays_open(method: str, path: str) -> bool:
    """Whether the request is a stream that stays open by design, so its length means nothing."""
    path = path.rstrip("/")
    return path in {"/api/events", "/share/events"} or (method == "GET" and path == "/agent/mcp")


def _is_stream(message: Message) -> bool:
    """Whether the answer is server-sent events, which stay open whatever their path."""
    return any(
        name.lower() == b"content-type" and value.startswith(b"text/event-stream")
        for name, value in message.get("headers", [])
    )


class SlowRequests:
    """Log method, path, status and milliseconds of a request over `slow_request_ms`.

    Logs the path alone, never the query string, which can hold a token.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap `app`, the rest of the stack."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Time the request to its last byte, and log it if it ran over."""
        if scope["type"] != "http" or _stays_open(scope["method"], scope["path"]):
            await self.app(scope, receive, send)
            return

        start = clock()
        status = 500
        streamed = False

        async def sending(message: Message) -> None:
            nonlocal status, streamed
            if message["type"] == "http.response.start":
                status = message["status"]
                streamed = _is_stream(message)
            await send(message)

        # Not `finally`: a client that leaves cancels the request, which is no 500.
        try:
            await self.app(scope, receive, sending)
        except Exception:
            if not streamed:
                _report(scope, status, start)
            raise
        if not streamed:
            _report(scope, status, start)


def _report(scope: Scope, status: int, start: float) -> None:
    ms = (clock() - start) * 1000
    if ms > get_settings().slow_request_ms:
        # %r keeps a decoded newline in the path from starting a forged line.
        logger.warning(
            "slow request: %s %r %d %.0f ms", scope["method"], scope["path"][:PATH_CAP], status, ms
        )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Write the vault's guides and types, and purge old trash.

    The settings are read here because no request exists to inject them.
    """
    settings = get_settings()
    warn_unsafe(settings)
    # Before the guide, whose jj snapshot would sweep in a book already in the vault.
    write_ignores(settings.vault_path)
    await write_guide(settings.vault_path)
    # After the guides, so the backfill reads a vault that has finished writing.
    await prepare(settings.vault_path)
    await purge_trash(settings.vault_path, settings.trash_days)
    uploads.wipe(settings.upload_path)
    sweeping = asyncio.create_task(uploads.sweeping(settings.upload_sweep_seconds))
    pushing = (
        None
        if settings.push_private_key is None
        else asyncio.create_task(push.running(db.engine, settings))
    )
    if pushing is not None:
        pushing.add_done_callback(_push_stopped)
    # After the backfill and guides, so the first index sees the vault as this start leaves it.
    indexing = indexer.start(settings)
    try:
        # A mounted app skips its own lifespan, and the MCP session manager is
        # single-use, so it is rebuilt on every entry.
        async with agent_mcp.serving():
            yield
    finally:
        sweeping.cancel()
        if pushing is not None:
            pushing.cancel()
        if indexing is not None:
            indexing.cancel()
        # After requests close, so only a running import is left to stop.
        await anki.stop()
        # Last, so the history holds every save this process answered.
        await settled()


app = FastAPI(title="kasten", version=version("kasten-backend"), lifespan=lifespan)
"""Version comes from the installed package, so it cannot drift from the release tag."""

app.include_router(oauth_router)
"""Must stay above the `/agent` mount: a mount matches by prefix, so the token route
would reach the bearer check and answer 401.
"""

app.include_router(agent_router)
app.include_router(reading_router)
app.add_exception_handler(ConflictError, note_changed)
app.add_exception_handler(TooLargeError, too_large)
app.add_exception_handler(EmptyCaptureError, nothing_to_capture)
app.add_exception_handler(RefusedError, refused)
app.mount("/agent", agent_mcp.mounted)
"""Mounted at `/agent`, not `/agent/mcp`: the SDK app owns `/mcp`, so a deeper mount would redirect.

After the router above, so its routes match first. Bearer-gated, not behind oauth2-proxy.
"""

KEEPALIVE_SECONDS = 30.0
"""How long a quiet stream waits before writing a keepalive line.

Short enough to beat the idle timeout of either proxy in front.
"""

RECONNECT_SECONDS = 30.0
"""How long the client waits before reconnecting after the stream closes.

The browser's default is about three seconds, and a stream that closes at once
would make the client relist the vault in a tight loop.
"""


class Health(BaseModel):
    """Liveness response."""

    status: str


class Build(BaseModel):
    """What the backend is running, for the reading in the status bar."""

    backend: str


@app.get("/api/health")
async def health() -> Health:
    """Report that the process is up. Deliberately does not touch the database."""
    return Health(status="ok")


@app.get("/api/version")
async def read_build() -> Build:
    """Name the code that is answering: the release, or the commit in development.

    Its own route rather than a field on `/api/health`, which the deploy polls
    and which is documented as saying nothing but whether the process is up.
    """
    return Build(backend=build_id())


app.include_router(listing.router)
app.include_router(web.router)
app.include_router(queries.router)
app.include_router(search.router)
app.include_router(pieces_route.router)
app.include_router(push.router)
app.include_router(books_route.router)
app.include_router(github.router)
app.include_router(model_use.router)
app.include_router(log.router)
app.include_router(training.router)
app.include_router(food.router)
app.include_router(recipes.router)
app.include_router(plan.router)
app.include_router(anki.router)
app.include_router(tokens.router)
app.include_router(finance.router)
app.include_router(finance_budget.router)
app.include_router(finance_drill.router)
app.include_router(finance_range.router)
app.include_router(finance_plans.router)
app.include_router(finance_goals.router)
app.include_router(finance_orders.router)
app.include_router(finance_sorting.router)
app.include_router(finance_sync.router)
app.include_router(finance_receipts.router)
app.include_router(finance_tax.router)
app.include_router(share.router)
app.include_router(rsvp.router)
app.add_middleware(share.ShareGate)
app.add_middleware(FinanceGuard)
"""Added on the app, not a router, so these see requests no route answers."""
app.add_middleware(token_activity.Recorder)
"""Outside the two above: the row keeps the status the client got, not an inner rewrite."""
app.add_middleware(SlowRequests)
"""Added last, so outermost: the time covers every other middleware."""


@app.get("/api/events")
async def stream_events(settings: Annotated[Settings, Depends(get_settings)]) -> StreamingResponse:
    """Report every change to the vault, kasten's own writes included.

    Server-sent events, one `data:` line per changed note. The traffic runs one
    way, so this needs none of a WebSocket's machinery, and the browser
    reconnects on its own.

    Nothing here knows which write was kasten's, and nothing tries to: the
    digest is what settles that at the other end, where the client holds the
    text it sent and can see its own save come back.

    The stream carries no note text, only the path, what happened and a digest
    of what is now on disk. A client that wants the new content reads the note
    the way it always does.

    The watcher lives as long as the connection. Starlette closes this generator
    when the client goes away, which ends the watch with it, so nothing is left
    running for a reader that has gone.
    """

    async def report() -> AsyncIterator[str]:
        # Sent first, so a stream that closes early still tells the client when to retry.
        yield format_retry(RECONNECT_SECONDS)

        # Its own task: a timeout cancels `__anext__`, which would end the watcher.
        batches: asyncio.Queue[list[VaultEvent] | None] = asyncio.Queue()

        async def collect() -> None:
            try:
                async for events in watch_vault(settings.vault_path):
                    batches.put_nowait(events)
            finally:
                # Also on a raise. EventSource reconnects only from a closed stream,
                # so keepalives over a dead watcher would hide the failure.
                batches.put_nowait(None)

        watching = asyncio.create_task(collect())
        try:
            while True:
                try:
                    events = await asyncio.wait_for(batches.get(), KEEPALIVE_SECONDS)
                except TimeoutError:
                    yield KEEPALIVE
                    continue

                if events is None:
                    # Awaited so a failed watcher logs why it died.
                    await watching
                    return

                for event in events:
                    yield format_sse(event)
        finally:
            watching.cancel()

    return StreamingResponse(report(), media_type="text/event-stream")


app.include_router(assets.router)
app.include_router(notes.router)
app.include_router(moves.router)
