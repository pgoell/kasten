"""Database engine, session factory and the declarative base.

Postgres holds a derived index (documents, links, tags, full-text), which
rebuilds from the vault, and the `finance` schema, which does not: finance is
the one system of record kept outside the vault. See
docs/explanation/finance-in-postgres.md.
"""

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class Base(DeclarativeBase):
    """Declarative base for every table, index and finance alike."""


engine = create_async_engine(get_settings().database_url)

session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session that closes with the request."""
    async with session_factory() as session:
        yield session
