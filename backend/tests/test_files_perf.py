"""What `GET /api/files` costs over a vault the size the bar is set at.

Recorded, not gated. The only assertions here are about correctness: the
endpoint answers, and it answers with every note. The wall time is printed for
whoever is reading, which needs `pytest -s`.

This is the number the walk was rewritten against. It read 155 to 161ms when
`list_markdown_files` used `rglob`, and 15.9ms once it used `os.scandir`. Still
not gated: a wall time on a shared runner is a worse gate than a reader.

The vault is the same shape the frontend harnesses use, from
`frontend/bench/fixtures.ts`: thirds of the notes at depth one, two and three,
eight top folders, and a new folder every eight notes below that. Paths are not
byte-identical to the TypeScript generator's and do not need to be. The shape
is what the cost tracks, and both produce 842 folders at 10,000 notes.

The save case times one `PUT /api/files/{path}` in a jj repo the same way, and
splits it into the write and the jj commands it runs. The last case times the
per-note cache of #1758: tags after a save, and the graph.
"""

import asyncio
import math
import statistics
import time
from typing import TYPE_CHECKING

import pytest

from backend.tests.conftest import JJ, descriptions, jj
from kasten_backend import vcs
from kasten_backend.graph import read_graph

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

NOTES = 10_000
"""Vault size the whole performance round is measured at."""

RUNS = 3
"""Timed calls. Enough for a median, few enough to keep `mise run test:py` quick."""

SAVES = 5
"""Timed saves after the first, which is printed apart because it runs `jj new`."""

TOPS = 8
FANOUT = 8

TOP_NAMES = [
    "projects",
    "journal",
    "reference",
    "archive",
    "inbox",
    "meetings",
    "resources",
    "templates",
]

SUB_NAMES = [
    "client-work",
    "personal",
    "reading-notes",
    "design-docs",
    "retros",
    "onboarding",
    "user-research",
    "product-specs",
    "release-notes",
    "postmortems",
    "data-pipeline",
    "team-rituals",
    "book-notes",
    "talks",
    "interviews",
    "experiments",
]

LEAF_NAMES = [
    "drafts",
    "published",
    "diagrams",
    "questions",
    "benchmarks",
    "migrations",
    "highlights",
    "checklists",
    "estimates",
    "decisions",
    "follow-ups",
    "transcripts",
    "scratch",
    "outlines",
    "clippings",
    "summaries",
]

NOTE_NAMES = [
    "meeting-notes",
    "weekly-review",
    "reading-list",
    "design-review",
    "open-questions",
    "kickoff",
    "roadmap",
    "runbook",
    "incident-report",
    "one-on-one",
    "quarterly-plan",
    "idea-dump",
    "release-checklist",
    "architecture",
    "daily-log",
    "retro",
]


def named(pool: list[str], index: int) -> str:
    # Real names, not `t3/s2/n417.md`. `rglob` and the sort both walk the whole
    # string, so short names would put the recorded number well under what a
    # real vault costs. The lap suffix keeps distinct indexes distinct once the
    # pool wraps, which is what holds the folder count to the fan-out.
    word = pool[index % len(pool)]
    lap = index // len(pool)
    return word if lap == 0 else f"{word}-{lap}"


def synthetic_paths(note_count: int) -> list[str]:
    depth_one = math.ceil(note_count / 3)
    depth_two = math.ceil((note_count - depth_one) / 2)
    depth_three = note_count - depth_one - depth_two
    paths = []

    for i in range(depth_one):
        paths.append(f"{named(TOP_NAMES, i % TOPS)}/{named(NOTE_NAMES, i)}.md")

    for i in range(depth_two):
        group = i // FANOUT
        top = named(TOP_NAMES, group % TOPS)
        sub = named(SUB_NAMES, group // TOPS)
        paths.append(f"{top}/{sub}/{named(NOTE_NAMES, i)}.md")

    for i in range(depth_three):
        group = i // FANOUT
        top = named(TOP_NAMES, group % TOPS)
        sub = named(SUB_NAMES, (group // TOPS) % TOPS)
        leaf = named(LEAF_NAMES, group // (TOPS * TOPS))
        paths.append(f"{top}/{sub}/{leaf}/{named(NOTE_NAMES, i)}.md")

    return sorted(paths)


def folder_count(paths: list[str]) -> int:
    folders = set()
    for path in paths:
        prefix = ""
        for segment in path.split("/")[:-1]:
            prefix += f"{segment}/"
            folders.add(prefix)
    return len(folders)


def write_vault(root: Path, paths: list[str]) -> None:
    # The folders are remembered rather than remade per note, because 10,000
    # `mkdir` calls cost more than the 842 the vault actually needs.
    made = set()
    for path in paths:
        note = root / path
        if note.parent not in made:
            note.parent.mkdir(parents=True, exist_ok=True)
            made.add(note.parent)
        note.write_text("", encoding="utf-8")


async def test_lists_ten_thousand_notes(client: AsyncClient, vault: Path) -> None:
    paths = synthetic_paths(NOTES)
    started = time.perf_counter()
    write_vault(vault, paths)
    build_ms = (time.perf_counter() - started) * 1000

    times = []
    for _ in range(RUNS):
        start = time.perf_counter()
        response = await client.get("/api/files")
        times.append((time.perf_counter() - start) * 1000)

        assert response.status_code == 200
        assert len(response.json()) == NOTES

    print(
        f"\nGET /api/files over {NOTES} notes in {folder_count(paths)} folders: "
        f"{statistics.median(times):.1f}ms median of {RUNS} "
        f"({', '.join(f'{t:.1f}' for t in times)}), "
        f"vault built in {build_ms:.0f}ms"
    )


@pytest.mark.skipif(JJ is None, reason="jj is not installed")
async def test_saves_one_note_in_a_versioned_vault(
    client: AsyncClient, versioned_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    paths = synthetic_paths(NOTES)
    write_vault(versioned_vault, paths)
    target = paths[NOTES // 2]
    (versioned_vault / target).write_text("Before the save.\n", encoding="utf-8")
    # The first snapshot of 10,000 new files is the baseline, not the save.
    jj(versioned_vault, "status")

    calls: list[tuple[str, float]] = []
    real_run = vcs._run

    async def timed_run(root: Path, *args: str) -> str | None:
        started = time.perf_counter()
        result = await real_run(root, *args)
        calls.append((args[0], (time.perf_counter() - started) * 1000))
        return result

    monkeypatch.setattr(vcs, "_run", timed_run)

    async def save(text: str) -> dict[str, float]:
        calls.clear()
        started = time.perf_counter()
        response = await client.put(f"/api/files/{target}", json={"content": text})
        total = (time.perf_counter() - started) * 1000
        assert response.status_code == 200

        jj_ms = {"log": 0.0, "new": 0.0, "status": 0.0}
        for name, ms in calls:
            jj_ms[name] += ms
        return {"total": total, "write": total - sum(jj_ms.values()), **jj_ms}

    first = await save("First save.\n")
    saves = [await save(f"Save {n}.\n") for n in range(SAVES)]
    best = min(saves, key=lambda run: run["total"])

    assert "Save 4." in (versioned_vault / target).read_text(encoding="utf-8")
    assert f"vault: {target}" in descriptions(versioned_vault)

    print(
        f"\nPUT /api/files/{target} at {NOTES} notes, first save: {first['total']:.1f}ms "
        f"(write {first['write']:.1f}, jj log {first['log']:.1f}, "
        f"jj new {first['new']:.1f}, jj status {first['status']:.1f})"
    )
    print(
        f"best of {SAVES} saves: {best['total']:.1f}ms "
        f"(write {best['write']:.1f}, jj log {best['log']:.1f}, "
        f"jj new {best['new']:.1f}, jj status {best['status']:.1f})"
    )


def linked_note(index: int) -> str:
    """A note of PR #1825's bench shape: 40 lines, 5 links and 4 tagged todos."""
    lines = ["---", "type: Concept", f"id: {index}", "---", f"# Note {index}"]
    for line in range(35):
        if line % 7 == 0:
            lines.append(f"See [[Note {(index * 7 + line) % NOTES}]] for more, page {line}.")
        elif line % 9 == 2:
            lines.append(f"- [ ] task {line} #tag{(index + line) % 40} #area/{index % 8}")
        else:
            lines.append(f"Plain prose line {line} with nothing in it but words and more words.")
    return "\n".join(lines) + "\n"


async def test_tags_after_one_save_and_the_graph_at_ten_thousand_notes(
    client: AsyncClient, vault: Path
) -> None:
    """`GET /api/tags` after a one-note save, the longest loop hold, and `read_graph` (#1758).

    Recorded on a 16-thread box, best of 5: tags 40 ms after a save (main 553), the longest
    loop hold 6 ms (main 212), `read_graph` 355 ms (main 907). The first read parses every note.
    """
    for index in range(NOTES):
        folder = vault / f"folder {index % 50}"
        folder.mkdir(exist_ok=True)
        (folder / f"Note {index}.md").write_text(linked_note(index), encoding="utf-8")
    started = time.perf_counter()
    cold = await client.get("/api/tags")
    cold_ms = (time.perf_counter() - started) * 1000

    gaps: list[float] = []
    stop = asyncio.Event()

    async def tick() -> None:
        last = time.perf_counter()
        while not stop.is_set():
            await asyncio.sleep(0.001)
            now = time.perf_counter()
            gaps.append((now - last) * 1000 - 1)
            last = now

    times = []
    for run in range(5):
        saved = await client.put(
            "/api/files/folder 7/Note 7.md", json={"content": f"Saved #saved{run}\n"}
        )
        assert saved.status_code == 200
        ticker = asyncio.create_task(tick())
        await asyncio.sleep(0.005)
        gaps.clear()
        started = time.perf_counter()
        response = await client.get("/api/tags")
        times.append((time.perf_counter() - started) * 1000)
        stop.set()
        await ticker
        stop.clear()
        assert f"#saved{run}" in response.json()

    graphs = []
    for _ in range(5):
        started = time.perf_counter()
        graph = await read_graph(vault)
        graphs.append((time.perf_counter() - started) * 1000)

    assert cold.status_code == 200
    assert len(graph.nodes) == NOTES
    print(
        f"\nGET /api/tags at {NOTES} notes: cold {cold_ms:.0f}ms, best of 5 after a save "
        f"{min(times):.1f}ms, longest loop hold {max(gaps):.1f}ms; "
        f"read_graph best of 5 {min(graphs):.0f}ms"
    )
