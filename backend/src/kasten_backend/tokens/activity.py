"""What each agent token did: one row in Postgres per request it made.

Not `tokens.json`, rewritten on every request, nor the vault, whose jj history would keep
every row. A row that cannot be written is logged and dropped, never failing the request.
Rows hold paths and tool names only: never a secret, header, query string or note text.
"""

import asyncio
import logging
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Identity,
    Index,
    Integer,
    Text,
    delete,
    func,
    select,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend import db
from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger(__name__)

KEEP = timedelta(days=90)
"""How long a row is kept. Older rows are dropped on each write, so there is no job to run."""


class TokenAction(db.Base):
    """One request a token made: when, from where, what it asked for, and what it got back."""

    __tablename__ = "token_action"
    __table_args__ = (
        CheckConstraint("outcome IN ('ok', 'error', 'revoked')", name="token_action_outcome_check"),
        Index("ix_token_action_token_at", "token", "at"),
        Index("ix_token_action_at", "at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    token: Mapped[str] = mapped_column(Text)
    client: Mapped[str | None] = mapped_column(Text)
    method: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)
    tool: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[int] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(Text)


@dataclass
class Action:
    """What the request turned out to be, filled in by whoever reads the token or the tool."""

    token: str | None = None
    revoked: bool = False
    tool: str | None = None
    note: str | None = None
    failed: bool = False


current: ContextVar[Action | None] = ContextVar("token_action", default=None)
"""The request's action, set by `Recorder` before the app runs.

Mutated, not set again: a task the request starts copies the context, so a set made there
would never reach the middleware, but the shared object reaches every copy.
"""


def named(name: str, *, revoked: bool = False, note: str | None = None) -> None:
    """Say which token made this request, and whether the store had revoked it."""
    action = current.get()
    if action is None:
        return

    action.token = name
    action.revoked = revoked
    action.note = note


def called(tool: str, arguments: dict[str, Any]) -> None:
    """Say which MCP tool this request calls, and the path it was given when there is one."""
    action = current.get()
    if action is None:
        return

    action.tool = tool
    path = arguments.get("path")
    if isinstance(path, str):
        action.note = path


def failed() -> None:
    """Say the request's answer was an error, even though the status was 200."""
    action = current.get()
    if action is not None:
        action.failed = True


def _kept(path: str) -> bool:
    """Whether a request to `path` is one the history records."""
    return path.startswith("/agent/") and not path.startswith("/agent/oauth/")


CAP = 1024
"""The most characters of a path, note or tool name a row keeps.

A token holder can send megabytes as any of them, and the row would keep all of it.
"""


def _cut(text: str | None) -> str | None:
    """`text`, shortened to `CAP` characters, or None as it came."""
    return text[:CAP] if text is not None else None


def _client(scope: Scope) -> str | None:
    """The address the request came from, in the order the prod Caddy reads it.

    Caddy's `client_ip_headers` takes `Cf-Connecting-Ip` first. Behind Cloudflare, Caddy
    appends the edge as the last `X-Forwarded-For` hop, so that hop names Cloudflare, not
    the agent. The peer is the fallback for a request that came without a proxy.
    """
    headers = dict(scope.get("headers", []))
    sent = headers.get(b"cf-connecting-ip")
    if sent is not None:
        return sent.decode("latin-1").strip()

    forwarded = headers.get(b"x-forwarded-for")
    if forwarded is not None:
        return forwarded.decode("latin-1").split(",")[-1].strip()

    peer = scope.get("client")
    return peer[0] if peer else None


def _row(scope: Scope, action: Action, token: str, status: int) -> TokenAction:
    """The row for one finished request, with the outcome the status and the action earn."""
    if action.revoked:
        outcome = "revoked"
    elif status >= HTTPStatus.BAD_REQUEST or action.failed:
        outcome = "error"
    else:
        outcome = "ok"

    return TokenAction(
        token=token,
        client=_client(scope),
        method=scope["method"],
        path=scope["path"][:CAP],
        tool=_cut(action.tool),
        note=_cut(action.note),
        status=status,
        outcome=outcome,
    )


class Recorder:
    """ASGI middleware that writes one row for each request an agent token makes.

    Pure ASGI, since `BaseHTTPMiddleware` buffers a streamed answer until it finishes.
    """

    def __init__(self, app: ASGIApp) -> None:
        """Wrap `app`, the rest of the stack, which every request still reaches."""
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Pass the request on, and write its row once the app has finished with it."""
        if scope["type"] != "http" or not _kept(scope["path"]):
            await self.app(scope, receive, send)
            return

        action = Action()
        status = 500

        async def remember(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        token = current.set(action)
        try:
            await self.app(scope, receive, remember)
        finally:
            # A request that raised is recorded as the 500 it became, and the
            # exception still goes up.
            current.reset(token)
            if action.token is not None:
                await _record(_row(scope, action, action.token, status))


async def _record(row: TokenAction) -> None:
    """Write one row and drop the rows past `KEEP`, or log why neither happened."""
    row.at = datetime.now(UTC)
    try:
        async with asyncio.timeout(get_settings().activity_timeout_seconds):
            async with db.session_factory() as session:
                session.add(row)
                await session.execute(delete(TokenAction).where(TokenAction.at < row.at - KEEP))
                await session.commit()
    except (SQLAlchemyError, OSError, TimeoutError) as error:
        # The error's own text can carry the parameters of the statement, so
        # only its class is written down.
        logger.warning(
            "Could not record %s %s for token %s: %s",
            row.method,
            row.path,
            row.token,
            type(error).__name__,
        )


async def last_uses(session: AsyncSession) -> dict[str, datetime]:
    """The newest live row's time for each token that has one.

    A revoked row is a request the store refused, so it says nothing about a token in use.
    """
    result = await session.execute(
        select(TokenAction.token, func.max(TokenAction.at).label("at"))
        .where(TokenAction.outcome != "revoked")
        .group_by(TokenAction.token)
    )
    return {row.token: row.at for row in result.all()}


async def recent(session: AsyncSession, name: str, limit: int = 50) -> list[TokenAction]:
    """The newest rows of one token, newest first."""
    result = await session.execute(
        select(TokenAction)
        .where(TokenAction.token == name)
        .order_by(TokenAction.at.desc(), TokenAction.id.desc())
        .limit(limit)
    )
    return list(result.scalars())
