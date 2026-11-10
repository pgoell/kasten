"""What the write lock is for: two writers, and neither one's edit in the other's change."""

import asyncio
import fcntl
import signal
import subprocess
import sys
from typing import TYPE_CHECKING

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from backend.tests.anki_build import apkg
from backend.tests.conftest import JJ, changed_paths, descriptions, jj
from kasten_backend import change, vcs
from kasten_backend.change import vault_change, vault_write
from kasten_backend.config import get_settings
from kasten_backend.main import app

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

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
        # The folder the import made, listed in the same change.
        "03 Flashcards/index.md",
    ]


async def test_a_published_image_is_in_the_log(client: AsyncClient, versioned_vault: Path) -> None:
    # An image rather than a book, because `vcs.IGNORES` keeps an epub out of
    # the history on purpose and its change would be empty either way.
    response = await client.post("/api/assets/pictures/plate.png", content=PNG)

    assert response.status_code == 201
    assert descriptions(versioned_vault) == ["vault: pictures/plate.png"]
    assert changed_paths(versioned_vault, "@") == ["pictures/plate.png"]


async def test_an_agent_write_is_named_in_the_log(
    client: AsyncClient, versioned_agent_vault: Path, bearer: dict[str, str]
) -> None:
    # The second half is what proves `require_token` resets its contextvar. A
    # leak there would label the browser save an agent write, with every test
    # of the agent surface still green.
    await client.put("/agent/notes/borges.md", json={"content": "# from the agent"}, headers=bearer)

    await client.put("/api/files/borges.md", json={"content": "# from the browser"})

    assert descriptions(versioned_agent_vault) == [
        "vault: borges.md",
        "agent(laptop): borges.md",
    ]


def saved_texts(vault: Path, path: str) -> set[str]:
    """Every text of one note that some operation in `jj op log` recorded."""
    # `--ignore-working-copy`, or this read would take the snapshot the test asks about.
    ops = jj(vault, "--ignore-working-copy", "op", "log", "--no-graph", "-T", 'id ++ "\\n"')
    ops = ops.split()
    texts = set()
    for op in ops:
        shown = subprocess.run(  # noqa: S603
            [
                JJ or "jj",
                "--repository",
                str(vault),
                "--ignore-working-copy",
                "--at-op",
                op,
                "file",
                "show",
                "-r",
                "@",
                f"root:{path}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if shown.returncode == 0:
            # The body alone: a save stamps frontmatter onto the note.
            texts.add(shown.stdout.rsplit("---\n", 1)[-1])
    return texts


@pytest.fixture
def parked(monkeypatch: pytest.MonkeyPatch) -> Iterator[asyncio.Event]:
    """Hold every snapshot until the test sets the event it hands back."""
    release = asyncio.Event()
    real = change.snapshot

    async def parking(root: Path) -> None:
        await release.wait()
        await real(root)

    monkeypatch.setattr(change, "snapshot", parking)
    yield release
    # Set on the way out too, so a failed test does not hang the app's shutdown.
    release.set()


async def test_1827_a_save_answers_before_its_snapshot(
    client: AsyncClient, versioned_vault: Path, parked: asyncio.Event
) -> None:
    (versioned_vault / "a.md").write_text("# a")

    answer = await asyncio.wait_for(client.put("/api/files/a.md", json={"content": "# new"}), 2.0)

    assert answer.status_code == 200
    assert (versioned_vault / "a.md").read_text().endswith("---\n# new")
    parked.set()
    await change.settled()
    assert "# new" in saved_texts(versioned_vault, "a.md")


async def test_1827_the_next_write_waits_for_the_snapshot(
    client: AsyncClient, versioned_vault: Path, parked: asyncio.Event
) -> None:
    (versioned_vault / "a.md").write_text("# a")
    await asyncio.wait_for(client.put("/api/files/a.md", json={"content": "# first"}), 2.0)

    second = asyncio.create_task(client.put("/api/files/a.md", json={"content": "# second"}))
    await asyncio.wait({second}, timeout=0.5)

    assert not second.done()
    assert (versioned_vault / "a.md").read_text().endswith("---\n# first")
    parked.set()
    assert (await second).status_code == 200
    await change.settled()
    assert {"# first", "# second"} <= saved_texts(versioned_vault, "a.md")


async def test_1827_back_to_back_saves_each_land_in_the_op_log(
    client: AsyncClient, versioned_vault: Path
) -> None:
    (versioned_vault / "a.md").write_text("# a")

    for text in ("# one", "# two", "# three"):
        assert (await client.put("/api/files/a.md", json={"content": text})).status_code == 200
    await change.settled()

    assert {"# one", "# two", "# three"} <= saved_texts(versioned_vault, "a.md")
    assert descriptions(versioned_vault) == ["vault: a.md"]


async def test_1827_two_racing_saves_of_one_note_both_land(
    client: AsyncClient, versioned_vault: Path
) -> None:
    (versioned_vault / "a.md").write_text("# a")

    answers = await asyncio.gather(
        client.put("/api/files/a.md", json={"content": "# left"}),
        client.put("/api/files/a.md", json={"content": "# right"}),
    )
    await change.settled()

    assert [answer.status_code for answer in answers] == [200, 200]
    assert {"# left", "# right"} <= saved_texts(versioned_vault, "a.md")
    on_disk = (versioned_vault / "a.md").read_text()
    assert jj(versioned_vault, "--ignore-working-copy", "file", "show", "root:a.md") == on_disk


async def test_1827_a_lost_snapshot_is_taken_up_by_the_next(
    client: AsyncClient, versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A no-op snapshot is the backend stopped after the answer: the task never ran.
    (versioned_vault / "a.md").write_text("# a")
    (versioned_vault / "b.md").write_text("# b")
    real = change.snapshot

    async def lost(_root: Path) -> None:
        return None

    monkeypatch.setattr(change, "snapshot", lost)
    await client.put("/api/files/a.md", json={"content": "# answered"})
    monkeypatch.setattr(change, "snapshot", real)

    await client.put("/api/files/b.md", json={"content": "# b"})
    await change.settled()

    assert changed_paths(versioned_vault, 'description(substring:"vault: a.md")') == ["a.md"]
    shown = jj(versioned_vault, "--ignore-working-copy", "file", "show", "-r", "@-", "root:a.md")
    assert shown.endswith("---\n# answered")


async def test_1827_a_snapshot_that_raises_logs_frees_the_lock_and_keeps_the_file(
    client: AsyncClient,
    versioned_vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    (versioned_vault / "a.md").write_text("# a")

    async def broken(_root: Path) -> None:
        raise RuntimeError("jj went away")

    monkeypatch.setattr(change, "snapshot", broken)
    await client.put("/api/files/a.md", json={"content": "# kept"})
    await change.settled()
    monkeypatch.setattr(change, "snapshot", vcs.snapshot)

    assert (versioned_vault / "a.md").read_text().endswith("---\n# kept")
    assert "jj snapshot failed" in caplog.text
    after = await asyncio.wait_for(client.put("/api/files/a.md", json={"content": "# on"}), 5.0)
    assert after.status_code == 200
    await change.settled()
    assert {"# kept", "# on"} <= saved_texts(versioned_vault, "a.md")
    assert lock_is_free()


async def test_1827_history_right_after_a_save_shows_it(
    client: AsyncClient, versioned_vault: Path, parked: asyncio.Event
) -> None:
    # Released for the create, so only the timed save below is parked under the read.
    parked.set()
    await client.post("/api/files/a.md")
    await change.settled()
    parked.clear()
    await asyncio.wait_for(client.put("/api/files/a.md", json={"content": "# fresh\n"}), 2.0)

    listing = asyncio.create_task(client.get("/api/history", params={"path": "a.md"}))
    await asyncio.wait({listing}, timeout=0.5)
    assert not listing.done()
    parked.set()
    commit = (await listing).json()["changes"][0]["commit"]
    version = await client.get("/api/history/version", params={"path": "a.md", "commit": commit})

    assert version.json()["content"].endswith("---\n# fresh\n")


async def test_1827_stopping_the_app_finishes_the_snapshot(
    versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (versioned_vault / "a.md").write_text("# a")
    real = change.snapshot

    async def slow(root: Path) -> None:
        await asyncio.sleep(0.3)
        await real(root)

    monkeypatch.setattr(change, "snapshot", slow)
    async with (
        LifespanManager(app, startup_timeout=None, shutdown_timeout=None),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http,
    ):
        await http.put("/api/files/a.md", json={"content": "# before the stop"})

    shown = jj(versioned_vault, "--ignore-working-copy", "file", "show", "-r", "@", "root:a.md")
    assert shown.endswith("---\n# before the stop")


async def test_1827_an_unversioned_vault_starts_no_snapshot(
    client: AsyncClient, vault: Path
) -> None:
    await client.put("/api/files/a.md", json={"content": "# plain"})

    assert change._snapshotting is None
    assert not change._lock.locked()


HOLD = (
    "import fcntl,sys;f=open(sys.argv[1],'a');fcntl.flock(f,fcntl.LOCK_EX);"
    "print('held',flush=True);input()"
)
"""Another process holding the vault's flock until its stdin gets a line."""

SAVES = """
import asyncio, sys
from pathlib import Path
from kasten_backend.change import settled, vault_change, vault_write
async def main():
    root, tag = Path(sys.argv[1]), sys.argv[2]
    for i in range(8):
        async with vault_write(), vault_change(root, "a.md"):
            (root / "a.md").write_text(f"# {tag}{i}")
        print(f"# {tag}{i}", flush=True)
    await settled()
asyncio.run(main())
"""
"""A second backend process saving one note eight times, printing each save it finished."""


def lock_is_free() -> bool:
    with get_settings().vault_lock.open("a") as probe:
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True


@pytest.fixture
def holder() -> Iterator[subprocess.Popen[str]]:
    lock = get_settings().vault_lock
    lock.parent.mkdir(parents=True, exist_ok=True)
    child = subprocess.Popen(  # noqa: S603
        [sys.executable, "-c", HOLD, str(lock)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    assert child.stdout is not None
    assert child.stdout.readline() == "held\n"
    yield child
    child.kill()
    child.wait(5)


async def test_1768_a_save_waits_while_another_process_holds_the_flock(
    client: AsyncClient, versioned_vault: Path, holder: subprocess.Popen[str]
) -> None:
    (versioned_vault / "a.md").write_text("# a")
    save = asyncio.create_task(client.put("/api/files/a.md", json={"content": "# mine"}))
    await asyncio.wait({save}, timeout=0.5)
    assert not save.done()
    # The flock is waited on in a thread, so the loop still answers a read meanwhile.
    assert (await asyncio.wait_for(client.get("/api/version"), 2.0)).status_code == 200

    holder.communicate("go\n", timeout=5)
    assert (await asyncio.wait_for(save, 10.0)).status_code == 200


async def test_1768_the_flock_covers_the_snapshot(
    client: AsyncClient, versioned_vault: Path, parked: asyncio.Event
) -> None:
    (versioned_vault / "a.md").write_text("# a")
    await asyncio.wait_for(client.put("/api/files/a.md", json={"content": "# a"}), 5.0)
    assert not lock_is_free()

    parked.set()
    await change.settled()
    assert lock_is_free()


async def test_1768_a_lock_left_by_a_killed_process_wedges_nothing(
    client: AsyncClient, versioned_vault: Path, holder: subprocess.Popen[str]
) -> None:
    (versioned_vault / "a.md").write_text("# a")
    holder.send_signal(signal.SIGKILL)
    assert holder.wait(5) == -signal.SIGKILL
    assert get_settings().vault_lock.exists()

    answer = await asyncio.wait_for(client.put("/api/files/a.md", json={"content": "# a"}), 5.0)
    assert answer.status_code == 200


async def test_1768_a_missing_lock_folder_is_made(
    client: AsyncClient, versioned_vault: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (versioned_vault / "a.md").write_text("# a")
    monkeypatch.setenv("KASTEN_TOKENS_PATH", str(tmp_path / "gone" / "deeper" / "tokens.json"))
    get_settings.cache_clear()

    answer = await asyncio.wait_for(client.put("/api/files/a.md", json={"content": "# a"}), 5.0)

    assert answer.status_code == 200
    assert (tmp_path / "gone" / "deeper" / "vault.lock").is_file()


async def test_1768_a_cancelled_wait_or_a_raising_write_leaves_no_lock_held(
    versioned_vault: Path, holder: subprocess.Popen[str]
) -> None:
    async def write() -> None:
        async with vault_write():
            pass

    waiting = asyncio.create_task(write())
    await asyncio.wait({waiting}, timeout=0.3)
    assert not waiting.done()
    waiting.cancel()
    holder.communicate("go\n", timeout=5)
    with pytest.raises(asyncio.CancelledError):
        await waiting

    # This write's flock waits on the cancelled thread's, which only its done callback closes.
    with pytest.raises(ValueError, match="mid-write"):
        async with asyncio.timeout(5), vault_write():
            raise ValueError("mid-write")
    assert lock_is_free()
    assert not change._lock.locked()


def test_1768_two_processes_saving_one_note_lose_no_save(versioned_vault: Path) -> None:
    (versioned_vault / "a.md").write_text("# a")
    children = [
        subprocess.Popen(  # noqa: S603
            [sys.executable, "-c", SAVES, str(versioned_vault), tag],
            stdout=subprocess.PIPE,
            text=True,
        )
        for tag in ("left", "right")
    ]
    told: set[str] = set()
    try:
        for child in children:
            out, _ = child.communicate(timeout=60)
            assert child.returncode == 0
            told |= set(out.splitlines())
    finally:
        for child in children:
            child.kill()

    assert len(told) == 16
    assert told <= saved_texts(versioned_vault, "a.md")
    on_disk = (versioned_vault / "a.md").read_text()
    assert jj(versioned_vault, "--ignore-working-copy", "file", "show", "root:a.md") == on_disk
