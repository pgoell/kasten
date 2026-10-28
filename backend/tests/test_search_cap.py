"""A search that reaches the cap answers, and answers with what it did before (#1242).

These hung most of the time before the fix. rg was killed at the cap and then
waited for, but `Process.wait` only returns once every pipe has closed, and a
stdout pipe holding more than the reader's high-water mark had been paused by
asyncio and never read to its end. Long lines are what fill that buffer, so
every fixture here writes them. Each test runs under a time limit so a hang is a
failure rather than a stuck suite.
"""

import asyncio
from typing import TYPE_CHECKING

import pytest

from kasten_backend import history, todos
from kasten_backend.file_search import TEXT_LISTING
from kasten_backend.search import MOST_HITS, literal_matcher, scan_vault

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

LIMIT = 10
"""Seconds a test may take before a hang counts as one. A capped search takes well under one."""

PADDING = "x" * 2_000
"""Makes each line long enough that a few dozen pass asyncio's 128 KiB high-water mark."""


def numbered(count: int) -> str:
    return "".join(f"Japanese {number} {PADDING}\n" for number in range(1, count + 1))


NOTES = 20
"""How many notes `fill` writes. Many notes make rg write in bursts, which is what hung."""


def fill(vault: Path) -> None:
    """Twice the cap of long matching lines, spread over `NOTES` notes."""
    for note in range(NOTES):
        (vault / f"japan {note}.md").write_text(numbered(2 * MOST_HITS // NOTES), encoding="utf-8")


async def test_a_search_that_reaches_the_cap_answers_rather_than_hangs(
    client: AsyncClient, vault: Path
) -> None:
    fill(vault)

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/search", params={"q": "japanese"})

    assert response.status_code == 200
    hits = response.json()
    assert len(hits) == MOST_HITS
    # rg's order across notes is its threads' and was never fixed, but each
    # note's lines come whole and in order: the first ones of that note.
    by_note: dict[str, list[int]] = {}
    for hit in hits:
        by_note.setdefault(hit["path"], []).append(hit["line"])
    for lines in by_note.values():
        assert lines == list(range(1, len(lines) + 1))


async def test_at_the_cap_the_hits_are_the_first_lines_rg_prints(
    client: AsyncClient, vault: Path
) -> None:
    # One note, so rg's order is the note's own and the first 2,000 lines it
    # prints are lines 1 to 2,000.
    (vault / "japan.md").write_text(numbered(2 * MOST_HITS), encoding="utf-8")

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/search", params={"q": "japanese"})

    hits = response.json()
    assert [(hit["path"], hit["line"]) for hit in hits] == [
        ("japan.md", number) for number in range(1, MOST_HITS + 1)
    ]
    assert [hit["text"] for hit in hits] == numbered(MOST_HITS).splitlines()


async def test_under_the_cap_every_matching_line_comes_back(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "japan.md").write_text(numbered(MOST_HITS - 1), encoding="utf-8")
    (vault / "kyoto.md").write_text("No match here.\n", encoding="utf-8")

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/search", params={"q": "japanese"})

    hits = response.json()
    assert [(hit["path"], hit["line"]) for hit in hits] == [
        ("japan.md", number) for number in range(1, MOST_HITS)
    ]
    assert [hit["text"] for hit in hits] == numbered(MOST_HITS - 1).splitlines()


async def test_a_scan_of_the_extracted_text_that_reaches_its_cap_answers(tmp_path: Path) -> None:
    # The scan the route runs over the text cache when the notes leave room.
    for book in range(NOTES):
        (tmp_path / f"book {book}.epub.txt").write_text(numbered(200), encoding="utf-8")

    async with asyncio.timeout(LIMIT):
        hits = await scan_vault(tmp_path, literal_matcher("japanese"), 100, listing=TEXT_LISTING)

    assert len(hits) == 100


async def test_a_capped_search_leaves_no_rg_behind(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fill(tmp_path)
    spawned: list[asyncio.subprocess.Process] = []
    spawn = asyncio.create_subprocess_exec

    async def watched(*argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        process = await spawn(*argv, stdout=stdout, stderr=stderr)
        spawned.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", watched)

    async with asyncio.timeout(LIMIT):
        await scan_vault(tmp_path, literal_matcher("japanese"), MOST_HITS)

    assert spawned[0].returncode is not None


async def test_the_todo_list_answers_at_its_cap(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Every reader of lines shares `scan_vault`. The todo list stands for the
    # others, its cap lowered so a fixture reaches it.
    monkeypatch.setattr(todos, "MOST_TODOS", 10)
    (vault / "japan.md").write_text(
        "".join(f"- [ ] Japanese {number} {PADDING}\n" for number in range(1, 2_001)),
        encoding="utf-8",
    )

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/todos")

    assert response.status_code == 200
    assert [todo["line"] for todo in response.json()] == list(range(1, 11))


async def test_a_cancelled_scan_leaves_no_rg_behind(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A request the client walks away from cancels the scan mid-read.
    (tmp_path / "japan.md").write_text(numbered(20 * MOST_HITS), encoding="utf-8")
    spawned: list[asyncio.subprocess.Process] = []
    started = asyncio.Event()
    spawn = asyncio.create_subprocess_exec

    async def watched(*argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        process = await spawn(*argv, stdout=stdout, stderr=stderr)
        spawned.append(process)
        started.set()
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", watched)
    scan = asyncio.create_task(scan_vault(tmp_path, literal_matcher("japanese"), 10 * MOST_HITS))
    await started.wait()
    scan.cancel()

    async with asyncio.timeout(LIMIT):
        with pytest.raises(asyncio.CancelledError):
            await scan

    assert spawned[0].returncode is not None


async def test_a_jj_that_writes_without_end_is_stopped_at_the_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The same wait after a kill, in the history's reader: jj stopped at its
    # timeout mid-output has to be drained before it can be waited for.
    spawned: list[asyncio.subprocess.Process] = []
    spawn = asyncio.create_subprocess_exec

    async def endless(*_argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        process = await spawn("yes", PADDING, stdout=stdout, stderr=stderr)
        spawned.append(process)
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", endless)
    monkeypatch.setattr(history, "TIMEOUT", 0.2)

    async with asyncio.timeout(LIMIT):
        with pytest.raises(history.HistoryError):
            await history._read(tmp_path, "log")

    assert spawned[0].returncode is not None
