"""The `/share/` routes the shared lists app reads and ticks through, and the gate on its host.

What a list is and how an edit lands is `share.py`. This file is the HTTP surface
over it, plus the one rule that keeps the share host to these routes.
"""

import asyncio
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from kasten_backend import share, vcs
from kasten_backend.config import Settings, get_settings
from kasten_backend.events import KEEPALIVE, format_retry, format_sse, watch_vault

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable

    from fastapi import Request
    from starlette.responses import Response

    from kasten_backend.events import VaultEvent

KEEPALIVE_SECONDS = 30.0
"""How long a quiet stream waits before a keepalive, the same as `main.py`'s stream.

Repeated here rather than imported because `main.py` imports this module.
"""

RECONNECT_SECONDS = 30.0
"""How long the client waits before it opens the stream again, the same as `main.py`'s."""


async def as_share() -> AsyncIterator[None]:
    """Name every write made under these routes `share`, and reset the name after.

    A yield dependency for the reason `require_token` is one: without the reset the
    name leaks into the next request, and a save made by the notebook afterwards
    would be recorded in the history as the lists app's.
    """
    held = vcs.writer.set("share")
    try:
        yield
    finally:
        vcs.writer.reset(held)


router = APIRouter(prefix="/share", dependencies=[Depends(as_share)], tags=["share"])


class Add(BaseModel):
    """One item to append, and the digest of the list the caller read, if it read one."""

    text: str
    sha: str | None = None


class Tick(BaseModel):
    """Which line to tick or untick, and the digest of the list the caller read."""

    line: int
    done: bool
    sha: str


class Clear(BaseModel):
    """The digest of the list the caller read, before the ticked items go."""

    sha: str


def _found(found: share.Checklist | None) -> share.Checklist:
    """The list, or the 404 a name outside the share folder earns."""
    if found is None:
        raise HTTPException(status_code=404, detail="No such list")

    return found


@router.get("/lists")
async def list_names(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """The names of the lists in the share folder, without their `.md`."""
    return share.names(settings)


@router.get("/lists/{name:path}")
async def read_list(
    name: str, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """One list with its task lines, or an empty one when the note is not there yet."""
    return _found(await share.read(settings, name))


@router.post("/lists/{name:path}/items")
async def add_item(
    name: str, body: Add, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """Append an item to a list, creating the list when `sha` is absent and it is missing."""
    return _found(await share.add(settings, name, body.text, body.sha))


@router.post("/lists/{name:path}/tick")
async def tick_item(
    name: str, body: Tick, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """Tick or untick the item on one line of a list."""
    return _found(await share.tick(settings, name, body.line, body.done, body.sha))


@router.post("/lists/{name:path}/clear")
async def clear_done(
    name: str, body: Clear, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """Remove every ticked item from a list, and nothing else."""
    return _found(await share.clear(settings, name, body.sha))


@router.get("/events")
async def stream_events(settings: Annotated[Settings, Depends(get_settings)]) -> StreamingResponse:
    """Report every change to a note in the share folder, in the wire format `/api/events` uses.

    The filter runs one event at a time, after the watcher, so a change anywhere
    else is never written to the stream at all. The shape otherwise follows
    `main.py`'s stream: the watcher runs in a task of its own, so a keepalive can
    be written without cancelling it.
    """

    async def report() -> AsyncIterator[str]:
        yield format_retry(RECONNECT_SECONDS)

        batches: asyncio.Queue[list[VaultEvent] | None] = asyncio.Queue()

        async def collect() -> None:
            try:
                async for events in watch_vault(settings.vault_path):
                    batches.put_nowait(events)
            finally:
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
                    await watching
                    return

                for event in events:
                    if share.inside(settings, event.path):
                        yield format_sse(event)
        finally:
            watching.cancel()

    return StreamingResponse(report(), media_type="text/event-stream")


async def share_gate(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Answer the share host with 404 for every path outside `/share/`, before any route runs.

    The lists app is served on a public hostname, and that hostname must not reach
    the notebook's API, the agent or the docs. Settings are read here rather than
    injected, because middleware sits outside dependency injection.
    """
    settings = get_settings()
    on_share_host = bool(settings.share_host) and request.url.hostname == settings.share_host
    if on_share_host and not request.url.path.startswith("/share/"):
        return JSONResponse(status_code=404, content={"detail": "Not here"})

    return await call_next(request)
