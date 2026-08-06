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
"""

import math
import statistics
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

NOTES = 10_000
"""Vault size the whole performance round is measured at."""

RUNS = 3
"""Timed calls. Enough for a median, few enough to keep `mise run test:py` quick."""

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
