"""What reading every tag costs, for `GET /api/tags` and the graph, over a generated vault.

The wall time is printed for whoever runs `pytest -s`. The one bound on it is
loose enough for a shared runner and still catches every note being read whole
in Python again, which is what fenced blocks tempt the reader into.
"""

import statistics
import time
from typing import TYPE_CHECKING

from kasten_backend.graph import read_graph
from kasten_backend.tags import find_tags

if TYPE_CHECKING:
    from pathlib import Path

NOTES = 2_000
RUNS = 3
MOST_SECONDS = 2.0
"""A median above this is a regression, not noise: the reader takes a tenth of it."""


def note(index: int) -> str:
    """A note with a heading, three tags, a code span, a link and every fifth a fence."""
    text = (
        f"# Note {index}\n\n"
        f"Some prose about #topic{index % 50} and #area/{index % 7}, with `code #nope`.\n"
        f"See [[Note {index + 1}]] and [a site](https://x.io/#anchor) for #shared.\n"
    )
    if index % 5 == 0:
        text += "\n```sh\ngrep #inside log\n```\n"
    return text + "\nMore prose. " * 20 + "\n"


def timed(label: str, durations: list[float]) -> None:
    print(f"\n{label}: median {statistics.median(durations) * 1000:.1f}ms over {NOTES} notes")


async def test_find_tags_and_graph_over_a_generated_vault(tmp_path: Path) -> None:
    for index in range(NOTES):
        (tmp_path / f"Note {index}.md").write_text(note(index), encoding="utf-8")

    durations = []
    for _ in range(RUNS):
        start = time.perf_counter()
        found = await find_tags(tmp_path)
        durations.append(time.perf_counter() - start)
    timed("find_tags", durations)

    graphs = []
    for _ in range(RUNS):
        start = time.perf_counter()
        graph = await read_graph(tmp_path)
        graphs.append(time.perf_counter() - start)
    timed("read_graph", graphs)

    assert "#shared" in found
    assert "#inside" not in found
    assert len(graph.nodes) == NOTES + 1
    assert statistics.median(durations) < MOST_SECONDS
    assert statistics.median(graphs) < MOST_SECONDS
