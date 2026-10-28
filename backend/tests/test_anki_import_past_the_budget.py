"""An import from an upload that outlasts the answer budget, and how it reports after.

The import is held up by a seam on `read_apkg` or `store` that waits on an
event the test sets, never by a sleep, and the budget is lowered to a moment.
Each finish goes through HTTP; the import's task is awaited only to know it
ended before the poll that reads its outcome.
"""

import asyncio
import threading
from typing import TYPE_CHECKING, Any

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from backend.tests.anki_build import BASIC, CAT_EXPORT, apkg
from kasten_backend import files, uploads
from kasten_backend.main import app
from kasten_backend.routes import anki as anki_routes
from kasten_backend.routes import anki_imports

if TYPE_CHECKING:
    from pathlib import Path

FRENCH = apkg(
    notes=((1, BASIC, "Bonjour\x1fhello"),), cards=((11, 1, 100, 0),), decks=((100, "French"),)
)
"""One Basic card in the deck French."""

COUNTS = {
    "notes": ["03 Flashcards/French.md"],
    "cards": 1,
    "media": 0,
    "added": 1,
    "updated": 0,
    "kept": 0,
    "removed": 0,
}


async def send(client: AsyncClient, data: bytes) -> str:
    """Upload `data` in two pieces and answer its id."""
    started = await client.post("/api/uploads", json={"size": len(data)})
    key = started.json()["id"]
    half = len(data) // 2
    for n, piece in enumerate((data[:half], data[half:])):
        put = await client.put(f"/api/uploads/{key}/{n}", content=piece)
        assert put.status_code == 204
    return key


class Gate:
    """A `read_apkg` that waits until the test opens it, counting the imports that reached it.

    A threading event, since `read_apkg` runs in a worker thread.
    """

    def __init__(self, fail: list[Exception] | None = None) -> None:
        self.open = threading.Event()
        self.calls = 0
        self.fail = fail or []
        self.real = anki_routes.read_apkg

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        self.open.wait(timeout=10)
        if self.fail:
            raise self.fail.pop(0)
        return self.real(*args, **kwargs)


@pytest.fixture
def gate(monkeypatch: pytest.MonkeyPatch) -> Gate:
    monkeypatch.setattr(anki_imports, "ANSWER_BUDGET_SECONDS", 0.05)
    held = Gate()
    monkeypatch.setattr(anki_routes, "read_apkg", held)
    return held


def files_in(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file())


async def ended(key: str) -> None:
    await anki_imports._imports[key].task


async def test_a_finish_past_the_budget_answers_at_once_and_reports_done_later(
    client: AsyncClient, vault: Path, gate: Gate
) -> None:
    key = await send(client, FRENCH)

    finish = await client.post("/api/anki", params={"upload": key})
    running = await client.get(f"/api/anki/imports/{key}")
    gate.open.set()
    await ended(key)
    done = await client.get(f"/api/anki/imports/{key}")

    assert finish.status_code == 202
    assert finish.json() == {"upload": key}
    assert running.status_code == 202
    assert done.status_code == 200
    assert done.json() == COUNTS
    assert (vault / "03 Flashcards" / "French.md").is_file()


async def test_a_failed_import_past_the_budget_reports_its_reason(
    client: AsyncClient, vault: Path, gate: Gate
) -> None:
    gate.fail.append(OSError("The disk is full"))
    key = await send(client, FRENCH)

    finish = await client.post("/api/anki", params={"upload": key})
    gate.open.set()
    await ended(key)
    failed = await client.get(f"/api/anki/imports/{key}")

    assert finish.status_code == 202
    assert failed.status_code == 500
    assert failed.json() == {"detail": "The import failed: The disk is full"}
    assert not (vault / "03 Flashcards" / "French.md").exists()


async def test_a_refused_import_past_the_budget_reports_the_refusal_as_it_was(
    client: AsyncClient, vault: Path, gate: Gate
) -> None:
    # A note from before the markers: the refusal it always got.
    note = vault / "03 Flashcards" / "French.md"
    note.parent.mkdir(parents=True)
    note.write_text("#flashcards/French\n\nBonjour::hello\n", encoding="utf-8")
    key = await send(client, FRENCH)

    finish = await client.post("/api/anki", params={"upload": key})
    gate.open.set()
    await ended(key)
    refused = await client.get(f"/api/anki/imports/{key}")

    assert finish.status_code == 202
    assert refused.status_code == 409
    assert refused.json() == {"detail": "French is already in the vault"}


async def test_a_second_finish_while_one_runs_imports_once(
    client: AsyncClient, vault: Path, gate: Gate
) -> None:
    key = await send(client, FRENCH)

    first = await client.post("/api/anki", params={"upload": key})
    second = await client.post("/api/anki", params={"upload": key})
    gate.open.set()
    await ended(key)
    after = await client.post("/api/anki", params={"upload": key})

    assert (first.status_code, second.status_code) == (202, 202)
    assert gate.calls == 1
    assert after.status_code == 201
    assert after.json() == COUNTS
    assert gate.calls == 1


async def test_a_retry_after_a_failure_finishes_the_upload_without_sending_it_again(
    client: AsyncClient, vault: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = Gate(fail=[OSError("The disk is full")])
    held.open.set()
    monkeypatch.setattr(anki_routes, "read_apkg", held)
    key = await send(client, FRENCH)

    failed = await client.post("/api/anki", params={"upload": key})
    kept = list((tmp_path / "uploads").iterdir())
    again = await client.post("/api/anki", params={"upload": key})

    assert failed.status_code == 500
    assert failed.json() == {"detail": "The import failed: The disk is full"}
    assert kept == [tmp_path / "uploads" / key]
    assert again.status_code == 201
    assert again.json() == COUNTS
    assert list((tmp_path / "uploads").iterdir()) == []


async def test_a_quick_refusal_still_answers_the_finish_and_keeps_the_upload(
    client: AsyncClient, vault: Path, tmp_path: Path
) -> None:
    note = vault / "03 Flashcards" / "French.md"
    note.parent.mkdir(parents=True)
    note.write_text("#flashcards/French\n\nBonjour::hello\n", encoding="utf-8")
    key = await send(client, FRENCH)

    refused = await client.post("/api/anki", params={"upload": key})
    note.unlink()
    again = await client.post("/api/anki", params={"upload": key})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "French is already in the vault"}
    assert again.status_code == 201


async def test_the_sweep_leaves_an_upload_whose_import_runs(
    client: AsyncClient, vault: Path, gate: Gate, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = await send(client, FRENCH)
    finish = await client.post("/api/anki", params={"upload": key})
    # Every upload counts as idle now, so only the import's hold keeps this one.
    monkeypatch.setattr(uploads, "UPLOAD_IDLE_SECONDS", -1)
    uploads.sweep()
    gate.open.set()
    await ended(key)
    done = await client.get(f"/api/anki/imports/{key}")

    assert finish.status_code == 202
    assert done.status_code == 200


async def test_an_import_the_backend_never_ran_is_a_404_with_a_sentence(
    client: AsyncClient, vault: Path
) -> None:
    response = await client.get(f"/api/anki/imports/{'0' * 32}")

    assert response.status_code == 404
    assert response.json() == {
        "detail": "No such import. The backend may have restarted: import the file again."
    }


async def test_a_restart_mid_import_leaves_no_half_written_deck(
    vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(anki_imports, "ANSWER_BUDGET_SECONDS", 0.05)
    real = anki_routes.store
    writing = asyncio.Event()
    never = asyncio.Event()

    calls = 0

    async def stalled(*args: Any, **kwargs: Any) -> Any:
        # The first media file lands, then the import stalls before the next:
        # the only await inside the writes, so the deepest a shutdown reaches.
        nonlocal calls
        calls += 1
        if calls == 2:
            writing.set()
            await never.wait()
        return await real(*args, **kwargs)

    monkeypatch.setattr(anki_routes, "store", stalled)

    async with (
        LifespanManager(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
    ):
        key = await send(client, CAT_EXPORT)
        finish = await client.post("/api/anki", params={"upload": key})
        await asyncio.wait_for(writing.wait(), 10)
        partway = files_in(vault)

    assert finish.status_code == 202
    assert partway != []
    assert files_in(vault) == []


async def test_a_finish_asking_for_the_schedule_does_not_join_one_without_it(
    client: AsyncClient, vault: Path, gate: Gate
) -> None:
    key = await send(client, FRENCH)

    first = await client.post("/api/anki", params={"upload": key})
    carried = await client.post("/api/anki", params={"upload": key, "carry": "true"})
    gate.open.set()
    await ended(key)
    after = await client.post("/api/anki", params={"upload": key, "carry": "true"})

    assert first.status_code == 202
    assert carried.status_code == 409
    assert carried.json() == {
        "detail": "That file is already importing with other settings. Wait for it to end."
    }
    assert after.status_code == 404
    assert gate.calls == 1


async def test_an_upload_kept_after_a_failure_gives_way_to_a_new_one(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    held = Gate(fail=[OSError("The disk is full")])
    held.open.set()
    monkeypatch.setattr(anki_routes, "read_apkg", held)
    key = await send(client, FRENCH)
    failed = await client.post("/api/anki", params={"upload": key})
    # Room for one file of this size and no more.
    monkeypatch.setattr(files, "OPEN_LIMIT_BYTES", len(FRENCH) + 1)

    started = await client.post("/api/uploads", json={"size": len(FRENCH)})
    gone = await client.post("/api/anki", params={"upload": key})

    assert failed.status_code == 500
    assert started.status_code == 201
    assert gone.status_code == 404
