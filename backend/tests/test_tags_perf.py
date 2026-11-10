"""What reading every tag costs, for `GET /api/tags` and the graph, over a generated vault.

The wall and CPU time are printed for whoever runs `pytest -s`. The bound is on
the CPU the readers spend: wall time moves with whatever else runs on a shared
runner, CPU time does not. It catches a reader many times slower than today's.
Each note is parsed once and then held (#1758); the parse counts are in
`test_search_tag_cache.py`.
"""

import os
import statistics
import sys
import time
from typing import TYPE_CHECKING

from kasten_backend import todos
from kasten_backend.graph import read_graph
from kasten_backend.tags import find_tags

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path


NOTES = 2_000
RUNS = 3
MOST_SECONDS = 2.0
"""A median of CPU seconds above this is a regression, not noise.

The first run parses every note and the others read the cache, so the median is a
warm read.

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


MOST_GROWTH = 6
"""A note four times longer may take at most this many times the steps: linear is 4, a walk back 16.

Steps, not time, since a slow or loaded runner changes time and not steps (#1708). A step
is a Python call or loop turn, so a walk back inside one C call (a regex, a str method) goes
unseen.
"""

STEPS_TOOL = 4
"""A `sys.monitoring` tool id no debugger, coverage tool or profiler claims."""


def steps[T](read: Callable[[str], T], text: str) -> tuple[int, T]:
    """The calls and loop turns `read(text)` makes, Python and C, and what it returns."""
    count = 0

    def hit(*_: object) -> None:
        nonlocal count
        count += 1

    events = sys.monitoring.events
    sys.monitoring.use_tool_id(STEPS_TOOL, "steps")
    try:
        sys.monitoring.register_callback(STEPS_TOOL, events.CALL, hit)
        sys.monitoring.register_callback(STEPS_TOOL, events.JUMP, hit)
        sys.monitoring.set_events(STEPS_TOOL, events.CALL | events.JUMP)
        found = read(text)
    finally:
        sys.monitoring.set_events(STEPS_TOOL, 0)
        sys.monitoring.free_tool_id(STEPS_TOOL)
    return count, found


def growth[T](
    label: str, text_of: Callable[[int], str], size: int, read: Callable[[str], T]
) -> tuple[float, T]:
    """How many times the steps of `read(text_of(size))` exceed a quarter's, and its result."""
    full, found = steps(read, text_of(size))
    quarter, _ = steps(read, text_of(size // 4))
    ratio = full / quarter
    print(f"\n{label}: {full} steps, {ratio:.2f} times a quarter")
    return ratio, found


def test_growth_counts_steps_and_catches_a_walk_back() -> None:
    def text_of(size: int) -> str:
        return "> 1. a <!-- y\n2.\n" * size

    def walk_back(text: str) -> None:
        for _ in range(len(text) // 500):
            todos.tags_in(text)

    assert growth("steady", text_of, 500, todos.tags_in)[0] < MOST_GROWTH
    assert growth("walking back", text_of, 500, walk_back)[0] > MOST_GROWTH


def test_1544_long_notes_of_open_comments_and_lazy_items_read_in_bounded_time() -> None:
    """A comment closes per paragraph, a lazy line asks the list stack: no Python walks back."""
    notes = {
        "open comments": (lambda n: "a <!-- y\n" * n, 20_000),
        "lazy quote": (lambda n: "> a <!-- y\n" + "2. x\n" * n + "#t -->", 20_000),
        "lazy items": (lambda n: "- a <!-- y\n" + "- \n2. x\nz\n" * n, 7_000),
        "nested lists": (
            lambda n: "".join("  " * (i % 30) + "- a <!-- y\n" for i in range(n)),
            20_000,
        ),
    }
    for label, (text_of, size) in notes.items():
        ratio, found = growth(label, text_of, size, todos.tags_in)
        assert ratio < MOST_GROWTH, label
        assert len(found) <= 1


def test_1594_long_notes_of_spans_in_comments_empty_items_and_lazy_quote_items() -> None:
    """The comment walk passes spans by bisect, and a quote's lazy items cost one parse more."""
    notes = {
        "spans in a comment": (lambda n: "a <!-- y " + "`x <!--` " * n + "-->", 20_000),
        "spans opening comments": (
            lambda n: "`<!--` x " * n + "\n" + "a <!-- `--` y " * (n // 4),
            20_000,
        ),
        "empty items": (lambda n: "-\n\n" * n + "    #t", 20_000),
        "lazy items of the other kind": (
            lambda n: "> - a <!-- y\n" + "2.\n" * n + "> #t -->",
            20_000,
        ),
        "lazy items that cut": (lambda n: "> 1. a <!-- y\n2.\n" * n, 5_000),
        "quote and lazy lines in turn": (lambda n: "> - a <!-- y\n2.\n> b\n" * n, 7_000),
    }
    for label, (text_of, size) in notes.items():
        assert growth(label, text_of, size, todos.tags_in)[0] < MOST_GROWTH, label
