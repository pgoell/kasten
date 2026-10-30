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
from sqlalchemy.exc import (
    OperationalError,
    ProgrammingError,
    SQLAlchemyError,
    StatementError,
)
from sqlalchemy.exc import TimeoutError as PoolTimeout
from watchfiles._rust_notify import WatchfilesRustInternalError

from kasten_backend.db import session_factory
from kasten_backend.events import watch_vault
from kasten_backend.pieces.embed import MODEL_ERRORS, BgeM3, model_thread
from kasten_backend.pieces.models import Piece, PieceNote
from kasten_backend.pieces.split import split_note
from kasten_backend.vault import list_markdown_files

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from kasten_backend.config import Settings
    from kasten_backend.pieces.embed import Embedder

logger = logging.getLogger(__name__)

# Seconds between tries while the database or the watcher is gone, doubling up to the cap.
FIRST_WAIT = 1.0
LONGEST_WAIT = 60.0


def _passing(error: SQLAlchemyError) -> bool:
    """Whether waiting cures `error`: a lost or refused connection, or a full pool or server."""
    if isinstance(error, PoolTimeout):
        return True
    if not isinstance(error, OperationalError):
        return False
    state = getattr(error.orig, "sqlstate", None)
    # 08: connection exception; 57P01-03: the server shut down or is starting;
    # 53300: too many connections, for a moment after a restart.
    return state is None or state.startswith("08") or state in ("57P01", "57P02", "57P03", "53300")


def _cause(error: SQLAlchemyError) -> str:
    """What to log of `error`: the driver's first line, never the statement, its values or the row.

    Postgres puts the failing row, a note's text and vector, in a second `DETAIL:` line.
    """
    cause = error.orig if isinstance(error, StatementError) else error
    lines = str(cause).splitlines() if cause is not None else []
    return lines[0] if lines else type(error).__name__


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
        self._wait: Callable[[float], Awaitable[None]] = asyncio.sleep
        """The pause between tries; a test swaps it to count them."""
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

        A model that fails, or a database query that fails for another reason than
        one waiting cures, stops the indexer with one warning; the backend serves on.
        """
        try:
            await self._model_loaded()
        except (OSError, *MODEL_ERRORS) as error:
            logger.warning("The pieces index stays off, its model will not load: %s", error)
            return
        # The watcher first, so it is up before the first sweep lists the vault.
        tasks = (asyncio.create_task(self._watch()), asyncio.create_task(self._work()))
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except SQLAlchemyError as error:
            logger.warning("The pieces index stops, its database fails: %s", _cause(error))
        finally:
            for task in tasks:
                task.cancel()
            self._thread.shutdown(wait=False, cancel_futures=True)

    async def _watch(self) -> None:
        """Follow the vault, starting the watcher again after a fault such as an inotify limit."""
        tries = 0
        while True:
            fault: object = "the vault folder is gone"
            try:
                async for events in watch_vault(self._root):
                    if tries:
                        logger.warning("The pieces index follows saves again after %d tries", tries)
                        tries = 0
                    for event in events:
                        if event.change == "listing":
                            self._sweep = True
                        elif event.change in ("written", "removed"):
                            self._changed[event.path] = None
                    self._wake.set()
            except (OSError, WatchfilesRustInternalError) as error:
                fault = error
            if not tries:
                logger.warning("The pieces index restarts its watcher, which fails: %s", fault)
            await self._wait(min(FIRST_WAIT * 2 ** min(tries, 6), LONGEST_WAIT))
            tries += 1
            # The sweep runs once the new watcher is up, and finds the saves none saw.
            self._sweep = True
            self._wake.set()

    async def _work(self) -> None:
        tries = 0
        while True:
            await self._wake.wait()
            self._wake.clear()
            try:
                while self._changed or self._backlog or self._sweep:
                    if self._sweep:
                        self._sweep = False
                        await self._stale()
                    else:
                        queue = self._changed or self._backlog
                        path = next(iter(queue))
                        del queue[path]
                        await self.index(path)
                    if tries:
                        logger.warning("The pieces index resumes after %d tries", tries)
                        tries = 0
            except (OperationalError, PoolTimeout) as error:
                if not _passing(error):
                    raise
                if not tries:
                    logger.warning("The pieces index waits for its database: %s", _cause(error))
                # A bounded exponent: 2**1024 overflows a float, some 17 hours in.
                await self._wait(min(FIRST_WAIT * 2 ** min(tries, 6), LONGEST_WAIT))
                tries += 1
                # The sweep finds the note that failed and any save the watcher missed.
                self._sweep = True
                self._wake.set()

    async def _stale(self) -> None:
        """Queue every note whose bytes differ from the index's, and drop the notes gone.

        Gone notes drop after the stale are read: a folder move reuses the old
        path's vectors.
        """
        if not await asyncio.to_thread(self._root.is_dir):
            # A vault that is gone would drop every note, and a remount re-embed them all.
            return
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

        A failing note is logged and left for the next sweep; a fault waiting cures or
        a schema fault is raised for `run` to wait or stop on.
        """
        try:
            await self._index(path)
        except (OperationalError, PoolTimeout) as error:
            if _passing(error):
                raise
            logger.warning("The pieces index skips %s: %s", path, _cause(error))
        except ProgrammingError:
            raise
        except SQLAlchemyError as error:
            logger.warning("The pieces index skips %s: %s", path, _cause(error))
        except (ValueError, *MODEL_ERRORS) as error:
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
    task = asyncio.create_task(indexer.run())
    task.add_done_callback(_ended)
    return task


def _ended(task: asyncio.Task[None]) -> None:
    """Log how the task ended on its own: nothing awaits it, so an error would go unseen."""
    if task.cancelled():
        return
    if error := task.exception():
        logger.error("The pieces index ends on an error", exc_info=error)
    else:
        logger.info("The pieces index has stopped")
