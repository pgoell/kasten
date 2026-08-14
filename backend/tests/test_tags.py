"""What `GET /api/tags` calls a tag, and what it walks past.

The vocabulary, not the lines: the endpoint answers with each tag once, sorted,
and says nothing about which note holds it. The pattern is `tag.ts`'s, so what
comes back here is exactly what the editor would colour as a tag.
"""

from typing import TYPE_CHECKING

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
