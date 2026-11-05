"""What `GET /api/tags` calls a tag, and what it walks past.

The vocabulary, not the lines: the endpoint answers with each tag once, sorted,
and says nothing about which note holds it. The pattern is `tag.ts`'s, so what
comes back here is exactly what the editor would colour as a tag.
"""

from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_reads_the_vocabulary(client: AsyncClient, vault: Path) -> None:
    write(vault, "one.md", "# Heading\n\n#databases and #dbt, twice: #dbt\n")
    write(vault, "two.md", "#flashcards/databases\n\nQ::A\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#databases", "#dbt", "#flashcards/databases"]


async def test_walks_past_what_is_not_a_tag(client: AsyncClient, vault: Path) -> None:
    write(vault, "one.md", "# A heading\n#!/bin/sh\n#1 in the charts\nnote#2\nissue #42\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == []


async def test_reads_the_archive_too(client: AsyncClient, vault: Path) -> None:
    write(vault, "98 Archive/old.md", "#retired\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#retired"]


# The table the editor's tests read too, so the two sides agree on each line.
@pytest.mark.parametrize(
    ("line", "tags"),
    [
        ("#123", []),
        ("note#2", []),
        ("https://a.io/p#x", []),
        ("#p/fde.", ["#p/fde"]),
        ("#café", ["#café"]),
        ("#a-b/c", ["#a-b/c"]),
        ("#x#y", ["#x"]),
    ],
)
async def test_implied_1_parity_table(
    client: AsyncClient, vault: Path, line: str, tags: list[str]
) -> None:
    write(vault, "one.md", f"{line}\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == tags


async def test_629_no_tag_found_only_in_a_code_span(client: AsyncClient, vault: Path) -> None:
    write(vault, "one.md", "`grep #client log`\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == []


async def test_629_no_tag_found_only_in_a_link(client: AsyncClient, vault: Path) -> None:
    write(
        vault,
        "one.md",
        "[[#client]] and [[x|#wiki]]\n[docs](https://a.io/?#anchor) and [#label](x)\n",
    )
    write(vault, "two.md", "the real #wiki\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#wiki"]


async def test_implied_4_tag_at_the_start_after_a_paren_and_non_ascii(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "one.md", "#start here\nsee (#paren)\n#über\nnote#2 and https://a.io/p#x\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#paren", "#start", "#über"]


async def test_implied_5_tag_in_and_out_of_a_span_on_one_line(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "one.md", "`grep #x` #x and `#y`\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#x"]


async def test_finding_b_tag_on_a_line_over_64_kib(client: AsyncClient, vault: Path) -> None:
    # Longer than asyncio's 64 KiB line limit, as a pasted inline SVG is.
    write(vault, "one.md", "word " * 14_000 + "#x and `#hidden`\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#x"]


async def test_654_a_spaced_closer_leaves_the_whole_note_text(
    client: AsyncClient, vault: Path
) -> None:
    # Obsidian closes a block only on `---` at column 0, so `ref: x #a` is a line of text.
    write(vault, "one.md", "---\nref: x #a\n ---\n#real\n")

    response = await client.get("/api/tags")

    assert response.json() == ["#a", "#real"]


async def test_655_a_comment_opening_an_item_or_quote_hides_its_tags(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "item.md", "- <!-- x --> #p\n- [ ] <!-- x --> #box\n")
    write(vault, "quote.md", "> <!-- x --> #q\n")
    write(vault, "under.md", "- a\n    <!-- x --> #h\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#box"]


async def test_1459_walks_past_code_opening_after_a_quote_or_list_marker(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "quote.md", "> a\n>\n>     #quoted\n")
    write(vault, "item.md", "-     #itemcode\n")
    write(vault, "kept.md", "- a\n      #continued\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#continued"]


async def test_656_an_html_block_hides_its_tags(client: AsyncClient, vault: Path) -> None:
    # Each note on the line pass, then the parse, as the editor draws them: no tag in a block.
    write(vault, "div.md", "<div> #hidden\n\n- [ ] <div> #box\n")
    write(vault, "details.md", "> <details> #hidden\n")
    write(vault, "lone.md", "<span>\n#hidden\n\n#real\n")

    response = await client.get("/api/tags")

    assert response.status_code == 200
    assert response.json() == ["#box", "#real"]


async def test_658_a_block_opened_by_a_carriage_return_and_a_tab_hides_its_hash_on_both_passes(
    client: AsyncClient, vault: Path
) -> None:
    # A lone CR ends the fence's line in the served text, so `---\r\t` opens a block on both passes.
    write(vault, "line.md", "---\r\t\ncolor: #line\n---\n")
    write(vault, "whole.md", "---\r\t\ncolor: #whole\n---\n```\ncode\n```\n")
    write(vault, "block.md", "---\r\ncolor: #hidden\n---\r\n```\ncode\n```\n#real\n")

    response = await client.get("/api/tags")

    assert response.json() == ["#real"]


async def test_1570_a_block_whose_lines_end_in_a_lone_carriage_return_hides_its_hash(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "cr.md", "---\rid: a\rcolor: #inblock\r---\rbody #real\r")

    response = await client.get("/api/tags")

    assert response.json() == ["#real"]
