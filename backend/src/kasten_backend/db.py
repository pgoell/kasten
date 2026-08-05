"""Database engine, session factory and the declarative base.

Postgres holds only a derived index (documents, links, tags, full-text). It is
rebuildable from the vault, so nothing here is a system of record.
"""

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class Base(DeclarativeBase):
    """Declarative base for every index table."""


engine = create_async_engine(get_settings().database_url)

session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session that closes with the request."""
    async with session_factory() as session:
        yield session
