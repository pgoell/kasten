"""What reading every tag costs, for `GET /api/tags` and the graph, over a generated vault.

The wall and CPU time are printed for whoever runs `pytest -s`. The bound is on
the CPU the readers spend: wall time moves with whatever else runs on a shared
runner, CPU time does not. It catches a reader many times slower than today's,
not every note being read whole in Python again: reading all 2,000 notes whole
still lands under the bound. That regression is the count in
`test_find_tags_reads_whole_only_the_notes_a_line_cannot_say`.
"""

import os
import statistics
import time
from typing import TYPE_CHECKING

from kasten_backend import tags
from kasten_backend.graph import read_graph
from kasten_backend.tags import find_tags

if TYPE_CHECKING:
    from pathlib import Path

    import pytest

NOTES = 2_000
RUNS = 3
MOST_SECONDS = 2.0
"""A median of CPU seconds above this is a regression, not noise.

Today's medians are 0.5 s for `find_tags` and 0.7 s for `read_graph`. Reading every
note whole measured 1.2 s and 1.4 s, still under this, so the bound misses that
regression; the count in `test_find_tags_reads_whole_only_the_notes_a_line_cannot_say`
catches it.

Wall time is not bounded, because load from other processes moves it.
"""


def note(index: int) -> str:
    """A note with a heading, three tags, a code span, a link, and on some the rest.

    Most notes open with a frontmatter, as most of a real vault's do, and a few
    of those carry a hash and a `tags` field. Every fifth holds a fence, and a
    few hold a comment or an indented line under a list item.
    """
    text = ""
    if index % 7:
        styled = 'color: "#fff"\ntags: [field]\n' if index % 10 == 0 else ""
        text += f"---\nid: {index}\ncreated: 2026-10-19\n{styled}---\n"
    text += (
        f"# Note {index}\n\n"
        f"Some prose about #topic{index % 50} and #area/{index % 7}, with `code #nope`.\n"
        f"See [[Note {index + 1}]] and [a site](https://x.io/#anchor) for #shared.\n"
    )
    if index % 5 == 0:
        text += "\n```sh\ngrep #inside log\n```\n"
    if index % 11 == 0:
        text += "\n<!-- #hidden -->\n"
    if index % 20 == 0:
        text += "\n- an item\n    more about #continued\n"
    return text + "\nMore prose. " * 20 + "\n"


def cpu_seconds() -> float:
    """The CPU this process spent: its threads, plus the child processes it has waited for."""
    times = os.times()
    return times.user + times.system + times.children_user + times.children_system


def timed(label: str, wall: list[float], cpu: list[float]) -> None:
    print(
        f"\n{label}: wall median {statistics.median(wall) * 1000:.1f}ms, "
        f"cpu median {statistics.median(cpu) * 1000:.1f}ms over {NOTES} notes"
    )


async def test_find_tags_and_graph_over_a_generated_vault(tmp_path: Path) -> None:
    for index in range(NOTES):
        (tmp_path / f"Note {index}.md").write_text(note(index), encoding="utf-8")

    durations = []
    tag_cpu = []
    for _ in range(RUNS):
        start, cpu_start = time.perf_counter(), cpu_seconds()
        found = await find_tags(tmp_path)
        durations.append(time.perf_counter() - start)
        tag_cpu.append(cpu_seconds() - cpu_start)
    timed("find_tags", durations, tag_cpu)

    graphs = []
    graph_cpu = []
    for _ in range(RUNS):
        start, cpu_start = time.perf_counter(), cpu_seconds()
        graph = await read_graph(tmp_path)
        graphs.append(time.perf_counter() - start)
        graph_cpu.append(cpu_seconds() - cpu_start)
    timed("read_graph", graphs, graph_cpu)

    assert {"#shared", "#field", "#continued"} <= set(found)
    assert not {"#inside", "#fff", "#hidden"} & set(found)
    assert len(graph.nodes) == NOTES + 1
    assert statistics.median(tag_cpu) < MOST_SECONDS
    assert statistics.median(graph_cpu) < MOST_SECONDS


async def test_find_tags_reads_whole_only_the_notes_a_line_cannot_say(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only the notes with a fence, an indented hash or a hash in frontmatter are read whole.

    The CPU bound in the test above does not trip when every note is read whole:
    the medians there are 1160 ms and 1410 ms, under its 2.0 s, against 500 ms
    and 700 ms on main. This count does.
    """
    for index in range(NOTES):
        (tmp_path / f"Note {index}.md").write_text(note(index), encoding="utf-8")
    real_read_note = tags.read_note
    whole: list[str] = []

    def counting_read_note(root: Path, path: str) -> str | None:
        whole.append(path)
        return real_read_note(root, path)

    monkeypatch.setattr(tags, "read_note", counting_read_note)
    found = await find_tags(tmp_path)
    print(f"\nwhole reads: {len(whole)} of {NOTES} notes")
    assert {"#shared", "#field", "#continued"} <= set(found)
    assert 0 < len(whole) < NOTES // 2
