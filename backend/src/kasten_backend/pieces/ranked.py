"""Ranked search over the pieces: BM25 per stemmer and the bge-m3 vectors, fused by rank.

Reciprocal rank fusion sums `1 / (K + rank)` over the lists a piece is in; a
note takes its best piece's score.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING

from pgvector.sqlalchemy import Vector
from sqlalchemy import ColumnElement, Float, Select, func, literal, select, true, tuple_

from kasten_backend.pieces.embed import DIMENSIONS
from kasten_backend.pieces.models import Piece

if TYPE_CHECKING:
    from collections.abc import Hashable, Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

K = 60
"""The fusion's constant, the value the RRF paper and the semantic search page use."""

DEPTH = 50
"""How many pieces each list hands to the fusion."""

INDEXES = ("pieces_text_german", "pieces_text_english")
"""The two BM25 indexes, one a stemmer: a mixed vault needs no language guess."""

SNIPPET = 240
"""How much of the best piece comes back, in characters: two lines of the finder."""


@dataclass(frozen=True, slots=True)
class RankedNote:
    """A note the search found, with its best piece."""

    path: str
    heading: str
    text: str
    score: float


def fuse[T: Hashable](lists: Sequence[Sequence[T]], k: int = K) -> list[tuple[T, float]]:
    """Every item in `lists` with its fused score, best first; ties keep first-seen order."""
    scores: dict[T, float] = {}
    for ranked in lists:
        for rank, item in enumerate(ranked, start=1):
            scores[item] = scores.get(item, 0.0) + 1 / (k + rank)
    return sorted(scores.items(), key=lambda pair: -pair[1])


def _outside(archive: str | None) -> ColumnElement[bool]:
    return true() if archive is None else ~Piece.path.startswith(f"{archive}/", autoescape=True)


def bm25_select(query: str, index: str, archive: str | None) -> Select[tuple[str, int, float]]:
    """The pieces matching `query` through one BM25 index, best first."""
    # Both inline: pg_textsearch sees which index a query names only in constants,
    # and with a parameter the planner may scan the other index, which it refuses.
    asked = func.to_bm25query(
        literal(query.replace("\x00", ""), literal_execute=True),
        literal(index, literal_execute=True),
    )
    score = Piece.text.op("<@>", return_type=Float)(asked).label("score")
    # No subquery around it either: pg_textsearch refuses that form the same way.
    return select(Piece.path, Piece.n, score).where(_outside(archive)).order_by(score).limit(DEPTH)


async def _bm25(
    session: AsyncSession, query: str, index: str, archive: str | None
) -> list[tuple[str, int]]:
    rows = await session.execute(bm25_select(query, index, archive))
    # A row that misses the query scores 0; an index scan returns none, a plain scan would.
    return [(path, n) for path, n, score in rows.tuples() if score < 0]


async def _nearest(
    session: AsyncSession, vector: list[float], archive: str | None
) -> list[tuple[str, int]]:
    rows = await session.execute(
        select(Piece.path, Piece.n)
        .where(_outside(archive))
        .order_by(Piece.embedding.cosine_distance(vector))
        .limit(DEPTH)
    )
    return list(rows.tuples())


def _chunk(text: str) -> str:
    # Drop the title line the indexer put in front for the model.
    return (text.partition("\n\n")[2] or text)[:SNIPPET]


async def similar_notes(
    session: AsyncSession, path: str, archive: str | None, limit: int = 10
) -> list[RankedNote]:
    """The notes whose pieces lie nearest any piece of `path`, nearest first, `path` left out.

    A note scores `1 - cosine distance` of its nearest pair. A note with no pieces has none.
    """
    # Materialized, each vector is read out of TOAST once rather than once a pair:
    # 40 s down to under 2 s for a note of 171 pieces on a copy of the live index.
    normal = func.l2_normalize(Piece.embedding, type_=Vector(DIMENSIONS)).label("vector")
    mine = select(normal).where(Piece.path == path).cte("mine").prefix_with("MATERIALIZED")
    others = (
        select(Piece.path, Piece.n, normal)
        .where(Piece.path != path, _outside(archive))
        .cte("others")
        .prefix_with("MATERIALIZED")
    )
    distance = func.min(others.c.vector.cosine_distance(mine.c.vector)).label("distance")
    pairs = (
        select(others.c.path, others.c.n, distance)
        .join(mine, true())
        .group_by(others.c.path, others.c.n)
        .subquery()
    )
    best = (
        select(pairs.c.path, pairs.c.n, pairs.c.distance)
        .distinct(pairs.c.path)
        .order_by(pairs.c.path, pairs.c.distance)
        .subquery()
    )
    rows = await session.execute(
        select(best.c.path, Piece.heading, Piece.text, best.c.distance)
        .join(Piece, (Piece.path == best.c.path) & (Piece.n == best.c.n))
        .order_by(best.c.distance, best.c.path)
        .limit(limit)
    )
    return [
        RankedNote(found, heading, _chunk(text), 1 - distance)
        for found, heading, text, distance in rows.tuples()
    ]


async def ranked_notes(
    session: AsyncSession,
    query: str,
    vector: list[float] | None,
    archive: str | None,
    limit: int = 20,
) -> list[RankedNote]:
    """The notes best matching `query`, best first; `vector` None ranks by words alone.

    `archive` names a folder whose notes stay out, or None to keep them.
    """
    lists = [await _bm25(session, query, index, archive) for index in INDEXES]
    if vector is not None:
        lists.append(await _nearest(session, vector, archive))
    best: dict[str, tuple[int, float]] = {}
    for (path, n), score in fuse(lists):
        if path not in best:
            best[path] = (n, score)
        if len(best) == limit:
            break
    if not best:
        return []
    keys = [(path, n) for path, (n, _) in best.items()]
    rows = await session.execute(
        select(Piece.path, Piece.heading, Piece.text).where(tuple_(Piece.path, Piece.n).in_(keys))
    )
    pieces = {path: (heading, text) for path, heading, text in rows.tuples()}
    found = []
    for path, (_, score) in best.items():
        # The indexer may have rewritten or dropped the piece since the lists ran.
        if path not in pieces:
            continue
        heading, text = pieces[path]
        found.append(RankedNote(path, heading, _chunk(text), score))
    return found
