"""The ranked search: BM25 and vectors over the pieces, fused by rank, through `/api/ranked`.

Runs against the migrated database at `KASTEN_DATABASE_URL`, notes indexed by
the real indexer with a fake model whose vectors follow a few word groups, so a
query can share a meaning with a note and no word. Each test empties the two
tables before and after. A box with no database skips.
"""

import asyncio
import re
import threading
import time
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text as sql
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.main import app
from kasten_backend.pieces.embed import DIMENSIONS, model_thread
from kasten_backend.pieces.indexer import Indexer
from kasten_backend.pieces.ranked import bm25_select, fuse
from kasten_backend.pieces.route import get_indexer

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from httpx import AsyncClient

GROUPS = [{"hund", "welpe", "puppy", "dog"}, {"steuer", "tax", "finanzamt"}]
"""Words the fake model reads as one meaning each: a text holding one points that way."""


class ConceptModel:
    """Whitespace tokens; a vector with one axis a word group, and a faint one for the rest."""

    def __init__(self) -> None:
        self.embedded: list[str] = []

    def offsets(self, text: str) -> list[tuple[int, int]]:
        return [(match.start(), match.end()) for match in re.finditer(r"\S+", text)]

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.embedded.extend(texts)
        return [_vector(body) for body in texts]


def _vector(body: str) -> list[float]:
    words = set(re.findall(r"\w+", body.lower()))
    vector = [0.0] * DIMENSIONS
    vector[DIMENSIONS - 1] = 0.1
    for axis, group in enumerate(GROUPS):
        if words & group:
            vector[axis] = 1.0
    return vector


@pytest.fixture
async def sessions() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            present = await connection.scalar(sql("SELECT to_regclass('public.pieces')"))
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
        await session.execute(sql("DELETE FROM piece_notes"))


NOTES = {
    "Haus.md": "# Wohnen\n\nDie Häuser in der Stadt sind teuer geworden.\n",
    "Garden.md": "# Plants\n\nThe gardens bloom in spring.\n",
    "Bello.md": "# Bello\n\nMein Hund bellt jeden Morgen am Zaun.\n",
    "Quittung.md": "Eine Quittung vom Finanzamt.\n",
    "98 Archive/Alt.md": "Die alten Häuser stehen noch.\n",
}


@pytest.fixture
async def vault(tmp_path: Path) -> AsyncIterator[Path]:
    root = tmp_path / "vault"
    for path, body in NOTES.items():
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(body)
    settings = Settings(vault_path=root)
    app.dependency_overrides[get_settings] = lambda: settings
    yield root
    app.dependency_overrides.pop(get_settings)


@pytest.fixture
async def indexed(
    vault: Path, sessions: async_sessionmaker[AsyncSession]
) -> AsyncIterator[Indexer]:
    """Every note of `vault` indexed, and the indexer the route asks for query vectors."""
    made = Indexer(vault, sessions, ConceptModel, model_thread())
    for path in NOTES:
        await made.index(path)
    app.dependency_overrides[get_indexer] = lambda: made
    yield made
    app.dependency_overrides.pop(get_indexer)


async def _ask(client: AsyncClient, q: str, **params: str) -> dict:
    response = await client.get("/api/ranked", params={"q": q, **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_fuse_sums_reciprocal_ranks_over_the_lists() -> None:
    # b in both lists beats a at the top of one; d second beats c third.
    fused = fuse([["a", "b", "c"], ["b", "d"]])

    assert [item for item, _ in fused] == ["b", "a", "d", "c"]
    assert fused[0][1] == pytest.approx(1 / 62 + 1 / 61)
    assert fused[1][1] == pytest.approx(1 / 61)
    assert fused[3][1] == pytest.approx(1 / 63)


def test_bm25_names_its_index_and_query_as_constants() -> None:
    # On the live index's copy a bound parameter let the planner scan the other
    # index, and pg_textsearch refused the query; a subquery around it did too.
    statement = bm25_select("it's", "pieces_text_english", "98 Archive")
    sql_text = str(
        statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )

    assert "to_bm25query('it''s', 'pieces_text_english')" in sql_text
    assert sql_text.count("SELECT") == 1


def test_fuse_of_no_lists_is_empty() -> None:
    assert fuse([[], []]) == []


async def test_a_german_stem_finds_its_note(client: AsyncClient, indexed: Indexer) -> None:
    answer = await _ask(client, "Haus")

    assert answer["hits"][0]["path"] == "Haus.md"
    assert answer["hits"][0]["heading"] == "Wohnen"
    assert answer["hits"][0]["text"].startswith("Die Häuser")
    assert answer["meaning"] is True


async def test_an_english_word_finds_its_note(client: AsyncClient, indexed: Indexer) -> None:
    answer = await _ask(client, "garden")

    assert answer["hits"][0]["path"] == "Garden.md"
    assert answer["hits"][0]["heading"] == "Plants"


async def test_a_note_sharing_only_a_meaning_ranks(client: AsyncClient, indexed: Indexer) -> None:
    # No word of "puppy" is in the note; only the vectors join the two.
    answer = await _ask(client, "puppy")

    assert answer["hits"][0]["path"] == "Bello.md"
    assert answer["meaning"] is True


async def test_each_note_comes_once_with_counts(client: AsyncClient, indexed: Indexer) -> None:
    answer = await _ask(client, "Haus")

    paths = [hit["path"] for hit in answer["hits"]]
    assert len(paths) == len(set(paths))
    # Both counts take the archive in: the indexer reads it, only the search leaves it out.
    assert answer["indexed"] == len(NOTES)
    assert answer["notes"] == len(NOTES)


async def test_the_archive_stays_out_unless_asked(client: AsyncClient, indexed: Indexer) -> None:
    left_out = await _ask(client, "Häuser")
    taken_in = await _ask(client, "Häuser", archive="true")

    assert "98 Archive/Alt.md" not in [hit["path"] for hit in left_out["hits"]]
    assert "98 Archive/Alt.md" in [hit["path"] for hit in taken_in["hits"]]


async def test_a_blank_query_answers_nothing_and_embeds_nothing(
    client: AsyncClient, indexed: Indexer
) -> None:
    model = await indexed._model_loaded()
    before = len(model.embedded)  # ty: ignore[unresolved-attribute]

    answer = await _ask(client, "   ")

    assert answer["hits"] == []
    assert len(model.embedded) == before  # ty: ignore[unresolved-attribute]
    assert answer["meaning"] is True


async def test_query_syntax_characters_never_fail(client: AsyncClient, indexed: Indexer) -> None:
    for q in ['"Haus', "Haus & Garten", "a:b", "(Hund", "it's", "!", "*", "Haus | dog"]:
        await _ask(client, q)


async def test_a_stopped_query_thread_reads_as_words_only(
    client: AsyncClient, indexed: Indexer
) -> None:
    indexed._query_thread.shutdown(wait=True)

    answer = await _ask(client, "Haus")

    assert answer["meaning"] is False
    assert answer["hits"][0]["path"] == "Haus.md"


async def test_no_model_configured_reads_as_words_only(
    client: AsyncClient, indexed: Indexer
) -> None:
    app.dependency_overrides[get_indexer] = lambda: None

    answer = await _ask(client, "Haus")

    assert answer["meaning"] is False
    assert answer["hits"][0]["path"] == "Haus.md"


async def test_a_query_waits_for_no_indexing_batch(client: AsyncClient, indexed: Indexer) -> None:
    # An indexing batch holds the model thread for a second; the query does not wait.
    model = await indexed._model_loaded()
    busy = asyncio.get_running_loop().run_in_executor(indexed._thread, time.sleep, 1.0)
    try:
        answer = await asyncio.wait_for(_ask(client, "puppy"), timeout=0.8)
    finally:
        await busy

    assert answer["meaning"] is True
    assert model is not None


async def test_the_endpoint_answers_while_the_model_loads(
    client: AsyncClient, vault: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    # Index with one indexer, then ask through a second whose model never loads.
    first = Indexer(vault, sessions, ConceptModel, model_thread())
    await first.index("Haus.md")
    release = threading.Event()

    def load() -> ConceptModel:
        release.wait(10)
        return ConceptModel()

    loading = Indexer(vault, sessions, load, model_thread())
    running = asyncio.create_task(loading.run())
    app.dependency_overrides[get_indexer] = lambda: loading
    try:
        answer = await asyncio.wait_for(_ask(client, "Haus"), timeout=5)
    finally:
        release.set()
        running.cancel()
        app.dependency_overrides.pop(get_indexer)

    assert answer["meaning"] is False
    assert answer["hits"][0]["path"] == "Haus.md"


async def test_no_pieces_table_reads_as_an_empty_index(
    client: AsyncClient, vault: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    async with sessions() as session:
        # A search path with no pieces table in it, as on a database never migrated.
        await session.execute(sql("SET search_path TO pg_temp"))
        app.dependency_overrides[get_session] = lambda: session
        app.dependency_overrides[get_indexer] = lambda: None
        try:
            answer = await _ask(client, "Haus")
        finally:
            app.dependency_overrides.pop(get_session)
            app.dependency_overrides.pop(get_indexer)

    assert answer == {"hits": [], "meaning": False, "indexed": 0, "notes": len(NOTES)}
