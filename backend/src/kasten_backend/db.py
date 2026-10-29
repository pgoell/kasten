"""Database engine, session factory and the declarative base.

Postgres holds the `finance` schema, the one system of record kept outside the
vault (see docs/explanation/finance-in-postgres.md), and two tables that do not
rebuild from the vault either: the RSVP reading places in `rsvp.py`, whose loss
costs only where each run stopped, and the agent token record in
`token_activity.py`, whose loss costs what `/tokens` shows of each token's use.
It also holds the pieces index, a derived index of the vault that `indexer.py`
rebuilds from the notes (see docs/explanation/models-on-the-vps/the-pieces-index.md).
"""

import logging
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Declarative base for every table: finance, RSVP places, tokens and the pieces index."""


engine = create_async_engine(
    get_settings().database_url,
    # Nothing connects at startup; the first request that needs the database
    # does: finance, RSVP, the token list or a token's actions, or any `/agent/`
    # request a token makes, whose row the token record writes. A host that
    # drops packets rather than refusing would otherwise hold a finance or RSVP
    # request for the system's TCP timeout before it could answer 503; the
    # token record has its own shorter timeout.
    connect_args={"connect_timeout": 5},
)

session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a connected session that closes with the request.

    The connection is opened here rather than at the first query, so a 503
    means only that no database answered. A timeout or a deadlock later in the
    request is a different failure and stays a 500.
    """
    async with session_factory() as session:
        try:
            await session.connection()
        except OperationalError as error:
            # The driver's reason for the failed connect: host, port and cause,
            # no statement and no parameters, since none was sent.
            logger.warning("No database answers at KASTEN_DATABASE_URL: %s", error.orig)
            raise HTTPException(
                status_code=503,
                detail="No database answers at KASTEN_DATABASE_URL, where finance and RSVP "
                "places are kept. See docs/reference/configuration.md.",
            ) from error
        yield session
