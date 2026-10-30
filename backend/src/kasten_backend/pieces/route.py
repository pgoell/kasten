"""The ranked search: notes by BM25 and by meaning over the pieces index, best first."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002  FastAPI reads it at runtime

from kasten_backend.config import Settings, get_settings
from kasten_backend.db import get_session
from kasten_backend.pieces import indexer
from kasten_backend.pieces.indexer import Indexer  # noqa: TC001  FastAPI reads it at runtime
from kasten_backend.pieces.models import PieceNote
from kasten_backend.pieces.ranked import ranked_notes
from kasten_backend.vault import list_markdown_files

router = APIRouter()


class RankedHit(BaseModel):
    """A note the ranked search found, with its best piece."""

    path: str
    heading: str
    """The best piece's heading path, `A > B`, or empty before the note's first heading."""
    text: str
    """The start of the best piece, without the title line the model saw."""
    score: float
    """The fused score: the sum of `1 / (60 + rank)` over the lists the piece is in."""


class RankedAnswer(BaseModel):
    """The ranked notes, and how much of the index stood behind them."""

    hits: list[RankedHit]
    meaning: bool
    """Whether the vectors took part. False while the model loads, or with none configured."""
    indexed: int
    """Notes the index holds. Below `notes` while the first indexing runs."""
    notes: int


def get_indexer() -> Indexer | None:
    """The running indexer, a dependency so a test can hand in its own."""
    return indexer.running


def _vault_notes(settings: Settings, running: Indexer | None) -> int:
    paths = list_markdown_files(settings.vault_path)
    return sum(1 for path in paths if running is None or not running.skipped(path))


@router.get("/api/ranked")
async def ranked_search(
    q: str,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
    running: Annotated[Indexer | None, Depends(get_indexer)],
    archive: bool = False,
) -> RankedAnswer:
    """The notes best matching `q` by its words and by its meaning, at most twenty.

    A blank query answers no notes and embeds nothing. `archive` takes the
    archive folder in, as the line search does.
    """
    notes = await asyncio.to_thread(_vault_notes, settings, running)
    query = q.strip()
    vector = None if not query or running is None else await running.embed_query(query)
    meaning = vector is not None if query else running is not None and running.ready
    try:
        indexed = await session.scalar(select(func.count()).select_from(PieceNote)) or 0
    except ProgrammingError:
        # No pieces table: a database the migration has not reached.
        return RankedAnswer(hits=[], meaning=False, indexed=0, notes=notes)
    skip = None if archive else settings.archive_path
    found = await ranked_notes(session, query, vector, skip) if query else []
    hits = [RankedHit(path=n.path, heading=n.heading, text=n.text, score=n.score) for n in found]
    return RankedAnswer(hits=hits, meaning=meaning, indexed=indexed, notes=notes)
