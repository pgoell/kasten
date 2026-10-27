"""Routes that mint, list and revoke the agent tokens, and show what each one did."""

import asyncio
import logging
from datetime import datetime  # noqa: TC003  pydantic reads the annotation at runtime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import SQLAlchemyError

from kasten_backend import db, token_activity
from kasten_backend.config import Settings, get_settings
from kasten_backend.tokens import Minted, Token, listing, mint, revoke

router = APIRouter()

logger = logging.getLogger(__name__)


class TokenName(BaseModel):
    """What a mint is asked for: a name to tell one token from another."""

    name: str


class TokenUse(Token):
    """One token as the list shows it, with the time of its newest request."""

    last_used: datetime | None = None


class TokenActionRead(BaseModel):
    """One request a token made, as the activity list shows it.

    Named `TokenAction` in the schema, which is the name the API reference uses.
    """

    model_config = ConfigDict(title="TokenAction", from_attributes=True)

    at: datetime
    client: str | None
    method: str
    path: str
    tool: str | None
    note: str | None
    status: int
    outcome: str


@router.get("/api/tokens")
async def read_tokens(settings: Annotated[Settings, Depends(get_settings)]) -> list[TokenUse]:
    """Every agent token the store holds, by name, creation date and last use.

    Never a digest and never a secret. Only the digest is kept at all, so there
    is no way back to a secret from here even by mistake.

    The list still answers when no database does: `last_used` is then null, and
    a warning says why.
    """
    tokens = await listing(settings.tokens_path)
    try:
        async with asyncio.timeout(settings.activity_timeout_seconds):
            async with db.session_factory() as session:
                last = await token_activity.last_uses(session)
    except (SQLAlchemyError, OSError, TimeoutError) as error:
        logger.warning("Could not read the last use of the tokens: %s", type(error).__name__)
        last = {}

    return [
        TokenUse(name=token.name, created=token.created, last_used=_since(last, token))
        for token in tokens
    ]


def _since(last: dict[str, datetime], token: Token) -> datetime | None:
    """`token`'s last use, unless it falls before the token was made.

    The OAuth reconnect revokes a name and mints it again, so rows under that name
    can belong to the old secret. Those are older than the new token's `created`.
    """
    used = last.get(token.name)
    return used if used is not None and used >= token.created else None


@router.get("/api/tokens/{name}/actions")
async def read_token_actions(
    name: str, settings: Annotated[Settings, Depends(get_settings)]
) -> list[TokenActionRead]:
    """The newest requests one token made, newest first, at most fifty.

    Every row under the name, the revoked ones included and marked so. 503 rather
    than an empty list when no database answers, since an empty list would say the
    token had done nothing.
    """
    try:
        async with asyncio.timeout(settings.activity_timeout_seconds):
            async with db.session_factory() as session:
                rows = await token_activity.recent(session, name)
    except (SQLAlchemyError, OSError, TimeoutError) as error:
        logger.warning("No database answers for the token activity: %s", type(error).__name__)
        raise HTTPException(
            status_code=503,
            detail="No database answers at KASTEN_DATABASE_URL, where the token activity is "
            "kept. See docs/reference/configuration.md.",
        ) from error

    return [TokenActionRead.model_validate(row) for row in rows]


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
