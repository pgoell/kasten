"""Keeps the pieces index in step with the vault: a sweep on startup, then the watcher.

Pieces match stored rows by the sha256 of their text, so a save re-embeds only
changed pieces and a folder move none. A note the watcher reports goes before
the rest of a sweep.
"""

import asyncio
import hashlib
import logging
from typing import TYPE_CHECKING

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import OperationalError, ProgrammingError, SQLAlchemyError

from kasten_backend.db import session_factory
from kasten_backend.events import watch_vault
from kasten_backend.pieces.embed import MODEL_ERRORS, BgeM3, model_thread
from kasten_backend.pieces.models import Piece, PieceNote
from kasten_backend.pieces.split import split_note
from kasten_backend.vault import list_markdown_files

if TYPE_CHECKING:
    from collections.abc import Callable
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from kasten_backend.config import Settings
    from kasten_backend.pieces.embed import Embedder

logger = logging.getLogger(__name__)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Indexer:
    """One process's indexer: a queue of notes to read, and the worker that reads them."""

    def __init__(
        self,
        root: Path,
        sessions: async_sessionmaker[AsyncSession],
        load: Callable[[], Embedder],
        thread: ThreadPoolExecutor,
        skip: str = "",
    ) -> None:
        """Wire the indexer to its vault, its database, its model and the model's thread."""
        self._root = root
        self._sessions = sessions
        self._load = load
        self._thread = thread
        self._skip = skip.strip("/")
        self._model: Embedder | None = None
        self._changed: dict[str, None] = {}
        """Notes the watcher reported, in the order it did. A dict for an ordered set."""
        self._backlog: dict[str, None] = {}
        """Notes a sweep found stale, read after every note in `_changed`."""
        self._sweep = True
        self._wake = asyncio.Event()
        self._wake.set()

    def skipped(self, path: str) -> bool:
        """Whether `path` lies in the folder the index leaves out."""
        return bool(self._skip) and (path == self._skip or path.startswith(f"{self._skip}/"))

    async def run(self) -> None:
        """Load the model, sweep, then follow the watcher, until cancelled or something fails.

        A model that will not load or a database that is down stops the indexer with
        one warning; the backend serves on, and the next start catches up.
        """
        try:
            await self._model_loaded()
        except (OSError, *MODEL_ERRORS) as error:
            logger.warning("The pieces index stays off, its model will not load: %s", error)
            return
        watching = asyncio.create_task(self._watch())
        try:
            await self._work()
        except (OperationalError, ProgrammingError) as error:
            logger.warning("The pieces index stops, its database fails: %s", error.orig)
        finally:
            watching.cancel()
            self._thread.shutdown(wait=False, cancel_futures=True)

    async def _watch(self) -> None:
        async for events in watch_vault(self._root):
            for event in events:
                if event.change == "listing":
                    self._sweep = True
                elif event.change in ("written", "removed"):
                    self._changed[event.path] = None
            self._wake.set()

    async def _work(self) -> None:
        while True:
            await self._wake.wait()
            self._wake.clear()
            while self._changed or self._backlog or self._sweep:
                if self._sweep:
                    self._sweep = False
                    await self._stale()
                    continue
                queue = self._changed or self._backlog
                path = next(iter(queue))
                del queue[path]
                await self.index(path)

    async def _stale(self) -> None:
        """Queue every note whose bytes differ from the index's, and drop the notes gone.

        The gone are dropped after the stale are read, not before: a folder move
        is both, and the pieces under the old path are the vectors the new path
        takes over.
        """
        paths = [path for path in list_markdown_files(self._root) if not self.skipped(path)]
        async with self._sessions() as session:
            rows = await session.execute(select(PieceNote.path, PieceNote.digest))
            known = dict(rows.tuples().all())
        for path in paths:
            data = await asyncio.to_thread(self._read, path)
            if data is not None and known.get(path) != _sha(data):
                self._backlog[path] = None
        gone = set(known) - set(paths)
        if gone:
            self._backlog.update(dict.fromkeys(sorted(gone)))

    def _read(self, path: str) -> bytes | None:
        try:
            return (self._root / path).read_bytes()
        except OSError:
            return None

    async def index(self, path: str) -> None:
        """Bring one note's pieces in line with its file: new, changed, unchanged or gone.

        A note that fails, a model error or a row the database refuses, is
        logged and left for the next sweep, and the rest go on. A database that
        fails as a whole is raised for `run` to stop on.
        """
        try:
            await self._index(path)
        except OperationalError, ProgrammingError:
            raise
        except (SQLAlchemyError, ValueError, *MODEL_ERRORS) as error:
            logger.warning("The pieces index skips %s: %s", path, error)

    async def _index(self, path: str) -> None:
        """Read, embed what is new, then write in one transaction.

        The model runs between two sessions, not inside one, so a long note
        holds no connection while it embeds. Nothing else writes these tables:
        this worker is the only one, and it reads one note at a time.
        """
        data = None if self.skipped(path) else await asyncio.to_thread(self._read, path)
        if data is None:
            async with self._sessions() as session, session.begin():
                await session.execute(delete(PieceNote).where(PieceNote.path == path))
            return
        digest = _sha(data)
        model = await self._model_loaded()
        loop = asyncio.get_running_loop()
        async with self._sessions() as session:
            if (
                await session.scalar(select(PieceNote.digest).where(PieceNote.path == path))
                == digest
            ):
                return
            content = data.decode("utf-8", errors="replace")
            pieces = await loop.run_in_executor(
                self._thread, split_note, path, content, model.offsets
            )
            digests = [_sha(piece.text.encode()) for piece in pieces]
            query = select(Piece.digest, Piece.embedding).where(Piece.digest.in_(digests))
            vectors = dict((await session.execute(query)).tuples().all())
        missing = {sha: piece.text for piece, sha in zip(pieces, digests, strict=True)}
        missing = {sha: text for sha, text in missing.items() if sha not in vectors}
        fresh = await loop.run_in_executor(self._thread, model.embed, list(missing.values()))
        vectors.update(zip(missing, fresh, strict=True))
        async with self._sessions() as session, session.begin():
            await session.execute(
                insert(PieceNote)
                .values(path=path, digest=digest)
                .on_conflict_do_update(index_elements=[PieceNote.path], set_={"digest": digest})
            )
            await session.execute(delete(Piece).where(Piece.path == path))
            if pieces:
                rows = [
                    {
                        "path": path,
                        "n": n,
                        "heading": piece.heading,
                        "digest": sha,
                        "text": piece.text,
                        "embedding": vectors[sha],
                    }
                    for n, (piece, sha) in enumerate(zip(pieces, digests, strict=True))
                ]
                await session.execute(insert(Piece), rows)

    async def _model_loaded(self) -> Embedder:
        """The model, built on its own thread the first time a note needs it."""
        if self._model is None:
            loop = asyncio.get_running_loop()
            self._model = await loop.run_in_executor(self._thread, self._load)
        return self._model


def start(settings: Settings) -> asyncio.Task[None] | None:
    """Run the pieces index in the background, or None when no model is configured."""
    folder = settings.embed_model_dir
    if folder is None:
        return None
    indexer = Indexer(
        settings.vault_path,
        session_factory,
        lambda: BgeM3(folder),
        model_thread(),
        settings.pieces_skip,
    )
    return asyncio.create_task(indexer.run())
