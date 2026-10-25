"""The RSVP reading place, read and written against the dev database.

Nothing here mocks the session: the upsert is the part worth testing, and only
Postgres can say whether a second save lands on the first row.
"""

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from kasten_backend.config import get_settings
from kasten_backend.db import get_session
from kasten_backend.main import app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from httpx import AsyncClient


@pytest.fixture(autouse=True)
async def places() -> AsyncIterator[None]:
    """The routes' session, on a transaction rolled back after the test.

    The pattern of `finance_session` in conftest, and skipped the same way: the
    dev database is shared with checkouts that have no `rsvp_places` table.
    """
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        connection = await engine.connect()
    except OperationalError:
        await engine.dispose()
        pytest.skip("No database answers at KASTEN_DATABASE_URL")
    outer = await connection.begin()
    if await connection.scalar(text("SELECT to_regclass('rsvp_places')")) is None:
        await connection.close()
        await engine.dispose()
        pytest.skip("No rsvp_places table in the database: run `mise run db:migrate`")
    session = AsyncSession(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    app.dependency_overrides[get_session] = lambda: session

    yield

    # The `vault` fixture clears every override on its way out, which may come first.
    app.dependency_overrides.pop(get_session, None)
    await session.close()
    await outer.rollback()
    await connection.close()
    await engine.dispose()


@pytest.fixture
def book(vault: Path) -> Path:
    """A vault with one note and one PDF in it."""
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# Borges\n", encoding="utf-8")
    (vault / "reading" / "borges.pdf").write_bytes(b"%PDF-1.7\n")
    (vault / "reading" / "borges.html").write_text("<p>Borges</p>\n", encoding="utf-8")
    return vault


async def test_a_file_never_read_has_no_place(client: AsyncClient, book: Path) -> None:
    response = await client.get("/api/rsvp", params={"path": "reading/borges.md"})

    assert response.status_code == 200
    assert response.json() is None


async def test_a_saved_place_reads_back(client: AsyncClient, book: Path) -> None:
    body = {"word": 12, "words": 300, "anchor": "the garden of forking paths"}
    saved = await client.put("/api/rsvp", params={"path": "reading/./borges.md"}, json=body)
    read = await client.get("/api/rsvp", params={"path": "reading/borges.md"})

    assert saved.status_code == 200
    assert read.json() == saved.json()
    assert read.json()["path"] == "reading/borges.md"
    assert {key: read.json()[key] for key in body} == body
    assert read.json()["updated"]


async def test_a_second_save_overwrites_the_first(client: AsyncClient, book: Path) -> None:
    path = {"path": "reading/borges.pdf"}
    first = await client.put("/api/rsvp", params=path, json={"word": 1, "words": 9, "anchor": "a"})
    second = await client.put(
        "/api/rsvp", params=path, json={"word": 5, "words": 10, "anchor": "b c"}
    )
    read = await client.get("/api/rsvp", params=path)

    assert read.json() == second.json()
    assert (read.json()["word"], read.json()["words"], read.json()["anchor"]) == (5, 10, "b c")
    assert read.json()["updated"] >= first.json()["updated"]


async def test_an_html_page_keeps_a_place(client: AsyncClient, book: Path) -> None:
    path = {"path": "reading/borges.html"}
    body = {"word": 2, "words": 4, "anchor": "the aleph"}
    saved = await client.put("/api/rsvp", params=path, json=body)
    read = await client.get("/api/rsvp", params=path)

    assert saved.status_code == 200
    assert read.json() == saved.json()
    assert read.json()["path"] == "reading/borges.html"


@pytest.mark.parametrize(
    "path", ["../outside.md", "/etc/passwd", "reading/missing.md", "reading", "reading/x.txt"]
)
async def test_a_path_that_is_no_file_is_refused(
    path: str, client: AsyncClient, book: Path
) -> None:
    body = {"word": 0, "words": 0, "anchor": ""}
    put = await client.put("/api/rsvp", params={"path": path}, json=body)
    get = await client.get("/api/rsvp", params={"path": path})

    assert (put.status_code, get.status_code) == (404, 404)
    assert put.json() == {"detail": "No such file"}


@pytest.mark.parametrize(
    "numbers", [{"word": -1, "words": 3}, {"word": 0, "words": -1}, {"word": 4, "words": 3}]
)
async def test_numbers_out_of_range_are_refused(
    numbers: dict[str, int], client: AsyncClient, book: Path
) -> None:
    path = {"path": "reading/borges.md"}
    response = await client.put("/api/rsvp", params=path, json={**numbers, "anchor": "x"})

    assert response.status_code == 422
    assert (await client.get("/api/rsvp", params=path)).json() is None


async def test_the_last_word_is_a_place(client: AsyncClient, book: Path) -> None:
    body = {"word": 3, "words": 3, "anchor": ""}
    response = await client.put("/api/rsvp", params={"path": "reading/borges.md"}, json=body)

    assert response.status_code == 200
