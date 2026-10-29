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
    """Say at startup what this setup leaves open, without refusing to start.

    Warnings rather than errors, because both are what dev from a fresh
    checkout runs with. On a server either one is a gap nothing else would
    point out until it mattered.
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
    """Give the vault its guides and its types, and empty what the trash has held too long.

    The settings are read rather than injected: there is no request to depend
    on, and the vault the process serves is the vault this writes into.
    """
    settings = get_settings()
    warn_unsafe(settings)
    # Before the guide, whose write takes a jj snapshot. A book already sitting
    # in the vault would be swept into it.
    write_ignores(settings.vault_path)
    await write_guide(settings.vault_path)
    # After the guides and before the purge: the backfill inside this reads the
    # vault, and it should read one that is finished being written to.
    await prepare(settings.vault_path)
    await purge_trash(settings.vault_path, settings.trash_days)
    uploads.wipe(settings.upload_path)
    sweeping = asyncio.create_task(uploads.sweeping(settings.upload_sweep_seconds))
    # After the backfill and the guides, so the first sweep reads the vault as
    # this start leaves it rather than embedding notes about to change.
    indexing = indexer.start(settings)
    try:
        # A mounted sub-application does not run its own lifespan, and the MCP
        # session manager is single-use, so the endpoint is built here and
        # rebuilt on every entry rather than once at import.
        async with agent_mcp.serving():
            yield
    finally:
        sweeping.cancel()
        if indexing is not None:
            indexing.cancel()
        # After the requests have closed, so an import past its answer is the
        # only thing left to stop, and it undoes its writes as it goes.
        await anki_imports.stop()


app = FastAPI(title="kasten", version=version("kasten-backend"), lifespan=lifespan)
"""The number is read off the installed package rather than written here.

Two copies of it drifted apart once already: the release was cut, the tag moved
and this string did not, so `/docs` reported a version behind the code serving
it. The release tag is the one place it lives now: the backend image build
writes it into the package, and the source tree says 0.0.0.
"""

app.include_router(oauth_router)
"""The authorization server the browser products connect through.

Above the mount, and that is the whole of why the order here matters: a mount
matches by prefix, so `/agent/oauth/token` registered below it would resolve to
the MCP app, meet the bearer check and answer 401 to the one caller that cannot
have a token yet. See `agent_oauth.py`.
"""

app.include_router(agent_router)
app.add_exception_handler(ConflictError, note_changed)
app.add_exception_handler(TooLargeError, too_large)
app.add_exception_handler(EmptyCaptureError, nothing_to_capture)
app.add_exception_handler(RefusedError, refused)
app.mount("/agent", agent_mcp.mounted)
"""The MCP endpoint, at exactly `/agent/mcp`.

Mounted after the router above, so every path it names is matched by a route
before this is reached. Mounted at `/agent` rather than at `/agent/mcp` because
the SDK's app owns `/mcp` internally: the deeper mount would answer the
documented URL with a redirect.
"""
"""The one prefix reached without an oauth2-proxy session in front of it.

Gated by the router's own bearer dependency instead. See `agent_routes.py` and
docs/explanation/the-agent-boundary.md.
"""

KEEPALIVE_SECONDS = 30.0
"""How long a quiet stream waits before writing a line that says nothing.

Long enough to cost nothing, short enough to beat an idle timeout on either
proxy in front of it. The line itself is `KEEPALIVE`, over in `events.py` with
the rest of the wire format.
"""

RECONNECT_SECONDS = 30.0
"""How long the client waits before opening the stream again after it closes.

The browser's own default is about three seconds, and a stream that closes the
moment it opens turns that into a loop: the client relists the vault on every
connection, so a missing vault directory or a watcher that cannot start would
cost twenty relists a minute for as long as the condition holds. This makes it
two. It matches `KEEPALIVE_SECONDS` by coincidence rather than by need.
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
"""The shared lists, and the gate that keeps the share host to them.

The gate is registered here rather than in a router because it has to see every
request, the ones the routes above do not answer included.
"""
app.add_middleware(token_activity.Recorder)
"""Added last, so it is the outermost layer and records the status the client got.

Whatever layer answered, the row carries that answer's status, not one an inner
layer rewrote on the way out.
"""


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
        # Before the watcher is even asked for, because both of the ways this
        # stream closes early close it before anything else could be written,
        # and those are the two that make the number matter.
        yield format_retry(RECONNECT_SECONDS)

        # The watcher fills a queue from a task of its own rather than being
        # read directly, so the wait below can time out without touching it.
        # Cancelling a generator's `__anext__` is what a timeout does, and
        # `awatch` answers that by ending, which would trade a live watcher for
        # every keepalive written.
        batches: asyncio.Queue[list[VaultEvent] | None] = asyncio.Queue()

        async def collect() -> None:
            try:
                async for events in watch_vault(settings.vault_path):
                    batches.put_nowait(events)
            finally:
                # Every way out of the watcher has to end up here, a raise as
                # much as a return. A stream that keeps writing keepalives over
                # a watcher that died looks healthier than one that closed, and
                # `EventSource` reconnects from closed and never from this. The
                # silence would be exactly the loss this endpoint exists to
                # prevent, and an exhausted inotify limit is enough to cause it.
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
                    # Awaited rather than dropped, so a watcher that fell over
                    # says why in the log on its way out. It raises here, which
                    # closes the stream just as returning would.
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
