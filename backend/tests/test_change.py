"""What the write lock is for: two writers, and neither one's edit in the other's change."""

import asyncio
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import JJ, changed_paths, descriptions
from backend.tests.test_anki import apkg
from kasten_backend import vcs
from kasten_backend.change import vault_change

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

pytestmark = pytest.mark.skipif(JJ is None, reason="jj is not installed")

PARKED_RUNS = 2
"""Which `_run` call inside a save opens the change: the log read, then `jj new`."""

PNG = b"\x89PNG\r\n\x1a\n and not one byte more"
"""Enough of a header to pass the upload's magic check. Nothing here draws it."""


async def test_concurrent_writes_land_in_separate_changes(
    client: AsyncClient, versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Forced rather than raced: one save is parked with its change open and
    # before its write, which is the window the whole lock exists to close.
    # Left to subprocess timing this would pass on a fast box and fail on a
    # slow one.
    (versioned_vault / "a.md").write_text("# a")
    (versioned_vault / "b.md").write_text("# b")

    parked = asyncio.Event()
    released = asyncio.Event()
    real = vcs._run
    calls = 0

    async def parking(root: Path, *args: str) -> str | None:
        nonlocal calls
        calls += 1
        output = await real(root, *args)
        if calls == PARKED_RUNS:
            parked.set()
            await released.wait()
        return output

    monkeypatch.setattr("kasten_backend.vcs._run", parking)

    first = asyncio.create_task(client.put("/api/files/a.md", json={"content": "# alpha"}))
    await parked.wait()
    second = asyncio.create_task(client.put("/api/files/b.md", json={"content": "# beta"}))
    # Waited on with a timeout rather than awaited: unlocked, the second save
    # runs to the end and this returns at once; locked, it is waiting on the
    # first and awaiting it here would deadlock the test rather than the app.
    await asyncio.wait({second}, timeout=2.0)
    released.set()
    await first
    await second

    assert descriptions(versioned_vault).count("vault: a.md") == 1
    assert descriptions(versioned_vault).count("vault: b.md") == 1
    # `substring:` because a bare pattern is an exact match and jj keeps the
    # trailing newline `-m` gave the description.
    assert changed_paths(versioned_vault, 'description(substring:"vault: a.md")') == ["a.md"]
    assert changed_paths(versioned_vault, 'description(substring:"vault: b.md")') == ["b.md"]


async def test_vault_change_outside_vault_write_raises(versioned_vault: Path) -> None:
    with pytest.raises(RuntimeError):
        async with vault_change(versioned_vault, "a.md"):
            pass


async def test_a_writer_switch_opens_a_new_change(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # Four saves of one note in the sequence browser, agent, browser, agent, and
    # four changes rather than one. `describe` formats the writer into the
    # description `begin_change` compares, so a switch of writer seals the change
    # in hand even when the note has not moved. That is the point and it is the
    # cost: alternating edits to one note make more `jj log` entries than they
    # used to, and an agent write never amends the change holding your own.
    (versioned_vault / "index.md").write_text("# index")

    await client.put("/api/files/index.md", json={"content": "# browser"})
    token = vcs.writer.set("laptop")
    await client.put("/api/files/index.md", json={"content": "# agent"})
    vcs.writer.reset(token)
    await client.put("/api/files/index.md", json={"content": "# browser again"})
    token = vcs.writer.set("laptop")
    await client.put("/api/files/index.md", json={"content": "# agent again"})
    # Two agent saves of one note in a row still amend, the way two browser
    # saves do. It is the switch that opens a change, not the writer.
    await client.put("/api/files/index.md", json={"content": "# agent once more"})
    vcs.writer.reset(token)

    assert descriptions(versioned_vault) == [
        "agent(laptop): index.md",
        "vault: index.md",
        "agent(laptop): index.md",
        "vault: index.md",
    ]


async def test_an_imported_deck_is_one_change_in_the_log(
    client: AsyncClient, versioned_vault: Path
) -> None:
    # The import had no jj bracket at all until the lock went in, so an export
    # arrived in the vault with nothing in the history saying it had.
    response = await client.post("/api/anki", content=apkg())

    assert response.status_code == 201
    assert descriptions(versioned_vault) == ["vault: 03 Flashcards"]
    assert changed_paths(versioned_vault, "@") == [
        "03 Flashcards/French.md",
        "03 Flashcards/Geography.md",
    ]


async def test_a_published_image_is_in_the_log(client: AsyncClient, versioned_vault: Path) -> None:
    # An image rather than a book, because `vcs.IGNORES` keeps an epub out of
    # the history on purpose and its change would be empty either way.
    response = await client.post("/api/assets/pictures/plate.png", content=PNG)

    assert response.status_code == 201
    assert descriptions(versioned_vault) == ["vault: pictures/plate.png"]
    assert changed_paths(versioned_vault, "@") == ["pictures/plate.png"]
