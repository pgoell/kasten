"""The scratch database with the todo store emptied, for the tests that write rows."""

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncEngine


@pytest.fixture
async def store(activity: AsyncEngine) -> AsyncIterator[AsyncEngine]:
    async with activity.begin() as connection:
        await connection.execute(text("TRUNCATE todos.todo, todos.session, todos.change"))
    yield activity
