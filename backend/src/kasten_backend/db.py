"""Database engine, session factory and the declarative base for Postgres.

Finance is kept outside the vault, see docs/explanation/finance-in-postgres.md.
"""

import logging
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable


logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Declarative base for every table."""


def make_engine(url: str) -> AsyncEngine:
    """The engine every session comes from; tests build theirs here too."""
    return create_async_engine(
        url,
        # Short, so a host that drops packets fails fast, not at the TCP timeout.
        connect_args={"connect_timeout": 5},
        # A postgres restart closes pooled connections; unpinged, one goes out and 500s (#1327).
        pool_pre_ping=True,
    )


engine = make_engine(get_settings().database_url)

session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: a connected session, closed with the request.

    Connecting here makes a 503 mean only that no database answered.
    """
    async with session_factory() as session:
        try:
            await session.connection()
        except OperationalError as error:
            # Logs the driver's error only: no statement, since none was sent.
            logger.warning("No database answers at KASTEN_DATABASE_URL: %s", error.orig)
            raise HTTPException(
                status_code=503,
                detail="No database answers at KASTEN_DATABASE_URL, where finance and RSVP "
                "places are kept. See docs/reference/configuration.md.",
            ) from error
        yield session


sessions: Callable[[], AsyncIterator[AsyncSession]] = get_session
"""`session()`'s source: the routes' own dependency, so with no database a tool refuses in
the routes' words. The one name a test patches to point every caller at its rows."""


def session() -> AbstractAsyncContextManager[AsyncSession]:
    """One session for one call outside a request's dependencies, closed when the call ends."""
    return asynccontextmanager(sessions)()
