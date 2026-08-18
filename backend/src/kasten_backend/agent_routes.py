"""The `/agent/` routes and the bearer check in front of every one of them.

This prefix is the one Caddy block with no `oauth2_auth`, so the check below is
the entire trust boundary between a stranger and the vault. It hangs off the
router's constructor rather than off each route, which makes every route under
it gated by construction: a route added later cannot forget.

Nothing here decides what a capability does. That is `agent.py`, which the MCP
tools call too.
"""

from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse

from kasten_backend import agent, vcs
from kasten_backend.config import Settings, get_settings
from kasten_backend.tokens import verify

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

BEARER = "Bearer "
"""The one scheme this accepts. Anything else is refused before the store is read."""

REFUSED = "That is not a token this vault knows"
"""One sentence for every refusal, so the answer says nothing about which it was."""


async def require_token(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> AsyncIterator[str]:
    """Refuse anyone without a token in the store, and name the one who has it.

    A yield dependency because `vcs.writer` has to be reset. Without the reset
    the name leaks across requests in an in-process ASGI test, and a browser save
    following an agent save would be recorded as an agent write.

    Nothing is held between requests, so a revoked token is refused on the very
    next one rather than when a cache expires.
    """
    header = request.headers.get("Authorization", "")
    if not header.startswith(BEARER):
        raise HTTPException(status_code=401, detail=REFUSED)

    name = await verify(settings.tokens_path, header.removeprefix(BEARER))
    if name is None:
        raise HTTPException(status_code=401, detail=REFUSED)

    held = vcs.writer.set(name)
    try:
        yield name
    finally:
        vcs.writer.reset(held)


router = APIRouter(prefix="/agent", dependencies=[Depends(require_token)], tags=["agent"])


@router.get("/notes/{path:path}")
async def read_note(
    path: str, settings: Annotated[Settings, Depends(get_settings)]
) -> agent.NoteRead:
    """Read one note, with the digest a conditional write presents back."""
    found = await agent.read_note(settings, path)
    if found is None:
        raise HTTPException(status_code=404, detail="No such note")

    return found


@router.get("/notes")
async def list_notes(
    settings: Annotated[Settings, Depends(get_settings)], folder: str = ""
) -> list[str]:
    """List every note in the vault, or every note in one folder of it."""
    return await agent.list_notes(settings, folder)


@router.get("/search")
async def search_notes(
    q: str, settings: Annotated[Settings, Depends(get_settings)], archive: bool = False
) -> list[agent.Hit]:
    """Find every line in the vault holding `q`, ignoring case."""
    return await agent.search_notes(settings, q, archive)


@router.get("/openapi.json")
async def schema(request: Request) -> dict[str, Any]:
    """This prefix, described as OpenAPI, for a caller with no MCP client.

    An agent over MCP discovers the five capabilities from `tools/list`. One
    holding a token and a curl has nothing to read, because `/openapi.json` at
    the root is behind oauth2-proxy and describes the browser's API rather than
    this one.

    Built from this router's own routes rather than by filtering the whole
    application's schema, so it names the five and pulls in only the models they
    reference. A token holder cannot reach anything under `/api/`, and handing
    one the map of those routes would give it away for nothing.
    """
    return get_openapi(
        title=f"{request.app.title} agent API",
        version=request.app.version,
        routes=router.routes,
    )


@router.put("/notes/{path:path}")
async def save_note(
    path: str, edit: agent.Save, settings: Annotated[Settings, Depends(get_settings)]
) -> agent.NoteRead:
    """Write one note, creating it when `sha` is absent and the note is."""
    return _written(await agent.save_note(settings, path, edit.content, edit.sha))


@router.post("/notes/{path:path}/append")
async def append_note(
    path: str, edit: agent.Append, settings: Annotated[Settings, Depends(get_settings)]
) -> agent.NoteRead:
    """Add a line to the end of one note, creating it when there is none."""
    return _written(await agent.append_note(settings, path, edit.text, edit.sha))


def _written(landed: agent.NoteRead | None) -> agent.NoteRead:
    """What the write left on disk, or the refusal a path the vault will not take earns."""
    if landed is None:
        raise HTTPException(status_code=404, detail="No such note")

    return landed


async def note_changed(_request: Request, error: Exception) -> JSONResponse:
    """Answer a refused write with the digest the caller needs to re-read and retry.

    Registered on the app in `main.py`, an exception handler belonging to the
    application rather than to a router. The body is the one the MCP tool error
    carries word for word, so both surfaces refuse in the same words.
    """
    # Narrowed rather than annotated. Starlette types every handler's second
    # argument as `Exception`, and this one is registered for one class.
    current = error.current if isinstance(error, agent.ConflictError) else None

    return JSONResponse(status_code=409, content={"detail": str(error), "current": current})


async def too_large(_request: Request, error: Exception) -> JSONResponse:
    """Answer a write that would leave more than `MOST_CONTENT_BYTES` on disk."""
    return JSONResponse(status_code=413, content={"detail": str(error)})
