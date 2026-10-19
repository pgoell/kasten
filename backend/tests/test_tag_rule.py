"""Every backend reader of a `#tag` against the one rule and its table of cases.

The rule is `docs/reference/tag-format.md`, and the cases are the file the
editor's tests read too, so the two sides cannot drift apart on what a tag is.
A reader of one line runs the cases of one line; a reader of a whole note runs
them all, each case its own vault so the answer says which case it came from.
"""

import json
from pathlib import Path

from kasten_backend import mentions, todos
from kasten_backend.graph import query_graph, read_graph
from kasten_backend.tags import find_tags

CASES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/lib/tag-cases.json").read_text(encoding="utf-8")
)
LINES = [case for case in CASES if "\n" not in case["text"]]


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


def todo_tags(text: str) -> list[str]:
    """The tags `todos.py` reads off a line: `TAG` on the line with its spans masked."""
    return [text[found.start() : found.end()] for found in todos.TAG.finditer(todos.mask(text))]


def mention_tags(text: str) -> list[str]:
    """The spans `mentions.skipped` leaves out that are tags, in the order the text holds them."""
    found = [text[start:end] for start, end in sorted(mentions.skipped(text))]
    return [span for span in found if span.startswith("#")]


def test_a3_todos_read_the_table() -> None:
    assert {case["id"]: todo_tags(case["text"]) for case in LINES} == {
        case["id"]: case["tags"] for case in LINES
    }


async def test_a3_find_tags_reads_the_table(tmp_path: Path) -> None:
    for case in CASES:
        write(tmp_path / case["id"], "note.md", case["text"])

    assert {case["id"]: await find_tags(tmp_path / case["id"]) for case in CASES} == {
        case["id"]: sorted(set(case["tags"])) for case in CASES
    }


async def test_a3_graph_node_tags_read_the_table(tmp_path: Path) -> None:
    for case in CASES:
        write(tmp_path / case["id"], "note.md", case["text"])

    assert {
        case["id"]: (await read_graph(tmp_path / case["id"])).nodes["note.md"].tags
        for case in CASES
    } == {case["id"]: sorted(set(case["tags"])) for case in CASES}


def test_a3_mentions_skip_the_tags_of_the_table() -> None:
    assert {case["id"]: mention_tags(case["text"]) for case in LINES} == {
        case["id"]: case["tags"] for case in LINES
    }


def test_a2_todo_carries_a_digit_first_tag() -> None:
    assert todo_tags("- [ ] call #1on1") == ["#1on1"]


async def test_a6_graph_tag_filter_skips_a_hash_in_a_code_span_or_a_link(vault: Path) -> None:
    write(vault, "code.md", "`grep #client log`\n")
    write(vault, "link.md", "[[a #client]] and [see](https://x.io/#client)\n")
    write(vault, "fence.md", "~~~\n#client\n")
    write(vault, "tagged.md", "#client\n")

    graph = await query_graph(vault, "tag:client")

    assert {node.path for node in graph.nodes} == {"tagged.md"}


def test_b_todo_line_opening_with_backticks_is_no_fence() -> None:
    folders = {"x": "02 Projects/x"}

    assert todos._tag_project("```x #p/x", folders) == "02 Projects/x"


def test_i5_name_inside_a_digit_first_tag_is_no_mention() -> None:
    text = "see #2026-10-13-x"

    assert mentions.mentions_in("a.md", text, mentions.matcher(["x"]), ["x"]) == []
