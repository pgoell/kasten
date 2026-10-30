"""Keeps the pieces index in step with the vault: a sweep on startup, then the watcher.

Pieces match stored rows by the sha256 of their text, so a folder move re-embeds
nothing.
"""

import asyncio
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
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
        # Not the indexer's thread: a query waited 12.7 s behind the first fill.
        self._query_thread = ThreadPoolExecutor(max_workers=1, thread_name_prefix="query")
        self._changed: dict[str, None] = {}
        """Notes the watcher reported, in order; a dict as an ordered set."""
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

        A model or database that fails stops the indexer with one warning; the
        backend serves on.
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

        Gone notes drop after the stale are read: a folder move reuses the old
        path's vectors.
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

        A failing note is logged and left for the next sweep; a failing database
        is raised for `run` to stop on.
        """
        try:
            await self._index(path)
        except OperationalError, ProgrammingError:
            raise
        except (SQLAlchemyError, ValueError, *MODEL_ERRORS) as error:
            logger.warning("The pieces index skips %s: %s", path, error)

    async def _index(self, path: str) -> None:
        """Read, embed what is new, then write in one transaction.

        The model runs between two sessions, so a long note holds no connection
        while it embeds.
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

    @property
    def ready(self) -> bool:
        """Whether the model has loaded, so a query can be embedded."""
        return self._model is not None

    async def embed_query(self, text: str) -> list[float] | None:
        """The vector of a search query, or None while the model loads or once it failed.

        Never loads the model: a request waits for no load. onnxruntime runs one
        session from two threads, so the query waits for no indexing batch.
        """
        if self._model is None:
            return None
        loop = asyncio.get_running_loop()
        try:
            vectors = await loop.run_in_executor(self._query_thread, self._model.embed, [text])
        # RuntimeError: the thread was shut down.
        except (RuntimeError, ValueError, *MODEL_ERRORS) as error:
            logger.warning("A search goes by words alone, the model fails: %s", error)
            return None
        return vectors[0]

    async def _model_loaded(self) -> Embedder:
        """The model, built on its own thread the first time a note needs it."""
        if self._model is None:
            loop = asyncio.get_running_loop()
            self._model = await loop.run_in_executor(self._thread, self._load)
        return self._model


running: Indexer | None = None
"""The indexer `start` began, which the ranked search asks for query vectors; None with no model."""


def start(settings: Settings) -> asyncio.Task[None] | None:
    """Run the pieces index in the background, or None when no model is configured."""
    global running  # noqa: PLW0603  one indexer a process, set once at startup
    folder = settings.embed_model_dir
    if folder is None:
        return None
    indexer = running = Indexer(
        settings.vault_path,
        session_factory,
        lambda: BgeM3(folder),
        model_thread(),
        settings.pieces_skip,
    )
    return asyncio.create_task(indexer.run())
