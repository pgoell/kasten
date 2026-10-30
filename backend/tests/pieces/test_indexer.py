"""The pieces index follows the vault: on startup, on every change, and past a failure.

Runs against the migrated database at `KASTEN_DATABASE_URL` with a fake model
whose vectors come from a hash of the text, so a test can count what was
embedded. The indexer commits as it would in production, so each test empties
the two tables before and after. A box with no database skips.
"""

import asyncio
import hashlib
import logging
import re
import threading
import time
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from kasten_backend.config import Settings
from kasten_backend.pieces import indexer
from kasten_backend.pieces.embed import DIMENSIONS, model_thread
from kasten_backend.pieces.indexer import Indexer

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from sqlalchemy.ext.asyncio import AsyncSession

SKIP = "04 Ressources/05 Flashcards"


class FakeModel:
    """Whitespace tokens and a vector from the text's hash; counts what it embeds."""

    def __init__(self) -> None:
        self.embedded: list[str] = []

    def offsets(self, text: str) -> list[tuple[int, int]]:
        return [(match.start(), match.end()) for match in re.finditer(r"\S+", text)]

    def embed(self, texts: list[str]) -> list[list[float]]:
        if any("BOOM" in piece for piece in texts):
            message = "the model refuses this piece"
            raise ValueError(message)
        self.embedded.extend(texts)
        return [_vector(body) for body in texts]


class WatchedModel(FakeModel):
    """Embeds only once the event loop has run while it waits, on the thread it notes."""

    def __init__(self) -> None:
        super().__init__()
        self.thread: int | None = None
        self.waiting = threading.Event()
        self.ticked = threading.Event()
        self.heard = False

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.thread = threading.get_ident()
        self.waiting.set()
        # Run on the loop, this wait blocks the very loop that would end it.
        self.heard = self.ticked.wait(30)
        return super().embed(texts)


def _vector(body: str) -> list[float]:
    seed = hashlib.sha256(body.encode()).digest()
    return [seed[i % 32] / 255 for i in range(DIMENSIONS)]


async def _empty(factory: async_sessionmaker[AsyncSession]) -> None:
    async with factory() as session, session.begin():
        await session.execute(text("DELETE FROM piece_notes"))


async def _rows(factory: async_sessionmaker[AsyncSession]) -> list[tuple]:
    async with factory() as session:
        result = await session.execute(
            text("SELECT path, n, heading, digest, text, embedding::text FROM pieces ORDER BY 1, 2")
        )
        return [tuple(row) for row in result]


def _make(model: FakeModel, root: Path, factory: async_sessionmaker[AsyncSession]) -> Indexer:
    loads = []

    def load() -> FakeModel:
        loads.append(1)
        return model

    made = Indexer(root, factory, load, model_thread(), SKIP)
    made.loads = loads  # ty: ignore[unresolved-attribute]
    return made


async def _drain(made: Indexer) -> None:
    """Run one sweep and every note it queues, as `run` does before the watcher matters."""
    await made._model_loaded()
    made._sweep = False
    await made._stale()
    while made._backlog:
        path = next(iter(made._backlog))
        del made._backlog[path]
        await made.index(path)


def _write(root: Path, path: str, body: str) -> None:
    (root / path).parent.mkdir(parents=True, exist_ok=True)
    (root / path).write_text(body)


async def _until(check, seconds: float = 10.0) -> None:
    """Wait for a condition the watcher makes true, failing past `seconds`."""
    deadline = time.monotonic() + seconds
    while not await check():
        assert time.monotonic() < deadline, "the index never caught up"
        await asyncio.sleep(0.05)


async def test_watcher_indexes_saves_renames_and_deletes_with_no_browser(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    model = FakeModel()
    made = _make(model, tmp_path, sessions)
    running = asyncio.create_task(made.run())
    try:
        await _until(lambda: _settled(made))

        async def paths() -> list[str]:
            return sorted({row[0] for row in await _rows(sessions)})

        async def has(expected: list[str]) -> bool:
            return await paths() == expected

        async def saved() -> bool:
            # Written again on each look: the watcher's inotify may not be up
            # yet when the first write lands, and nothing tells the test when.
            _write(tmp_path, "a.md", f"# Start\n\nwords at {time.monotonic()}")
            return await has(["a.md"])

        await _until(saved)
        (tmp_path / "a.md").rename(tmp_path / "b.md")
        await _until(lambda: has(["b.md"]))
        (tmp_path / "b.md").unlink()
        await _until(lambda: has([]))
    finally:
        running.cancel()


async def _settled(made: Indexer) -> bool:
    return not (made._sweep or made._backlog or made._changed)


async def test_startup_sweep_reads_only_changed_notes_and_drops_gone_ones(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    _write(tmp_path, "keep.md", "kept words")
    _write(tmp_path, "edit.md", "old words")
    _write(tmp_path, "gone.md", "going words")
    model = FakeModel()
    await _drain(_make(model, tmp_path, sessions))
    _write(tmp_path, "edit.md", "new words")
    (tmp_path / "gone.md").unlink()
    later = FakeModel()
    await _drain(_make(later, tmp_path, sessions))
    assert later.embedded == ["edit\n\nnew words"]
    assert sorted({row[0] for row in await _rows(sessions)}) == ["edit.md", "keep.md"]


async def test_flashcards_stay_out(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    _write(tmp_path, f"{SKIP}/Japanese/deck.md", "neko :: cat")
    _write(tmp_path, "04 Ressources/note.md", "a note")
    await _drain(_make(FakeModel(), tmp_path, sessions))
    assert [row[0] for row in await _rows(sessions)] == ["04 Ressources/note.md"]


async def test_dropping_and_rebuilding_gives_the_same_rows(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    _write(
        tmp_path,
        "x/Steuer.md",
        "---\ntype: Note\n---\n# Kapital\n\n## Freibetrag\n\n" + "wort " * 40,
    )
    _write(tmp_path, "y.md", "plain")
    await _drain(_make(FakeModel(), tmp_path, sessions))
    first = await _rows(sessions)
    await _empty(sessions)
    await _drain(_make(FakeModel(), tmp_path, sessions))
    assert await _rows(sessions) == first
    assert first[0][2] == "Kapital > Freibetrag"


async def test_a_save_embeds_only_the_pieces_that_changed(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    _write(tmp_path, "n.md", "# One\n\nsame\n\n# Two\n\nbefore")
    model = FakeModel()
    made = _make(model, tmp_path, sessions)
    await _drain(made)
    model.embedded.clear()
    _write(tmp_path, "n.md", "# One\n\nsame\n\n# Two\n\nafter")
    await made.index("n.md")
    assert model.embedded == ["n > Two\n\nafter"]


async def test_a_folder_move_keeps_every_vector(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    _write(tmp_path, "old/a.md", "alpha words")
    _write(tmp_path, "old/b.md", "beta words")
    model = FakeModel()
    made = _make(model, tmp_path, sessions)
    await _drain(made)
    before = [row[1:] for row in await _rows(sessions)]
    model.embedded.clear()
    (tmp_path / "old").rename(tmp_path / "new")
    await _drain(made)
    assert model.embedded == []
    rows = await _rows(sessions)
    assert [row[0] for row in rows] == ["new/a.md", "new/b.md"]
    assert [row[1:] for row in rows] == before


async def test_a_note_with_no_text_is_read_once(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    _write(tmp_path, "empty.md", "---\ntype: Note\n---\n\n")
    model = FakeModel()
    await _drain(_make(model, tmp_path, sessions))
    again = _make(model, tmp_path, sessions)
    await again._model_loaded()
    await again._stale()
    assert await _rows(sessions) == []
    assert again._backlog == {}


async def test_one_failing_note_does_not_stop_the_rest(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    _write(tmp_path, "a.md", "BOOM here")
    _write(tmp_path, "b.md", "fine here")
    with caplog.at_level(logging.WARNING):
        await _drain(_make(FakeModel(), tmp_path, sessions))
    assert [row[0] for row in await _rows(sessions)] == ["b.md"]
    assert "skips a.md" in caplog.text


async def test_the_model_loads_once(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    for name in "abc":
        _write(tmp_path, f"{name}.md", f"{name} words")
    made = _make(FakeModel(), tmp_path, sessions)
    await _drain(made)
    _write(tmp_path, "a.md", "changed")
    await made.index("a.md")
    assert made.loads == [1]  # ty: ignore[unresolved-attribute]


async def test_embedding_never_blocks_the_event_loop(
    tmp_path: Path, sessions: async_sessionmaker[AsyncSession]
) -> None:
    _write(tmp_path, "slow.md", "slow words")
    model = WatchedModel()
    made = _make(model, tmp_path, sessions)
    await made._model_loaded()
    work = asyncio.create_task(made.index("slow.md"))
    while not work.done():
        await asyncio.sleep(0.01)
        if model.waiting.is_set():
            model.ticked.set()
    await work
    assert model.thread != threading.get_ident()
    assert model.heard
    assert len(await _rows(sessions)) == 1


def test_no_model_means_no_indexer() -> None:
    assert indexer.start(Settings(embed_model_dir=None)) is None


async def test_a_model_that_will_not_load_stops_the_indexer_quietly(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    def broken() -> FakeModel:
        message = "no model.onnx here"
        raise OSError(message)

    made = Indexer(tmp_path, async_sessionmaker(), broken, model_thread())
    with caplog.at_level(logging.WARNING):
        await asyncio.wait_for(made.run(), 5)
    assert "model will not load" in caplog.text


async def test_no_database_stops_the_indexer_quietly(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    _write(tmp_path, "a.md", "words")
    engine = create_async_engine(
        "postgresql+psycopg://nobody:nothing@127.0.0.1:1/none", poolclass=NullPool
    )
    made = Indexer(tmp_path, async_sessionmaker(engine), FakeModel, model_thread())
    with caplog.at_level(logging.WARNING):
        await asyncio.wait_for(made.run(), 10)
    assert "its database fails" in caplog.text
    await engine.dispose()
