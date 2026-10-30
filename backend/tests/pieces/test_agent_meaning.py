"""Search by meaning for agents: the `search_meaning` tool and `GET /agent/search/meaning`.

Rows go into the migrated database at `KASTEN_DATABASE_URL` with hand-written
vectors, and a stub model points a query along one axis, so the order is known.
A box with no database skips.
"""

import json
from typing import TYPE_CHECKING, Any

import pytest
from fastapi import HTTPException
from sqlalchemy import text as sql

from kasten_backend import agent
from kasten_backend.config import get_settings
from kasten_backend.pieces import indexer
from kasten_backend.pieces.embed import DIMENSIONS, model_thread
from kasten_backend.pieces.indexer import Indexer
from kasten_backend.pieces.models import Piece, PieceNote

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

RPC = {"content-type": "application/json", "accept": "application/json, text/event-stream"}


def _vector(axis: int, near: int | None = None) -> list[float]:
    vector = [0.0] * DIMENSIONS
    vector[axis] = 1.0
    if near is not None:
        vector[near] = 0.3
    return vector


PIECES = {
    # No word of the query below, only its meaning, axis 0.
    "Hund.md": ("Tiere > Hunde", _vector(0)),
    "Welpe.md": ("", _vector(0, near=1)),
    "Steuer.md": ("Geld", _vector(1)),
    "98 Archive/Alt.md": ("", _vector(0)),
}


class AxisModel:
    """Every text points along axis 0, so a query lands on `Hund.md` first."""

    def offsets(self, text: str) -> list[tuple[int, int]]:
        return [(0, len(text))]

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [_vector(0) for _ in texts]


@pytest.fixture
async def stored(
    agent_vault: Path,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for path in [*PIECES, "Unread.md"]:
        (agent_vault / path).parent.mkdir(parents=True, exist_ok=True)
        (agent_vault / path).write_text("words\n")
    async with sessions() as session, session.begin():
        for path, (heading, vector) in PIECES.items():
            session.add(PieceNote(path=path, digest="d"))
            await session.flush()
            body = f"{path}\n\nbody of {path.removesuffix('.md')}"
            session.add(
                Piece(path=path, n=0, heading=heading, digest="d", text=body, embedding=vector)
            )

    async def own() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    monkeypatch.setattr(agent, "sessions", own)


@pytest.fixture
async def model(
    stored: None, sessions: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> Indexer:
    """A running indexer whose stub model has loaded."""
    made = Indexer(get_settings().vault_path, sessions, AxisModel, model_thread())
    await made._model_loaded()
    monkeypatch.setattr(indexer, "running", made)
    return made


async def _mcp(client: AsyncClient, bearer: dict[str, str], **arguments: Any) -> dict[str, Any]:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "search_meaning", "arguments": arguments},
    }
    response = await client.post("/agent/mcp", json=body, headers={**bearer, **RPC})
    assert response.status_code == 200, response.text
    data = response.text
    line = next((x for x in data.splitlines() if x.startswith("data: ")), None)
    message = json.loads(line.removeprefix("data: ") if line else data)
    assert message["result"].get("isError") is not True, message
    return message["result"]["structuredContent"]


async def _http(client: AsyncClient, bearer: dict[str, str], **params: str) -> dict[str, Any]:
    response = await client.get("/agent/search/meaning", params=params, headers=bearer)
    assert response.status_code == 200, response.text
    return response.json()


async def test_mcp_ranks_by_meaning_with_heading_and_piece(
    client: AsyncClient, bearer: dict[str, str], model: Indexer
) -> None:
    answer = await _mcp(client, bearer, query="dog")

    assert [hit["path"] for hit in answer["hits"]][:2] == ["Hund.md", "Welpe.md"]
    first = answer["hits"][0]
    assert first["heading"] == "Tiere > Hunde"
    assert first["text"] == "body of Hund"
    assert answer["status"] == "The index has read 4 of 5 notes so far."


async def test_http_twin_answers_as_the_tool_does(
    client: AsyncClient, bearer: dict[str, str], model: Indexer
) -> None:
    assert await _http(client, bearer, q="dog") == await _mcp(client, bearer, query="dog")


async def test_the_archive_stays_out_unless_asked(
    client: AsyncClient, bearer: dict[str, str], model: Indexer
) -> None:
    plain = await _mcp(client, bearer, query="dog")
    asked = await _http(client, bearer, q="dog", archive="true")

    assert "98 Archive/Alt.md" not in [hit["path"] for hit in plain["hits"]]
    assert "98 Archive/Alt.md" in [hit["path"] for hit in asked["hits"]]


async def test_notes_like_one_come_nearest_first(
    client: AsyncClient, bearer: dict[str, str], stored: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Stored vectors alone: no model at all, and `like` wins over the query.
    monkeypatch.setattr(indexer, "running", None)
    answer = await _mcp(client, bearer, query="tax", like="Hund.md")

    assert [hit["path"] for hit in answer["hits"]] == ["Welpe.md", "Steuer.md"]
    assert answer["status"] == "The index has read 4 of 5 notes so far."


async def test_like_an_unread_note_says_so(
    client: AsyncClient, bearer: dict[str, str], model: Indexer
) -> None:
    answer = await _http(client, bearer, like="Unread.md")

    assert answer["hits"] == []
    assert answer["status"].startswith("The index holds no note at Unread.md")


async def test_like_takes_the_spellings_read_note_takes(
    client: AsyncClient, bearer: dict[str, str], model: Indexer
) -> None:
    answer = await _mcp(client, bearer, like="./Hund.md")

    assert [hit["path"] for hit in answer["hits"]][:1] == ["Welpe.md"]


async def test_no_database_is_a_tool_error_in_the_routes_words(
    client: AsyncClient, bearer: dict[str, str], stored: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def down() -> AsyncIterator[AsyncSession]:
        raise HTTPException(status_code=503, detail="No database answered")
        yield  # pragma: no cover

    monkeypatch.setattr(agent, "sessions", down)
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "search_meaning", "arguments": {"query": "dog"}},
    }
    response = await client.post("/agent/mcp", json=body, headers={**bearer, **RPC})

    assert "No database answered" in response.text
    assert '"isError":true' in response.text.replace(" ", "")


async def test_no_model_configured_ranks_by_words(
    client: AsyncClient, bearer: dict[str, str], stored: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(indexer, "running", None)
    answer = await _mcp(client, bearer, query="Steuer")

    assert [hit["path"] for hit in answer["hits"]] == ["Steuer.md"]
    assert answer["status"].startswith("No embedding model is configured")


async def test_a_loading_model_ranks_by_words(
    client: AsyncClient,
    bearer: dict[str, str],
    stored: None,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Never run, so the model never loads.
    loading = Indexer(get_settings().vault_path, sessions, AxisModel, model_thread())
    monkeypatch.setattr(indexer, "running", loading)
    answer = await _http(client, bearer, q="Steuer")

    assert [hit["path"] for hit in answer["hits"]] == ["Steuer.md"]
    assert answer["status"].startswith("The model is still loading")


async def test_a_blank_query_and_no_like_answer_nothing(
    client: AsyncClient, bearer: dict[str, str], model: Indexer
) -> None:
    answer = await _mcp(client, bearer, query="  ")

    assert answer["hits"] == []


async def test_no_pieces_table_answers_without_a_500(
    client: AsyncClient,
    bearer: dict[str, str],
    stored: None,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def untabled() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            # A search path with no pieces table in it, as on a database never migrated.
            await session.execute(sql("SET search_path TO pg_temp"))
            yield session

    monkeypatch.setattr(agent, "sessions", untabled)
    monkeypatch.setattr(indexer, "running", None)

    for answer in [
        await _http(client, bearer, q="Steuer"),
        await _mcp(client, bearer, like="Hund.md"),
    ]:
        assert answer["hits"] == []
        assert answer["status"]


async def test_the_http_twin_refuses_without_a_token(client: AsyncClient, stored: None) -> None:
    response = await client.get("/agent/search/meaning", params={"q": "dog"})

    assert response.status_code == 401


async def test_the_folder_the_index_skips_stays_out_as_search_notes_finds_it(
    client: AsyncClient,
    bearer: dict[str, str],
    stored: None,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = get_settings().vault_path
    (root / "Cards").mkdir()
    (root / "Cards/Steuer card.md").write_text("Steuer\n")
    skipping = Indexer(root, sessions, AxisModel, model_thread(), "Cards")
    monkeypatch.setattr(indexer, "running", skipping)

    meaning = await _http(client, bearer, q="Steuer")
    lines = await client.get("/agent/search", params={"q": "Steuer"}, headers=bearer)

    assert "Cards/Steuer card.md" not in [hit["path"] for hit in meaning["hits"]]
    # The skipped note is out of the count too: five notes, not six.
    assert (
        meaning["status"] == "The model is still loading, so these rank by words alone. "
        "The index has read 4 of 5 notes so far."
    )
    assert "Cards/Steuer card.md" in [hit["path"] for hit in lines.json()]
