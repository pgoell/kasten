"""The pieces tests' database: the migrated one at `KASTEN_DATABASE_URL`, emptied around each."""

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@pytest.fixture
async def sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """Sessions on the pieces tables; a box with no database, or none migrated, skips."""
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            present = await connection.scalar(text("SELECT to_regclass('public.pieces')"))
    except OperationalError:
        await engine.dispose()
        pytest.skip("No database answers at KASTEN_DATABASE_URL")
    if present is None:
        await engine.dispose()
        pytest.skip("No pieces table in the database: run `mise run db:migrate`")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    await _empty(factory)
    yield factory
    await _empty(factory)
    await engine.dispose()


async def _empty(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as session, session.begin():
        # A DELETE would leave its rows in the HNSW graph until a vacuum, and the
        # nearest-index test would then miss pieces through it (#1405).
        await session.execute(text("TRUNCATE piece_notes, pieces"))
