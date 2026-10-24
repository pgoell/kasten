import time
from typing import TYPE_CHECKING

import pytest

from kasten_backend.code_spans import code_spans
from kasten_backend.links import relink, relink_markdown

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


@pytest.mark.parametrize(
    "text",
    [
        "```\n[[x]]\n```\n",
        "```md\nsee [[x]] and [[a/x]]\n```\n",
        "~~~\n[[x]]\n~~~\n",
        "   ```\n[[x]]\n   ```\n",
        "````\n```\n[[x]]\n````\n",
        "~~~\n```\n[[x]]\n~~~\n",
        "```\n[[x]]\n",
        "inline `[[x]]` here\n",
        "inline ``a ` [[x]]`` here\n",
        "```\n[t](a/x.md)\n```\n",
        "`[t](a/x.md)`\n",
    ],
)
async def test_leaves_a_link_in_code_as_written(
    client: AsyncClient, vault: Path, text: str
) -> None:
    # Code holds the syntax as an example, so neither a move nor a rename is
    # anything for it to answer.
    (vault / "a").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "index.md").write_text(text)

    await client.patch("/api/files/a/x.md", json={"path": "b/y.md"})

    assert (vault / "index.md").read_text() == text


async def test_follows_a_link_right_after_a_fence(client: AsyncClient, vault: Path) -> None:
    (vault / "x.md").write_text("# x")
    (vault / "index.md").write_text("```\n[[x]]\n```\n[[x]] `[[x]]` [[x]] [t](x.md)\n")

    await client.patch("/api/files/x.md", json={"path": "y.md"})

    expected = "```\n[[x]]\n```\n[[y]] `[[x]]` [[y]] [t](y.md)\n"
    assert (vault / "index.md").read_text() == expected


@pytest.mark.parametrize(
    ("text", "spans"),
    [
        ("a\n    [[x]]\n", []),
        ("```js\nx\n``\n```\n", [(0, 15)]),
        ("```a`b\n[[x]]\n", []),
        ("`a\n\nb `c`", [(6, 9)]),
        ("``a`` `b", [(0, 5)]),
    ],
)
def test_code_spans_reads_code_the_way_commonmark_does(
    text: str, spans: list[tuple[int, int]]
) -> None:
    # An indented line is a list item's continuation as often as it is code,
    # and a backtick fence with a backtick after it is inline code.
    assert code_spans(text) == spans


@pytest.mark.parametrize(
    "text",
    [
        "- use ` for code\n- see [[x]]\n- `y`\n",
        "# a ` b\n[[x]] `c`\n",
        "a ` b\n[[x]] `c`\n",
        "| a ` | b |\n|---|---|\n| [[x]] | `c` |\n",
    ],
)
def test_follows_a_link_between_two_lines_a_backtick_would_pair(text: str) -> None:
    # A span is read on one line only, so a stray backtick in one list item,
    # heading or table row cannot pair with one further down and hide the link.
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == text.replace("[[x]]", "[[y]]")


def test_follows_a_link_after_an_escaped_backtick() -> None:
    text = "a \\` b [[x]] c `d`\n"

    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == "a \\` b [[y]] c `d`\n"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("[[x|a `b]] and [[x]] then ` end\n", "[[y|a `b]] and [[y]] then ` end\n"),
        ("see [[x|`code`]]\n", "see [[y|`code`]]\n"),
    ],
)
def test_follows_a_link_whose_alias_holds_a_backtick(text: str, expected: str) -> None:
    # A backtick in a link opens no code, so it cannot pair with a later one.
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == expected


@pytest.mark.parametrize(
    "text",
    [
        "Type `[[` and close with ]] like [[Old]] or `x`\n",
        "Run `x [[Note|a`b]] then [[Old]] and `y`\n",
    ],
)
def test_follows_a_link_after_a_span_that_closes_inside_another(text: str) -> None:
    # The span's closer sits in what reads as a `[[link]]`, and it still closes:
    # skipping it would pair the opener with the last backtick and hide `[[Old]]`.
    assert relink(text, {"Old.md": "New.md"}, ["Old.md"]) == text.replace("[[Old]]", "[[New]]")


@pytest.mark.parametrize(
    ("text", "spans"),
    [
        ("a \\` b `c`", [(7, 10)]),
        ("C:\\\\`[[x]]`", [(4, 11)]),
        ("\\``[[x]]`", [(2, 9)]),
        ("`a\\`", [(0, 4)]),
    ],
)
def test_code_spans_reads_a_backslash_before_a_backtick(
    text: str, spans: list[tuple[int, int]]
) -> None:
    # An odd run of backslashes escapes one backtick of an opener, and the rest
    # of its run may still open. Inside code a backslash escapes nothing.
    assert code_spans(text) == spans


@pytest.mark.parametrize(
    "text",
    [
        "x\x0c```\n[[x]]\n",
        "a\N{LINE SEPARATOR}```\n[[x]]\n",
        "a\x0b```b\n[[x]]\n",
        "a\x85```\n[[x]]\n",
    ],
)
def test_opens_no_fence_after_a_break_that_is_not_a_newline(text: str) -> None:
    # Python's `splitlines` breaks at these, and the fence after one sits mid-line.
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == text.replace("[[x]]", "[[y]]")


def test_reads_a_fence_with_windows_line_endings() -> None:
    text = "~~~\r\n[[x]]\r\n~~~\r\n[[x]]\r\n"

    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == "~~~\r\n[[x]]\r\n~~~\r\n[[y]]\r\n"


@pytest.mark.parametrize(
    "text",
    [
        "> ```\n> [[x]]\n> ```\n",
        "> quote\n>\n> ```md\n> see [[x]] and [t](x.md)\n> ```\n",
        "- a\n    - b\n\n        ```\n        [[x]]\n        ```\n",
        "- a\n  - b\n\n    ~~~\n    [[x]]\n    ~~~\n",
    ],
)
def test_leaves_a_link_in_a_nested_fence_as_written(text: str) -> None:
    # A fence inside a blockquote or a list item is code all the same, though
    # its lines start with `> ` or with more than three spaces.
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == text
    assert relink_markdown(text, "index.md", "index.md", ("x.md", "y.md")) == text


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "> [[x]]\n> ```\n> [[x]]\n> ```\n> [[x]]\n",
            "> [[y]]\n> ```\n> [[x]]\n> ```\n> [[y]]\n",
        ),
        (
            "- a\n    - [[x]]\n\n        ```\n        [[x]]\n        ```\n    - [[x]]\n",
            "- a\n    - [[y]]\n\n        ```\n        [[x]]\n        ```\n    - [[y]]\n",
        ),
        # Nobody closed the fence, and it ends with the blockquote holding it.
        ("> ```\n> [[x]]\n\n[[x]]\n", "> ```\n> [[x]]\n\n[[y]]\n"),
    ],
)
def test_follows_a_link_beside_a_nested_fence(text: str, expected: str) -> None:
    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == expected


def test_reads_a_nested_fence_with_windows_line_endings() -> None:
    text = "> ```\r\n> [[x]]\r\n> ```\r\n[[x]] `[[x]]`\r\n"

    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == (
        "> ```\r\n> [[x]]\r\n> ```\r\n[[y]] `[[x]]`\r\n"
    )


def test_reads_a_carriage_return_as_no_line_break() -> None:
    # Splitting on the line feed alone, a lone `\r` sits mid-line and opens no
    # fence, and the parser must count the lines the same way.
    text = "a\r```\n[[x]]\n```\n[[x]]\n```\n"

    assert relink(text, {"x.md": "y.md"}, ["x.md"]) == "a\r```\n[[y]]\n```\n[[x]]\n```\n"


def test_reads_code_of_a_long_note_full_of_fences_in_time() -> None:
    # The note is parsed once, and in blocks only, for the same event loop.
    text = "para `c` [[x]]\n\n```py\n[[x]]\n```\n\n> ```\n> q\n> ```\n- item\n\n" * 1000
    began = time.perf_counter()

    code_spans(text)

    assert time.perf_counter() - began < 0.5


def test_relinks_a_long_note_full_of_code_in_time() -> None:
    # One scan of every span per link held the event loop 27s on this note.
    text = "text `code` [[x]] more\n" * 20000
    began = time.perf_counter()

    relink(text, {"x.md": "y.md"}, ["x.md"])
    code_spans("`a``b" * 20000)

    assert time.perf_counter() - began < 2
