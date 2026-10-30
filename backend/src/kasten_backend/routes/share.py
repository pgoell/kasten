"""The `/share/` routes the shared lists app reads and ticks through, and its host's gate.

What a list is and how an edit lands is in `kasten_backend/share.py`.
"""

import asyncio
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from kasten_backend import share, share_history, vcs
from kasten_backend.config import Settings, get_settings
from kasten_backend.events import KEEPALIVE, format_retry, format_sse, watch_vault

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from starlette.types import ASGIApp, Receive, Scope, Send

    from kasten_backend.events import VaultEvent

KEEPALIVE_SECONDS = 30.0
"""How long a quiet stream waits before a keepalive, the same as `main.py`'s stream.

Repeated here rather than imported because `main.py` imports this module.
"""

RECONNECT_SECONDS = 30.0
"""How long the client waits before it opens the stream again, the same as `main.py`'s."""


def person_of(settings: Settings, request: Request) -> str | None:
    """The person the proxy's sign-in address stands for, or None when no listed address came.

    Only the header `oauth2-proxy-liste` sends is trusted; an unlisted address writes as `share`.
    """
    email = request.headers.get("x-auth-request-email")
    return None if email is None else settings.share_people.get(email.strip().lower())


def people_of(settings: Settings) -> list[str]:
    """The person names in the order the settings list them, each once."""
    return list(dict.fromkeys(settings.share_people.values()))


async def as_share(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> AsyncIterator[None]:
    """Name every write under these routes after its person, or `share`, and reset the name.

    A yield dependency, like `require_token`: without the reset the name leaks to the next request.
    """
    person = person_of(settings, request)
    held = vcs.writer.set("share" if person is None else f"share:{person}")
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


class Assign(BaseModel):
    """Whose item a line is, by name, or None to clear it, and the digest of the list read."""

    line: int
    assignee: str | None
    sha: str


class Me(BaseModel):
    """Who is asking, if the proxy's address is a listed one, and the people the app offers."""

    me: str | None
    people: list[str]


def _found(found: share.Checklist | None) -> share.Checklist:
    """The list, or the 404 a name outside the share folder earns."""
    if found is None:
        raise HTTPException(status_code=404, detail="No such list")

    return found


async def _answer(settings: Settings, found: share.Checklist | None) -> share.Checklist:
    """The list with who ticked each done item, which every list answer carries."""
    return await share_history.attach(settings, _found(found))


@router.get("/me")
async def me(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> Me:
    """The person behind the proxy's address, and the people the lists offer in the menu."""
    return Me(me=person_of(settings, request), people=people_of(settings))


@router.get("/lists")
async def list_names(settings: Annotated[Settings, Depends(get_settings)]) -> list[str]:
    """The names of the lists in the share folder, without their `.md`."""
    return share.names(settings)


@router.get("/lists/{name:path}")
async def read_list(
    name: str, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """One list with its task lines, or an empty one when the note is not there yet."""
    return await _answer(settings, await share.read(settings, name))


@router.post("/lists/{name:path}/items")
async def add_item(
    name: str, body: Add, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """Append an item to a list, creating the list when `sha` is absent and it is missing."""
    return await _answer(settings, await share.add(settings, name, body.text, body.sha))


@router.post("/lists/{name:path}/tick")
async def tick_item(
    name: str, body: Tick, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """Tick or untick the item on one line of a list.

    A tick on a recurring item or one with parts is refused with 422, since kasten
    does more on its own tick than this path does. Unticking has no such limit.
    """
    try:
        found = await share.tick(settings, name, body.line, body.done, body.sha)
    except share.TickInKastenError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return await _answer(settings, found)


@router.post("/lists/{name:path}/assign")
async def assign_item(
    name: str, body: Assign, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """Set or clear whose item one line of a list is. A name the app does not list answers 422."""
    if body.assignee is not None and body.assignee not in people_of(settings):
        raise HTTPException(status_code=422, detail="Not one of the people")

    found = await share.assign(settings, name, body.line, body.assignee, body.sha)
    return await _answer(settings, found)


@router.post("/lists/{name:path}/clear")
async def clear_done(
    name: str, body: Clear, settings: Annotated[Settings, Depends(get_settings)]
) -> share.Checklist:
    """Remove every ticked item from a list, and nothing else."""
    return await _answer(settings, await share.clear(settings, name, body.sha))


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
                    if share.passes(settings, event):
                        yield format_sse(event)
        finally:
            watching.cancel()

    return StreamingResponse(report(), media_type="text/event-stream")


class ShareGate:
    """Answer the share host with 404 for every path outside `/share/`, before any route runs.

    The lists app's hostname is public, so it must not reach the notebook's API, agent or docs.
    Pure ASGI, not `app.middleware("http")`: that wraps the receive channel, so a dropped
    upload reaches its route as an error and it buffers streamed responses.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap `app`, the whole application the gate stands in front of."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Answer a connection to the share host outside `/share/`, and pass every other on."""
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        share_host = get_settings().share_host
        headers = dict(scope["headers"])
        host = headers.get(b"host", b"").decode("latin-1").split(":")[0].lower()
        if share_host and host == share_host and not scope["path"].startswith("/share/"):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return

            response = JSONResponse(status_code=404, content={"detail": "Not here"})
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
