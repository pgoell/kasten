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
