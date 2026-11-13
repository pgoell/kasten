"""What the vault reports for a batch that names a folder: made, moved in, or holding notes.

inotify names a new or moved-in folder and nothing inside it, so the notes there are found by
a walk, not by the watcher (#2005).
"""

import asyncio
import hashlib
from itertools import count
from typing import TYPE_CHECKING

from watchfiles import Change

from kasten_backend.events import VaultEvent, to_events, watch_vault

if TYPE_CHECKING:
    from pathlib import Path

LISTING = VaultEvent(path="", change="listing", digest=None)


def write(root: Path, path: str, text: str = "derived index\n") -> Path:
    note = root / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")
    return note


def told(events: list[VaultEvent]) -> list[tuple[str, str]]:
    return [(event.path, event.change) for event in events]


def test_to_events_names_the_notes_in_a_folder_made_before_its_watch(tmp_path: Path) -> None:
    # `create_note` makes the folders and writes into them before the watcher can watch them.
    write(tmp_path, "01 Periodic/index.md")

    events = to_events(tmp_path, {(Change.added, str(tmp_path / "01 Periodic"))})

    assert told(events) == [("", "listing"), ("01 Periodic/index.md", "written")]


def test_to_events_names_the_notes_two_folders_down(tmp_path: Path) -> None:
    write(tmp_path, "01 Periodic/index.md")
    write(tmp_path, "01 Periodic/00 Daily/index.md")
    write(tmp_path, "01 Periodic/00 Daily/2026-11-13.md")

    events = to_events(tmp_path, {(Change.added, str(tmp_path / "01 Periodic"))})

    assert told(events) == [
        ("", "listing"),
        ("01 Periodic/00 Daily/2026-11-13.md", "written"),
        ("01 Periodic/00 Daily/index.md", "written"),
        ("01 Periodic/index.md", "written"),
    ]


def test_to_events_walks_no_hidden_folder_inside_a_new_folder(tmp_path: Path) -> None:
    write(tmp_path, "projects/.jj/store.md")
    write(tmp_path, "projects/.draft.md")
    write(tmp_path, "projects/plan.txt")

    assert to_events(tmp_path, {(Change.added, str(tmp_path / "projects"))}) == [LISTING]


def test_to_events_walks_no_hidden_folder_made(tmp_path: Path) -> None:
    write(tmp_path, ".jj/op/store.md")

    assert to_events(tmp_path, {(Change.added, str(tmp_path / ".jj/op"))}) == []


def test_to_events_names_a_page_inside_a_new_folder(tmp_path: Path) -> None:
    text = "<h1>report</h1>\n"
    write(tmp_path, "reports/report.html", text)

    assert to_events(tmp_path, {(Change.added, str(tmp_path / "reports"))}) == [
        LISTING,
        VaultEvent(
            path="reports/report.html",
            change="page",
            digest=hashlib.sha256(text.encode()).hexdigest(),
        ),
    ]


def test_to_events_walks_no_folder_that_was_only_modified(tmp_path: Path) -> None:
    # A chmod or a new file names the folder as modified: what changed inside fires on its own.
    write(tmp_path, "projects/kasten.md")

    events = to_events(tmp_path, {(Change.modified, str(tmp_path / "projects"))})

    assert events == [LISTING]


def test_to_events_names_the_notes_a_moved_folder_carries(tmp_path: Path) -> None:
    # `rename_folder` is one rename: the listing drops the old rows, the walk names the new ones.
    write(tmp_path, "projects/kasten.md")
    (tmp_path / "projects").rename(tmp_path / "done")

    events = to_events(tmp_path, {(Change.added, str(tmp_path / "done"))})

    assert told(events) == [("", "listing"), ("done/kasten.md", "written")]


def test_to_events_asks_for_one_listing_however_much_moved(tmp_path: Path) -> None:
    # An agent reorganising the vault moves many folders inside one window, and
    # the client has one file list to read whatever happened to it.
    folders = [tmp_path / f"folder-{number}" for number in range(4)]
    for folder in folders:
        folder.mkdir()

    events = to_events(tmp_path, {(Change.added, str(folder)) for folder in folders})

    assert events == [LISTING]


async def test_watch_vault_names_the_note_in_a_folder_moved_in(tmp_path: Path) -> None:
    # Moved in whole, the note fires nothing on its own. A new folder each try, since the
    # first may land before the watcher is up and nothing says when it is.
    vault = tmp_path / "vault"
    vault.mkdir()
    heard: list[tuple[str, str]] = []

    async def move_in() -> None:
        for attempt in count():
            write(tmp_path, f"outside-{attempt}/note.md")
            (tmp_path / f"outside-{attempt}").rename(vault / f"moved-{attempt}")
            await asyncio.sleep(0.5)

    mover = asyncio.create_task(move_in())
    try:
        async with asyncio.timeout(10):
            async for events in watch_vault(vault):
                heard = told(events)
                if ("", "listing") in heard:
                    break
    finally:
        mover.cancel()

    written = [path for path, change in heard if change == "written"]
    assert written != []
    assert all(path.startswith("moved-") and path.endswith("/note.md") for path in written)
