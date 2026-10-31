"""Notes like this one: `/api/similar` ranks notes by the stored vectors of a note's pieces.

Rows go straight into the migrated database at `KASTEN_DATABASE_URL` with
hand-written vectors, so the order is known. No model runs. A box with no
database skips.
"""

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text as sql

from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.main import app
from kasten_backend.pieces.embed import DIMENSIONS
from kasten_backend.pieces.models import Piece, PieceNote
from kasten_backend.pieces.route import get_indexer

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _vector(**axes: float) -> list[float]:
    vector = [0.0] * DIMENSIONS
    for axis, value in axes.items():
        vector[int(axis[1:])] = value
    return vector


PIECES = {
    # The note asked about: two pieces, on axes 0 and 2.
    "Me.md": [("A", _vector(a0=1)), ("B", _vector(a2=1))],
    # Its second piece matches Me's second exactly.
    "Twin.md": [("", _vector(a2=1))],
    # The first piece points away; the second lies near Me's first.
    "Near.md": [("Off", _vector(a1=1)), ("Close > Closer", _vector(a0=1, a1=0.1))],
    "Mid.md": [("", _vector(a0=1, a1=1))],
    "Far.md": [("", _vector(a1=1))],
    "98 Archive/Old.md": [("", _vector(a0=1))],
}


async def _insert(
    sessions: async_sessionmaker[AsyncSession], pieces: dict[str, list[tuple[str, list[float]]]]
) -> None:
    async with sessions() as session, session.begin():
        for path, rows in pieces.items():
            session.add(PieceNote(path=path, digest="d"))
            await session.flush()
            for n, (heading, vector) in enumerate(rows):
                body = f"{path}\n\nbody {n} of {path}"
                session.add(
                    Piece(path=path, n=n, heading=heading, digest="d", text=body, embedding=vector)
                )


@pytest.fixture
async def vault(tmp_path: Path) -> AsyncIterator[Path]:
    root = tmp_path / "vault"
    for path in [*PIECES, "Empty.md", "Unread.md"]:
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text("words\n")
    settings = Settings(vault_path=root)
    app.dependency_overrides[get_settings] = lambda: settings
    # No model at all: the answer reads stored vectors only.
    app.dependency_overrides[get_indexer] = lambda: None
    yield root
    app.dependency_overrides.pop(get_settings)
    app.dependency_overrides.pop(get_indexer)


@pytest.fixture
async def stored(vault: Path, sessions: async_sessionmaker[AsyncSession]) -> None:
    await _insert(sessions, {**PIECES, "Empty.md": []})


async def _ask(client: AsyncClient, path: str, **params: str) -> dict:
    response = await client.get("/api/similar", params={"path": path, **params})
    assert response.status_code == 200, response.text
    return response.json()


async def test_notes_come_nearest_first_on_fixed_vectors(client: AsyncClient, stored: None) -> None:
    answer = await _ask(client, "Me.md")

    assert [hit["path"] for hit in answer["hits"]] == ["Twin.md", "Near.md", "Mid.md", "Far.md"]
    scores = [hit["score"] for hit in answer["hits"]]
    assert scores[0] == pytest.approx(1)
    assert scores[2] == pytest.approx(2**-0.5)
    assert scores[3] == pytest.approx(0)


async def test_the_note_itself_is_never_in_the_answer(client: AsyncClient, stored: None) -> None:
    for path in PIECES:
        answer = await _ask(client, path, archive="true")

        assert path not in [hit["path"] for hit in answer["hits"]]


async def test_each_note_comes_once_with_its_nearest_piece(
    client: AsyncClient, stored: None
) -> None:
    answer = await _ask(client, "Me.md")

    near = next(hit for hit in answer["hits"] if hit["path"] == "Near.md")
    assert near["heading"] == "Close > Closer"
    # The title line the indexer put in front for the model is gone.
    assert near["text"] == "body 1 of Near.md"
    paths = [hit["path"] for hit in answer["hits"]]
    assert len(paths) == len(set(paths))


async def test_at_most_ten_notes_come_back(
    client: AsyncClient, vault: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    many = {f"N{i:02}.md": [("", _vector(a0=1, a1=i / 10))] for i in range(12)}
    await _insert(sessions, {"Me.md": PIECES["Me.md"], **many})

    answer = await _ask(client, "Me.md")

    assert [hit["path"] for hit in answer["hits"]] == [f"N{i:02}.md" for i in range(10)]


async def test_a_note_with_no_pieces_answers_empty(client: AsyncClient, stored: None) -> None:
    empty = await _ask(client, "Empty.md")
    unread = await _ask(client, "Unread.md")
    unknown = await _ask(client, "Nowhere/Nothing.md")

    assert (empty["hits"], empty["read"]) == ([], True)
    assert (unread["hits"], unread["read"]) == ([], False)
    assert (unknown["hits"], unknown["read"]) == ([], False)


async def test_the_counts_show_the_index_filling(client: AsyncClient, stored: None) -> None:
    answer = await _ask(client, "Me.md")

    # Unread.md is in the vault and not yet in the index.
    assert answer["indexed"] == len(PIECES) + 1
    assert answer["notes"] == len(PIECES) + 2


async def test_the_archive_stays_out_unless_asked(client: AsyncClient, stored: None) -> None:
    left_out = await _ask(client, "Me.md")
    taken_in = await _ask(client, "Me.md", archive="true")

    assert "98 Archive/Old.md" not in [hit["path"] for hit in left_out["hits"]]
    assert taken_in["hits"][0]["path"] == "98 Archive/Old.md"


async def test_no_pieces_table_answers_empty(
    client: AsyncClient, vault: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    async with sessions() as session:
        # A search path with no pieces table in it, as on a database never migrated.
        await session.execute(sql("SET search_path TO pg_temp"))
        app.dependency_overrides[get_session] = lambda: session
        try:
            answer = await _ask(client, "Me.md")
        finally:
            app.dependency_overrides.pop(get_session)

    assert answer == {"hits": [], "read": False, "indexed": 0, "notes": len(PIECES) + 2}
