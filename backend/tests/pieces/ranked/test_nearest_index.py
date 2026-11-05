"""The nearest pieces through the HNSW index: the exact scan's rows, all `DEPTH`, the floor kept.

Runs against the migrated database at `KASTEN_DATABASE_URL`, emptied around each
test. At this size the planner would rather scan the table, so the tests turn
the scan off to make it take the index, as it does on the live index (#1340).
"""

import re
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from kasten_backend.pieces import ranked
from kasten_backend.pieces.embed import DIMENSIONS
from kasten_backend.pieces.models import Piece, PieceNote
from kasten_backend.pieces.ranked import DEPTH, nearest_select

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

ARCHIVE = "98 Archive"

ROOT = Path(__file__).parents[4]
RUNBOOK = ROOT / "docs/how-to/back-up-and-restore.md"
# The issue saw misses from about the 20th round of a DELETE and no rows by the 40th (#1408).
ROUNDS = 40

SETTING = text("SELECT current_setting('hnsw.ef_search', true)")


def _toward(axis: int, spread: float, rng: np.random.Generator) -> list[float]:
    """A unit vector near the `axis` direction; `spread` sets how far it strays."""
    vector = np.zeros(DIMENSIONS)
    vector[axis] = 1.0
    vector += rng.normal(0, spread / np.sqrt(DIMENSIONS), DIMENSIONS)
    return (vector / np.linalg.norm(vector)).tolist()


async def _seed(factory: async_sessionmaker[AsyncSession]) -> None:
    """70 pieces near axis 0, 10 archived ones nearer still, 20 near axis 1."""
    rng = np.random.default_rng(1340)
    notes = [("near.md", 70, 0, 0.6), (f"{ARCHIVE}/old.md", 10, 0, 0.2), ("far.md", 20, 1, 0.6)]
    async with factory() as session, session.begin():
        session.add_all(PieceNote(path=path, digest="0" * 64) for path, *_ in notes)
        await session.flush()
        session.add_all(
            Piece(
                path=path,
                n=n,
                heading="",
                digest="0" * 64,
                text=path,
                embedding=_toward(axis, spread, rng),
            )
            for path, count, axis, spread in notes
            for n in range(count)
        )


async def _forced(session: AsyncSession, plan: str) -> None:
    # `seqscan` off sends the query to the index, `indexscan` off to the exact scan.
    await session.execute(text(f"SET LOCAL enable_{plan} = off"))


def _axis(axis: int) -> list[float]:
    return [1.0 if i == axis else 0.0 for i in range(DIMENSIONS)]


async def test_nearest_reads_the_index_and_matches_the_exact_scan(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(sessions)
    query = _axis(0)

    async with sessions() as session, session.begin():
        await _forced(session, "seqscan")
        found = await ranked._nearest(session, query, ARCHIVE)
        shown = nearest_select(query, ARCHIVE).compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
        plan = await session.scalars(text(f"EXPLAIN {str(shown).replace('%%', '%')}"))
        assert any("Index Scan using pieces_embedding" in line for line in plan)
        nothing = await ranked._nearest(session, _axis(2), ARCHIVE)
    async with sessions() as session, session.begin():
        await _forced(session, "indexscan")
        exact = (await session.execute(nearest_select(query, ARCHIVE))).tuples().all()

    assert found == list(exact)
    # At pgvector's default ef_search of 40, the ten archived pieces would leave 30.
    assert len(found) == DEPTH
    assert {path for path, _ in found} == {"near.md"}
    assert nothing == []


async def test_nearest_settings_end_with_the_transaction(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    async with sessions() as session:
        async with session.begin():
            await ranked._nearest(session, _axis(0), ARCHIVE)
            inside = await session.scalar(SETTING)
        async with session.begin():
            after = await session.scalar(SETTING)

    assert inside == str(ranked.SEARCH)
    # Unset, or pgvector's default once the library has loaded on this connection.
    assert after in {None, "40"}


def _empty_steps() -> list[str]:
    section = RUNBOOK.read_text().split("### Empty the index")[1].split("\n### ")[0]
    return re.findall(r'psql .*-c "([^"]+)"', section)


async def test_the_runbook_empties_the_index_with_no_dead_entries(
    sessions: async_sessionmaker[AsyncSession],
) -> None:
    steps = _empty_steps()
    assert len(steps) == 2
    query = _axis(0)
    wrong = []
    for step in steps:
        for round_ in range(ROUNDS):
            await _seed(sessions)
            async with sessions() as session, session.begin():
                await _forced(session, "seqscan")
                found = await ranked._nearest(session, query, ARCHIVE)
            async with sessions() as session, session.begin():
                await _forced(session, "indexscan")
                exact = (await session.execute(nearest_select(query, ARCHIVE))).tuples().all()
            if found != list(exact):
                wrong.append((step, round_, len(found)))
            async with sessions() as session, session.begin():
                await session.execute(text(step))
                pieces = await session.scalar(text("SELECT count(*) FROM pieces"))
                notes = await session.scalar(text("SELECT count(*) FROM piece_notes"))
            assert (pieces, notes) == (0, 0)

    assert wrong == []


def test_nothing_empties_the_pieces_with_a_delete() -> None:
    # Split so this line is not a hit; a DELETE with a WHERE drops one note and stays.
    pattern = re.compile(r"DELETE FROM " r"piece_notes(?!\s+WHERE)")
    folders = ("docs", "backend/src", "backend/tests", "jobs", "deploy", "shell")
    hits = [
        f"{path.relative_to(ROOT)}:{n}"
        for folder in folders
        for path in (ROOT / folder).rglob("*")
        if path.suffix in {".md", ".py", ".sh", ".yaml", ".yml", ".toml"}
        and "node_modules" not in path.parts
        for n, line in enumerate(path.read_text().splitlines(), 1)
        if pattern.search(line)
    ]
    assert hits == []
