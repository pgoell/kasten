"""FastAPI application entrypoint."""

import asyncio
import logging
from contextlib import asynccontextmanager
from importlib.metadata import version
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from kasten_backend import agent_mcp, food, log, token_activity, uploads
from kasten_backend.agent import ConflictError, EmptyCaptureError, TooLargeError
from kasten_backend.agent_oauth import router as oauth_router
from kasten_backend.agent_routes import note_changed, nothing_to_capture, refused, too_large
from kasten_backend.agent_routes import router as agent_router
from kasten_backend.build import build_id
from kasten_backend.config import Settings, get_settings
from kasten_backend.events import KEEPALIVE, format_retry, format_sse, watch_vault
from kasten_backend.files import RefusedError
from kasten_backend.finance_guard import FinanceGuard
from kasten_backend.guide import write_guide
from kasten_backend.okf import prepare
from kasten_backend.pieces import indexer
from kasten_backend.pieces import route as pieces_route
from kasten_backend.routes import (
    anki,
    anki_imports,
    assets,
    finance,
    finance_budget,
    finance_drill,
    finance_goals,
    finance_orders,
    finance_plans,
    finance_range,
    finance_receipts,
    finance_sorting,
    finance_sync,
    finance_tax,
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
    from collections.abc import AsyncIterator

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


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
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
    # After the backfill and guides, so the first index sees the vault as this start leaves it.
    indexing = indexer.start(settings)
    try:
        # A mounted app skips its own lifespan, and the MCP session manager is
        # single-use, so it is rebuilt on every entry.
        async with agent_mcp.serving():
            yield
    finally:
        sweeping.cancel()
        if indexing is not None:
            indexing.cancel()
        # After requests close, so only a running import is left to stop.
        await anki_imports.stop()


app = FastAPI(title="kasten", version=version("kasten-backend"), lifespan=lifespan)
"""Version comes from the installed package, so it cannot drift from the release tag."""

app.include_router(oauth_router)
"""Must stay above the `/agent` mount: a mount matches by prefix, so the token route
would reach the bearer check and answer 401.
"""

app.include_router(agent_router)
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
app.include_router(github.router)
app.include_router(model_use.router)
app.include_router(log.router)
app.include_router(food.router)
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
"""Added last, so outermost: the row keeps the status the client got, not an inner rewrite."""


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
