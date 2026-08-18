"""The `/agent/` routes and the bearer check in front of every one of them.

This prefix is the one Caddy block with no `oauth2_auth`, so the check below is
the entire trust boundary between a stranger and the vault. It hangs off the
router's constructor rather than off each route, which makes every route under
it gated by construction: a route added later cannot forget.

Nothing here decides what a capability does. That is `agent.py`, which the MCP
tools call too.
"""

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

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
