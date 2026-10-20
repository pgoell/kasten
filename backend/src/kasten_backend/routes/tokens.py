"""Routes that mint, list and revoke the agent tokens the MCP endpoint checks."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from kasten_backend.config import Settings, get_settings
from kasten_backend.tokens import Minted, Token, listing, mint, revoke

router = APIRouter()


class TokenName(BaseModel):
    """What a mint is asked for: a name to tell one token from another."""

    name: str


@router.get("/api/tokens")
async def read_tokens(settings: Annotated[Settings, Depends(get_settings)]) -> list[Token]:
    """Every agent token the store holds, by name and creation date.

    Never a digest and never a secret. Only the digest is kept at all, so there
    is no way back to a secret from here even by mistake.
    """
    return await listing(settings.tokens_path)


@router.post("/api/tokens", status_code=201)
async def create_token(
    named: TokenName, settings: Annotated[Settings, Depends(get_settings)]
) -> Minted:
    """Mint one agent token, and hand back the only copy of its secret.

    Under `/api/`, so it inherits oauth2-proxy and needs no authentication of
    its own. That does put minting inside the internal trust zone, which
    `the-agent-boundary.md` states plainly: the shell container reaches this
    over the docker network without a session. It grants that container nothing,
    since it already has the vault bind-mounted and every other `/api/` route.

    A taken name is a 409, the create's answer, because the user is about to
    retype it and has to know which it was.
    """
    try:
        return await mint(settings.tokens_path, named.name)
    except ValueError as taken:
        raise HTTPException(status_code=409, detail=str(taken)) from taken


@router.delete("/api/tokens/{name}", status_code=204, response_class=Response)
async def delete_token(name: str, settings: Annotated[Settings, Depends(get_settings)]) -> Response:
    """Revoke one agent token. The next request carrying it is refused.

    `response_class` for the reason `POST /api/assets/{path}` carries one:
    without it FastAPI documents a 204 as JSON carrying an empty schema, and
    `openapi-typescript` turns that into a body for a response that has none.
    """
    if not await revoke(settings.tokens_path, name):
        raise HTTPException(status_code=404, detail="No such token")

    return Response(status_code=204)
