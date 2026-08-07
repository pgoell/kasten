"""What the vault reports when something outside kasten writes it.

The rule here is the listing's rule: an event names a note `GET /api/files`
would show, and nothing else. The vault carries its own jj repo, and every
backend write touches it, so without that rule each save would report its own
bookkeeping back to the editor that caused it.
"""

import asyncio
import hashlib
import json
import socket
from itertools import count
from typing import TYPE_CHECKING

import pytest
import uvicorn
from httpx import AsyncClient, TimeoutException
from watchfiles import Change

from kasten_backend.events import VaultEvent, format_sse, is_watchable, to_events
from kasten_backend.main import app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

    from httpx import Response

PATIENCE = 10.0
"""Seconds to wait for an event before calling the stream broken.

Far above the debounce and the write, and there to fail rather than hang: a
watcher that never fires would otherwise stop the suite dead.
"""


def write(root: Path, path: str, text: str) -> Path:
    note = root / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")
    return note


@pytest.fixture
async def server() -> AsyncIterator[str]:
    """Serve the app on a real socket and hand back its base URL.

    The `client` fixture in conftest cannot reach this endpoint: httpx's ASGI
    transport runs the app to completion before it answers, and a stream that
    stays open never completes. So this one needs a socket under it.

    The socket is bound and listening before uvicorn starts, so a connection
    made straight away waits in the backlog rather than being refused.
    """
    listening = socket.socket()
    listening.bind(("127.0.0.1", 0))
    listening.listen()
    port = listening.getsockname()[1]

    serving = uvicorn.Server(uvicorn.Config(app, log_level="warning"))
    task = asyncio.create_task(serving.serve(sockets=[listening]))

    yield f"http://127.0.0.1:{port}"

    serving.should_exit = True
    await task


async def keep_adding_notes(vault: Path, text: str) -> None:
    """Write a new note over and over until the test has seen one arrive.

    Once would be a race. Nothing the client can see says the watcher is up, so
    the first note may land before it is listening, and a new path each time
    keeps every attempt an addition rather than an edit of the last one.
    """
    for attempt in count():
        write(vault, f"kasten-{attempt}.md", text)
        await asyncio.sleep(0.5)


async def first_event(response: Response) -> dict[str, object]:
    async for line in response.aiter_lines():
        if line.startswith("data: "):
            return json.loads(line.removeprefix("data: "))

    raise AssertionError("the stream ended without reporting anything")


def test_watchable_note_under_the_vault_root(tmp_path: Path) -> None:
    assert is_watchable(tmp_path, str(tmp_path / "kasten.md"))


def test_watchable_note_inside_a_folder(tmp_path: Path) -> None:
    assert is_watchable(tmp_path, str(tmp_path / "projects" / "kasten.md"))


def test_watchable_skips_the_vaults_own_jj_repo(tmp_path: Path) -> None:
    # The one that matters. jj rewrites its store on every backend write, and
    # each of those files would otherwise be an event of its own.
    assert not is_watchable(tmp_path, str(tmp_path / ".jj" / "repo" / "store" / "blob.md"))


def test_watchable_skips_any_other_hidden_directory(tmp_path: Path) -> None:
    assert not is_watchable(tmp_path, str(tmp_path / ".git" / "MERGE_MSG.md"))


def test_watchable_skips_a_file_that_is_not_markdown(tmp_path: Path) -> None:
    assert not is_watchable(tmp_path, str(tmp_path / "notes.txt"))


def test_watchable_skips_a_folder_whose_name_ends_in_md(tmp_path: Path) -> None:
    # The tree learned this one already: a folder called `notes.md` is a folder,
    # and reading it as a note is what `resolve_note` refuses.
    (tmp_path / "notes.md").mkdir()

    assert not is_watchable(tmp_path, str(tmp_path / "notes.md"))


def test_to_events_reports_a_new_note_with_its_digest(tmp_path: Path) -> None:
    text = "derived index\n"
    note = write(tmp_path, "kasten.md", text)

    assert to_events(tmp_path, {(Change.added, str(note))}) == [
        VaultEvent(
            path="kasten.md",
            change="added",
            digest=hashlib.sha256(text.encode()).hexdigest(),
        )
    ]


def test_to_events_reports_an_edit_as_written(tmp_path: Path) -> None:
    note = write(tmp_path, "kasten.md", "derived index\n")

    assert to_events(tmp_path, {(Change.modified, str(note))})[0].change == "written"


def test_to_events_reports_a_deletion_without_a_digest(tmp_path: Path) -> None:
    assert to_events(tmp_path, {(Change.deleted, str(tmp_path / "kasten.md"))}) == [
        VaultEvent(path="kasten.md", change="removed", digest=None)
    ]


def test_to_events_spells_the_path_the_way_the_listing_does(tmp_path: Path) -> None:
    note = write(tmp_path, "projects/kasten.md", "derived index\n")

    assert to_events(tmp_path, {(Change.modified, str(note))})[0].path == "projects/kasten.md"


def test_to_events_says_nothing_about_a_folder_whose_name_ends_in_md(tmp_path: Path) -> None:
    # A folder fires changes of its own, and reading one as a note raises. One
    # of those on the stream ends it for the client that was listening.
    folder = tmp_path / "notes.md"
    folder.mkdir()

    assert to_events(tmp_path, {(Change.added, str(folder))}) == []


def test_to_events_says_nothing_about_the_jj_repo(tmp_path: Path) -> None:
    blob = write(tmp_path, ".jj/repo/store/blob.md", "derived index\n")

    assert to_events(tmp_path, {(Change.modified, str(blob))}) == []


def test_to_events_reads_a_note_that_vanished_as_a_removal(tmp_path: Path) -> None:
    # The first half of a move: the change fires for a path that is already gone
    # by the time this reads it, which is a removal rather than an error.
    assert to_events(tmp_path, {(Change.added, str(tmp_path / "kasten.md"))}) == [
        VaultEvent(path="kasten.md", change="removed", digest=None)
    ]


def test_format_sse_writes_one_data_line_holding_the_whole_event() -> None:
    line = format_sse(VaultEvent(path="projects/kasten.md", change="written", digest="abc123"))

    assert line.startswith("data: ")
    assert line.endswith("\n\n")
    assert json.loads(line.removeprefix("data: ")) == {
        "path": "projects/kasten.md",
        "change": "written",
        "digest": "abc123",
    }


def test_format_sse_writes_null_for_a_removal() -> None:
    line = format_sse(VaultEvent(path="kasten.md", change="removed", digest=None))

    assert json.loads(line.removeprefix("data: "))["digest"] is None


async def test_stream_reports_a_note_written_into_the_vault(server: str, vault: Path) -> None:
    text = "derived index\n"

    async with (
        AsyncClient(base_url=server, timeout=PATIENCE) as http,
        http.stream("GET", "/api/events") as response,
    ):
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        writer = asyncio.create_task(keep_adding_notes(vault, text))
        try:
            event = await asyncio.wait_for(first_event(response), PATIENCE)
        # Whichever clock runs out first, a watcher that never fires has to say
        # so. A bare TimeoutError points at asyncio's innards and names nothing.
        except TimeoutError, TimeoutException:
            pytest.fail(f"the vault reported nothing in {PATIENCE} seconds")
        finally:
            writer.cancel()

    assert str(event["path"]).startswith("kasten-")
    assert event["change"] == "added"
    assert event["digest"] == hashlib.sha256(text.encode()).hexdigest()


async def test_stream_holds_open_for_a_vault_that_is_not_there(
    server: str, missing_vault: Path
) -> None:
    # A fresh checkout with no vault yet must not take the endpoint down with it.
    async with AsyncClient(base_url=server, timeout=PATIENCE) as http:
        response = await http.get("/api/events")

    assert response.status_code == 200
    assert response.text == ""
