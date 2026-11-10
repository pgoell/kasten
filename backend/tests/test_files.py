import asyncio
import os
import threading
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from kasten_backend.config import Settings, get_settings
from kasten_backend.main import app
from kasten_backend.routes import listing, notes
from kasten_backend.vault import (
    Listings,
    list_assets,
    list_html,
    list_images,
    list_markdown_files,
    scan,
)

if TYPE_CHECKING:
    from httpx import AsyncClient

LISTINGS = ("/api/files", "/api/images", "/api/html", "/api/vault-assets")
"""The four listings a page load asks for at once (`frontend/src/lib/vault/use-listings.ts`)."""


async def test_lists_markdown_files_as_sorted_relative_paths(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# index")
    (vault / "daily").mkdir()
    (vault / "daily" / "2026-08-05.md").write_text("# today")

    response = await client.get("/api/files")

    assert response.status_code == 200
    assert response.json() == ["daily/2026-08-05.md", "index.md"]


async def test_ignores_files_that_are_not_markdown(client: AsyncClient, vault: Path) -> None:
    (vault / "note.md").write_text("# note")
    (vault / "image.png").write_bytes(b"")
    (vault / "notes.txt").write_text("plain")

    response = await client.get("/api/files")

    assert response.json() == ["note.md"]


async def test_ignores_hidden_files_and_directories(client: AsyncClient, vault: Path) -> None:
    (vault / "note.md").write_text("# note")
    (vault / ".obsidian.md").write_text("# hidden")
    (vault / ".git").mkdir()
    (vault / ".git" / "COMMIT_EDITMSG.md").write_text("# internals")

    response = await client.get("/api/files")

    assert response.json() == ["note.md"]


async def test_reports_an_empty_vault_when_the_directory_is_missing(
    client: AsyncClient, missing_vault: Path
) -> None:
    # A fresh checkout that has not created the vault yet must still serve.
    response = await client.get("/api/files")

    assert response.status_code == 200
    assert response.json() == []


async def test_lists_a_folder_named_like_a_note_as_a_folder(
    client: AsyncClient, vault: Path
) -> None:
    # `resolve_note` refuses a directory, so listing one was a row in the tree
    # that answered 404 when you opened it. What is inside it still lists.
    (vault / "archive.md").mkdir()
    (vault / "archive.md" / "note.md").write_text("# note")

    response = await client.get("/api/files")

    assert response.json() == ["archive.md/note.md"]


async def test_does_not_walk_into_a_symlinked_folder(client: AsyncClient, vault: Path) -> None:
    # A link pointing at an ancestor would otherwise walk forever, and one
    # pointing out of the vault would list what the reads refuse to open.
    (vault / "real").mkdir()
    (vault / "real" / "note.md").write_text("# note")
    (vault / "loop").symlink_to(vault)

    response = await client.get("/api/files")

    assert response.json() == ["real/note.md"]


def _odd_vault(vault: Path) -> None:
    for path in ("a.md", "X.MD", "b/c.md", "b/p.PNG", "b/r.html", "b/S.HTML", "d.pdf", "e.mp3"):
        (vault / path).parent.mkdir(exist_ok=True)
        (vault / path).write_bytes(b"")
    (vault / "folder.md").mkdir()
    (vault / "folder.md" / "in.md").write_text("")
    (vault / ".jj").mkdir()
    (vault / ".jj" / "hidden.md").write_text("")
    (vault / "linked").symlink_to(vault / "b")


def test_one_walk_finds_what_the_four_listings_find(vault: Path) -> None:
    _odd_vault(vault)

    assert scan(vault) == (
        list_markdown_files(vault),
        list_images(vault),
        list_html(vault),
        list_assets(vault),
    )
    assert scan(vault).notes == ["a.md", "b/c.md", "folder.md/in.md"]


def _scandir_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, int]]:
    calls: list[tuple[str, int]] = []
    real = os.scandir

    def recorded(path: str) -> object:
        calls.append((str(path), threading.get_ident()))
        return real(path)

    monkeypatch.setattr(os, "scandir", recorded)
    return calls


@pytest.mark.parametrize("url", LISTINGS)
async def test_a_listing_walks_the_vault_off_the_event_loop(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    (vault / "note.md").write_text("")
    calls = _scandir_calls(monkeypatch)

    assert (await client.get(url)).status_code == 200

    assert calls
    assert all(thread != threading.get_ident() for _, thread in calls)


async def test_a_page_load_walks_the_vault_once(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _odd_vault(vault)
    calls = _scandir_calls(monkeypatch)
    # Wide, so a loaded CI runner still lands all four inside it: the test is of the sharing.
    monkeypatch.setattr(listing, "BATCH_SECONDS", 1.0)

    responses = await asyncio.gather(*(client.get(url) for url in LISTINGS))

    assert [path for path, _ in calls].count(str(vault)) == 1
    assert [response.json() for response in responses] == list(scan(vault))


async def test_a_listing_after_a_write_sees_it(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    walked, release = threading.Event(), threading.Event()

    def held(root: Path) -> Listings:
        found = scan(root)
        walked.set()
        release.wait(5)
        return found

    monkeypatch.setattr(listing, "scan", held)
    first = asyncio.ensure_future(client.get("/api/files"))
    await asyncio.to_thread(walked.wait, 5)
    (vault / "new.md").write_text("")
    later = asyncio.ensure_future(client.get("/api/files"))
    await asyncio.sleep(listing.BATCH_SECONDS * 2)
    release.set()

    assert (await first).json() == []
    assert (await later).json() == ["new.md"]


async def test_a_walk_that_fails_fails_its_batch_and_the_next_walks_again(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (vault / "note.md").write_text("")
    real = os.scandir
    failures = [OSError("disk gone")]

    def flaky(path: str) -> object:
        if failures:
            raise failures.pop()
        return real(path)

    monkeypatch.setattr(os, "scandir", flaky)

    with pytest.raises(OSError, match="disk gone"):
        await asyncio.gather(*(client.get(url) for url in LISTINGS))

    assert (await client.get("/api/files")).json() == ["note.md"]


async def test_reading_a_note_or_a_page_runs_off_the_event_loop(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (vault / "note.md").write_text("# note")
    (vault / "page.html").write_text("<p>page</p>")
    threads: list[int] = []

    def on_thread(real: object) -> object:
        def recorded(*args: object) -> object:
            threads.append(threading.get_ident())
            return real(*args)  # ty: ignore[call-non-callable]

        return recorded

    monkeypatch.setattr(notes, "read_note", on_thread(notes.read_note))
    monkeypatch.setattr(listing, "resolve_html", on_thread(listing.resolve_html))
    monkeypatch.setattr(listing, "serve_page", on_thread(listing.serve_page))

    assert (await client.get("/api/files/note.md")).status_code == 200
    assert (await client.get("/api/html/page.html")).status_code == 200
    assert (await client.get("/api/files/gone.md")).status_code == 404
    assert (await client.get("/api/html/gone.html")).status_code == 404

    assert len(threads) == 5
    assert threading.get_ident() not in threads


async def test_listing_terminals_runs_off_the_event_loop(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "herdr" / "work").mkdir(parents=True)
    app.dependency_overrides[get_settings] = lambda: Settings(
        herdr_sessions_path=tmp_path / "herdr"
    )
    threads: list[int] = []
    real = Path.iterdir

    def recorded(self: Path) -> object:
        threads.append(threading.get_ident())
        return real(self)

    monkeypatch.setattr(Path, "iterdir", recorded)
    try:
        assert (await client.get("/api/terminals")).json() == ["work"]
    finally:
        app.dependency_overrides.clear()

    assert threads
    assert threading.get_ident() not in threads
