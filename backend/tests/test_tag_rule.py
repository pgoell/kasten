"""Every backend reader of a `#tag` against the one rule and its table of cases.

The rule is `docs/reference/tag-format.md`, and the cases are the file the
editor's tests read too, so the two sides cannot drift apart on what a tag is.
A reader of one line runs the cases of one line; a reader of a whole note runs
them all, each case its own vault so the answer says which case it came from.
"""

import json
from pathlib import Path
from typing import TYPE_CHECKING

from kasten_backend import mentions, tags, todos
from kasten_backend.graph import read_graph
from kasten_backend.graph_query import query_graph
from kasten_backend.tags import find_tags
from kasten_backend.vault import read_note

if TYPE_CHECKING:
    import pytest

CASES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/lib/tag-cases.json").read_text(encoding="utf-8")
)
LINES = [case for case in CASES if "\n" not in case["text"]]


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


def todo_tags(text: str) -> list[str]:
    """The tags `todos.py` reads off a whole line, its spans masked."""
    return [text[start:end] for start, end in todos.line_tags(text)]


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
    assert {case["id"]: mention_tags(case["text"]) for case in CASES} == {
        case["id"]: case["tags"] for case in CASES
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


async def test_b_note_gone_between_scan_and_read_is_skipped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A fence in each, as only a note that may hold one is read whole.
    write(tmp_path, "gone.md", "#gone\n~~~\n~~~\n")
    write(tmp_path, "kept.md", "#kept\n~~~\n~~~\n")

    def read(root: Path, path: str) -> str | None:
        # As though the note were deleted after rg named it.
        if path == "gone.md":
            raise FileNotFoundError(path)
        return read_note(root, path)

    monkeypatch.setattr(tags, "read_note", read)

    assert await tags.find_tags(tmp_path) == ["#kept"]


async def test_b_spans_do_not_count_toward_the_tag_cap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for index in range(5):
        write(tmp_path, f"{index}.md", f"`a` `b` [[c]] [d](e) #1984 #t{index}\n")
    # Five tags under the cap, thirty matches over it.
    monkeypatch.setattr(tags, "MOST_TAGS", 6)

    assert await tags.find_tags(tmp_path) == [f"#t{index}" for index in range(5)]


async def test_642_a2_graph_tag_filter_skips_a_hash_in_the_frontmatter(vault: Path) -> None:
    write(vault, "styled.md", '---\ncolor: "#fff"\nref: x #fff\n---\nbody\n')
    write(vault, "tagged.md", "#fff\n")

    graph = await query_graph(vault, "tag:fff")

    assert {node.path for node in graph.nodes} == {"tagged.md"}


async def test_642_a3_find_tags_reads_the_frontmatter_tags_field(tmp_path: Path) -> None:
    write(tmp_path, "flow.md", "---\ntags: [agent, design/ui]\n---\n")
    write(tmp_path, "block.md", "---\ntags:\n  - '#review'\n  - later\n---\n")
    write(tmp_path, "single.md", "---\ntags: solo\n---\n")

    assert await find_tags(tmp_path) == ["#agent", "#design/ui", "#later", "#review", "#solo"]


async def test_642_a3_graph_reads_the_frontmatter_tags_field(vault: Path) -> None:
    write(vault, "flow.md", "---\ntags: [agent, design/ui]\n---\n")
    write(vault, "block.md", "---\ntags:\n  - '#review'\n  - later\n---\n")
    write(vault, "single.md", "---\ntags: solo\n---\n")

    graph = await read_graph(vault)
    filtered = await query_graph(vault, "tag:design")

    assert {
        "nodes": {path: graph.nodes[path].tags for path in ("flow.md", "block.md", "single.md")},
        "filtered": {node.path for node in filtered.nodes},
    } == {
        "nodes": {
            "flow.md": ["#agent", "#design/ui"],
            "block.md": ["#later", "#review"],
            "single.md": ["#solo"],
        },
        "filtered": {"flow.md"},
    }


async def test_642_i3_a_tags_field_value_follows_the_tag_rule(tmp_path: Path) -> None:
    write(tmp_path, "note.md", "---\ntags: [1984, ½, ok]\n---\n")

    assert await find_tags(tmp_path) == ["#ok"]


async def test_642_i2_a_block_that_never_closes_is_no_frontmatter(tmp_path: Path) -> None:
    # The first is read whole, its hash after a `---` on line 1, and the second
    # a line at a time, its `---` lower down.
    write(tmp_path, "unclosed.md", "---\nref: x #abc\n")
    write(tmp_path, "lower.md", "body\n\n---\nref: x #def\n---\n")

    assert await find_tags(tmp_path) == ["#abc", "#def"]


async def test_648_a4_a_comment_opening_a_line_hides_its_line_in_a_note_read_whole(
    tmp_path: Path,
) -> None:
    # The fence sends the note to `tags_in`, which the one-line row never reaches.
    write(tmp_path, "note.md", "<!-- x --> #hidden\n#real\n~~~\n~~~\n")

    assert await find_tags(tmp_path) == ["#real"]


async def test_651_a6_a_spaced_fence_opens_no_frontmatter_in_a_note_read_whole(
    tmp_path: Path,
) -> None:
    # The fence sends the note to `tags_in`, which skips the block `body_start` finds.
    write(tmp_path, "note.md", ' ---\ncolor: "#fff"\n---\n#real\n~~~\n~~~\n')

    assert await find_tags(tmp_path) == ["#fff", "#real"]


async def test_653_b_a_comment_after_a_box_or_mid_line_hides_no_tag(tmp_path: Path) -> None:
    # The box opens the paragraph, and text opens the line, so each `<!--` is
    # an inline comment: the block rule is for a reader holding a whole line.
    write(tmp_path, "note.md", "a <!-- x -->#b\n")
    folders = {"x": "02 Projects/x"}

    assert {
        "project": todos._tag_project("<!-- x --> #p/x", folders),
        "words": todos._words("<!-- x --> 📅 2026-10-20 go"),
        "tags": await find_tags(tmp_path),
    } == {"project": "02 Projects/x", "words": "<!-- x --> go", "tags": ["#b"]}


def test_i5_name_inside_a_digit_first_tag_is_no_mention() -> None:
    text = "see #2026-10-13-x"

    assert mentions.mentions_in("a.md", text, mentions.matcher(["x"]), ["x"]) == []
