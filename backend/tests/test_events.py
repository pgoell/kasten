"""What the vault reports when something writes it.

Two rules run through these. An event that names a note names one `GET
/api/files` would show, and anything else the vault holds is reported once, as
a request for a fresh file listing. Both stop at the hidden rule: the vault
carries its own jj repo, every backend write touches it, and neither kind of
event may carry that back to the editor that caused it.
"""

import asyncio
import hashlib
import json
import socket
from contextlib import suppress
from itertools import count
from typing import TYPE_CHECKING

import pytest
import uvicorn
from httpx import AsyncClient, RemoteProtocolError, TimeoutException
from watchfiles import Change

from kasten_backend import main
from kasten_backend.events import VaultEvent, format_retry, format_sse, is_watchable, to_events
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

LISTING = VaultEvent(path="", change="listing", digest=None)
"""The one event that names no note: read the file list again."""

RETRY = "retry: 30000\n\n"
"""What every stream says first: wait this long before opening it again."""


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

    # A graceful shutdown waits on open connections forever by default, and a
    # stream is a connection that has no reason to close. One second is the
    # difference between a slow test and a CI job that never finishes.
    serving = uvicorn.Server(uvicorn.Config(app, log_level="warning", timeout_graceful_shutdown=1))
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


async def first_comment(response: Response) -> str:
    async for line in response.aiter_lines():
        if line.startswith(":"):
            return line

    raise AssertionError("the stream ended without a word")


async def drain(response: Response) -> list[str]:
    """Every line the stream writes before it ends, however it ends.

    A watcher that raised takes the connection down with it rather than closing
    it politely, and httpx says so. Either way the stream is over, which is the
    thing being asked about here.
    """
    lines = []
    with suppress(RemoteProtocolError):
        async for line in response.aiter_lines():
            lines.append(line)

    return lines


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


def test_watchable_skips_a_path_outside_the_vault(tmp_path: Path) -> None:
    assert not is_watchable(tmp_path / "vault", str(tmp_path / "elsewhere" / "kasten.md"))


def test_to_events_reports_a_note_on_disk_as_written(tmp_path: Path) -> None:
    # An add reads as a write, and has to: a save renames a temp file over the
    # note, Linux calls that a move into place, and watchfiles calls it added.
    # A note kasten has held for weeks arrives here as `Change.added`.
    text = "derived index\n"
    note = write(tmp_path, "kasten.md", text)

    assert to_events(tmp_path, {(Change.added, str(note))}) == [
        VaultEvent(
            path="kasten.md",
            change="written",
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


def test_to_events_names_no_note_for_a_folder_whose_name_ends_in_md(tmp_path: Path) -> None:
    # A folder fires changes of its own, and reading one as a note raises. One
    # of those on the stream ends it for the client that was listening. It is
    # still a change to the shape of the vault, so the listing is asked for.
    folder = tmp_path / "notes.md"
    folder.mkdir()

    assert to_events(tmp_path, {(Change.added, str(folder))}) == [LISTING]


def test_to_events_says_nothing_about_a_path_outside_the_vault(tmp_path: Path) -> None:
    # `relative_to` raises on a path from outside, and an exception raised in
    # here ends the stream for whoever was listening to it.
    outsider = write(tmp_path, "elsewhere.md", "derived index\n")

    assert to_events(tmp_path / "vault", {(Change.modified, str(outsider))}) == []


def test_to_events_says_nothing_about_the_jj_repo(tmp_path: Path) -> None:
    blob = write(tmp_path, ".jj/repo/store/blob.md", "derived index\n")

    assert to_events(tmp_path, {(Change.modified, str(blob))}) == []


def test_to_events_asks_for_no_listing_for_the_jj_repo(tmp_path: Path) -> None:
    # The one that would undo the hidden rule. jj writes files that are not
    # notes on every save the API makes, and a listing event for each of those
    # is the same storm the filter exists to stop, one indirection along.
    blob = write(tmp_path, ".jj/repo/store/blob", "not a note\n")

    assert to_events(tmp_path, {(Change.added, str(blob))}) == []


def test_to_events_reads_a_note_that_vanished_as_a_removal(tmp_path: Path) -> None:
    # The first half of a move: the change fires for a path that is already gone
    # by the time this reads it, which is a removal rather than an error.
    assert to_events(tmp_path, {(Change.added, str(tmp_path / "kasten.md"))}) == [
        VaultEvent(path="kasten.md", change="removed", digest=None)
    ]


def test_to_events_reports_every_note_a_batch_names(tmp_path: Path) -> None:
    borges = write(tmp_path, "borges.md", "the garden of forking paths\n")
    kasten = write(tmp_path, "projects/kasten.md", "derived index\n")

    events = to_events(tmp_path, {(Change.added, str(borges)), (Change.modified, str(kasten))})

    assert [(event.path, event.change) for event in events] == [
        ("borges.md", "written"),
        ("projects/kasten.md", "written"),
    ]


def test_to_events_orders_a_batch_the_same_way_every_time(tmp_path: Path) -> None:
    # A set carries no order of its own, and the order it happens to iterate in
    # varies between runs. Two clients reading one batch have to be told the
    # same story in the same order.
    notes = [write(tmp_path, f"note-{number}.md", "derived index\n") for number in range(8)]

    events = to_events(tmp_path, {(Change.modified, str(note)) for note in notes})

    assert [event.path for event in events] == sorted(note.name for note in notes)


def test_to_events_reports_a_note_once_however_often_it_changed(tmp_path: Path) -> None:
    # A note made and then written inside the same window fires twice. It is one
    # note and one thing to tell the client about, and the digest is read once
    # off the disk either way.
    text = "derived index\n"
    note = write(tmp_path, "kasten.md", text)

    events = to_events(tmp_path, {(Change.added, str(note)), (Change.modified, str(note))})

    assert events == [
        VaultEvent(
            path="kasten.md",
            change="written",
            digest=hashlib.sha256(text.encode()).hexdigest(),
        )
    ]


def test_to_events_does_not_call_a_note_gone_that_was_written_back(tmp_path: Path) -> None:
    # A save through a temp file fires a delete and an add for one path inside
    # one window. Reported separately, whichever the set handed over last would
    # decide, and "removed" would take a note that is on disk out of the tree.
    note = write(tmp_path, "kasten.md", "derived index\n")

    events = to_events(tmp_path, {(Change.deleted, str(note)), (Change.added, str(note))})

    assert [(event.path, event.change) for event in events] == [("kasten.md", "written")]


def test_to_events_reads_a_note_it_cannot_open_as_a_removal(tmp_path: Path) -> None:
    # Gone and unreadable look the same from the other end of the stream, and
    # both beat an exception, which would end the stream for good and say why
    # to nobody: the response is already on its way by the time it is raised.
    note = write(tmp_path, "kasten.md", "derived index\n")
    note.chmod(0o000)

    assert to_events(tmp_path, {(Change.modified, str(note))}) == [
        VaultEvent(path="kasten.md", change="removed", digest=None)
    ]


def test_to_events_asks_for_a_listing_when_a_folder_moves(tmp_path: Path) -> None:
    # The whole reason this kind exists. `rename_folder` is one rename, so the
    # notes inside it never fire at all: inotify names the folder and nothing
    # else. Without this the client keeps a row pointing at a note that moved.
    write(tmp_path, "projects/kasten.md", "derived index\n")
    (tmp_path / "projects").rename(tmp_path / "done")

    assert to_events(tmp_path, {(Change.added, str(tmp_path / "done"))}) == [LISTING]


def test_to_events_asks_for_one_listing_however_much_moved(tmp_path: Path) -> None:
    # An agent reorganising the vault moves many folders inside one window, and
    # the client has one file list to read whatever happened to it.
    folders = [tmp_path / f"folder-{number}" for number in range(4)]
    for folder in folders:
        folder.mkdir()

    events = to_events(tmp_path, {(Change.added, str(folder)) for folder in folders})

    assert events == [LISTING]


def test_to_events_asks_for_no_listing_when_only_notes_changed(tmp_path: Path) -> None:
    note = write(tmp_path, "kasten.md", "derived index\n")

    assert LISTING not in to_events(tmp_path, {(Change.modified, str(note))})


def test_to_events_puts_the_listing_before_the_notes(tmp_path: Path) -> None:
    note = write(tmp_path, "kasten.md", "derived index\n")
    (tmp_path / "projects").mkdir()

    events = to_events(
        tmp_path, {(Change.modified, str(note)), (Change.added, str(tmp_path / "projects"))}
    )

    assert events[0] == LISTING


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


def test_format_retry_writes_the_delay_in_milliseconds() -> None:
    # Seconds everywhere else in the route, milliseconds on the wire, and this
    # is the one place that knows the difference.
    assert format_retry(30.0) == RETRY


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
            # Awaited rather than dropped, so a writer that fell over says so
            # itself instead of turning up as a watcher that never fired.
            with suppress(asyncio.CancelledError):
                await writer

    assert str(event["path"]).startswith("kasten-")
    assert event["change"] == "written"
    assert event["digest"] == hashlib.sha256(text.encode()).hexdigest()


async def test_stream_names_its_reconnect_delay_first(server: str, vault: Path) -> None:
    # The client reads the whole file listing every time this stream opens, so
    # a stream that closes at once costs a relist every three seconds, which is
    # what the browser waits by default. Sent before anything else, because the
    # streams that need it are the ones with no second line to put it on.
    async with (
        AsyncClient(base_url=server, timeout=PATIENCE) as http,
        http.stream("GET", "/api/events") as response,
    ):
        try:
            line = await asyncio.wait_for(anext(response.aiter_lines()), PATIENCE)
        except TimeoutError, TimeoutException:
            pytest.fail(f"the stream said nothing at all in {PATIENCE} seconds")

    assert line == RETRY.rstrip("\n")


async def test_stream_keeps_a_quiet_connection_alive(
    server: str, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Nothing writes to this vault, so without the keepalive the socket carries
    # no bytes at all and neither proxy in front of it can tell the connection
    # from a dead one. The colon line is a comment the wire format defines and
    # `EventSource` throws away.
    monkeypatch.setattr(main, "KEEPALIVE_SECONDS", 0.2)

    async with (
        AsyncClient(base_url=server, timeout=PATIENCE) as http,
        http.stream("GET", "/api/events") as response,
    ):
        try:
            line = await asyncio.wait_for(first_comment(response), PATIENCE)
        except TimeoutError, TimeoutException:
            pytest.fail(f"the stream said nothing at all in {PATIENCE} seconds")

    assert line.startswith(":")


async def test_stream_ends_when_the_watcher_falls_over(
    server: str, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The failure that hides. A watcher that raises leaves a connection writing
    # keepalives at a client it will never tell anything again, and that reads
    # healthier than a closed one: `EventSource` reconnects from closed and
    # cannot reconnect from this. An inotify limit already spent on some other
    # tree watching this box is enough to get there.
    def fall_over(root: Path) -> AsyncIterator[list[VaultEvent]]:
        raise OSError("no watches left")

    monkeypatch.setattr(main, "watch_vault", fall_over)
    monkeypatch.setattr(main, "KEEPALIVE_SECONDS", 0.2)

    async with (
        AsyncClient(base_url=server, timeout=PATIENCE) as http,
        http.stream("GET", "/api/events") as response,
    ):
        try:
            lines = await asyncio.wait_for(drain(response), PATIENCE)
        except TimeoutError, TimeoutException:
            pytest.fail(f"the stream was still open {PATIENCE} seconds after the watcher died")

    # The reconnect delay and nothing after it: this is the other half of why
    # the delay is sent, and a keepalive here would mean the stream had stayed
    # open over a watcher that is no longer watching anything.
    assert lines == RETRY.splitlines()


async def test_stream_ends_at_once_for_a_vault_that_is_not_there(
    server: str, missing_vault: Path
) -> None:
    # A fresh checkout with no vault yet must not take the endpoint down with
    # it. There is nothing to watch, so the answer closes rather than waits,
    # and the one line it carries is the one that stops the client coming
    # straight back: this is half of why the delay is sent at all.
    async with AsyncClient(base_url=server, timeout=PATIENCE) as http:
        response = await http.get("/api/events")

    assert response.status_code == 200
    assert response.text == RETRY
