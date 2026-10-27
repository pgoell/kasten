"""A line longer than the pipe reader's 64 KiB limit is read, not a 500 (#1244).

`StreamReader.readline` raises on such a line, and past twice the limit it also
clears its buffer, so the line's tail came back as a line of its own. Every
fixture here writes a line well past both, and a match after it, so a scan that
loses its place shows up as a missing or broken hit.
"""

import asyncio
from typing import TYPE_CHECKING

from kasten_backend.search import LONGEST_TEXT

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

LIMIT = 10
"""Seconds a test may take before a hang counts as one."""

LONG = "japanese " + "y" * 300_000
"""A matching line more than four times the reader's limit."""


async def test_a_search_over_a_line_past_64_kib_answers_with_every_hit(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "japan.md").write_text(f"Japanese first\n{LONG}\nJapanese after\n", encoding="utf-8")
    (vault / "kyoto.md").write_text("Japanese in kyoto\n", encoding="utf-8")

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/search", params={"q": "japanese"})

    assert response.status_code == 200
    hits = sorted((hit["path"], hit["line"], hit["text"]) for hit in response.json())
    assert hits == [
        ("japan.md", 1, "Japanese first"),
        ("japan.md", 2, LONG[:LONGEST_TEXT]),
        ("japan.md", 3, "Japanese after"),
        ("kyoto.md", 1, "Japanese in kyoto"),
    ]


async def test_a_line_under_the_cut_comes_back_whole(client: AsyncClient, vault: Path) -> None:
    # Past the reader's 64 KiB in bytes, under the cut in characters: main
    # failed on it, and nothing of it may be lost now.
    line = "japanese " + "ü" * 40_000
    (vault / "japan.md").write_text(f"{line}\n", encoding="utf-8")

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/search", params={"q": "japanese"})

    assert [hit["text"] for hit in response.json()] == [line]


async def test_a_long_line_of_multibyte_text_is_cut_between_characters(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "japan.md").write_text("japanese " + "日本" * 150_000 + "\n", encoding="utf-8")

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/search", params={"q": "japanese"})

    [hit] = response.json()
    assert len(hit["text"]) == LONGEST_TEXT
    assert "�" not in hit["text"]


async def test_the_todo_list_answers_over_a_todo_past_64_kib(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "japan.md").write_text(f"- [ ] first\n- [ ] {LONG}\n- [ ] after\n", encoding="utf-8")
    (vault / "kyoto.md").write_text("- [ ] in kyoto\n", encoding="utf-8")

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/todos")

    assert response.status_code == 200
    assert sorted((todo["path"], todo["line"]) for todo in response.json()) == [
        ("japan.md", 1),
        ("japan.md", 2),
        ("japan.md", 3),
        ("kyoto.md", 1),
    ]


async def test_a_search_over_an_html_paragraph_past_64_kib_answers(
    client: AsyncClient, vault: Path
) -> None:
    # The text cache folds each html block into one line.
    paragraph = "needle " + "y" * 300_000
    (vault / "page.html").write_text(
        f"<html><body><p>{paragraph}</p><p>a needle after</p></body></html>", encoding="utf-8"
    )

    async with asyncio.timeout(LIMIT):
        response = await client.get("/api/search", params={"q": "needle"})

    assert response.status_code == 200
    assert [hit["text"] for hit in response.json()] == [paragraph[:LONGEST_TEXT], "a needle after"]
