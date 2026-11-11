"""A line longer than the pipe reader's 64 KiB limit is read, not a 500 (#1244).

`StreamReader.readline` raises on such a line, and past twice the limit it also
clears its buffer, so the line's tail came back as a line of its own. Every
fixture here writes a line well past both, and a match after it, so a scan that
loses its place shows up as a missing or broken hit.
"""

import asyncio
import sys
from typing import TYPE_CHECKING

import pytest

from kasten_backend import search
from kasten_backend.search import LONGEST_TEXT, Hit, literal_matcher, scan_vault

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


@pytest.mark.parametrize("chunk", [1, 5, 7])
async def test_a_chunk_boundary_inside_a_line_or_a_character_loses_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, chunk: int
) -> None:
    # Odd sizes put a read's end inside lines and inside multi-byte characters (#1759).
    lines = [f"japanese {index} ü 日本 {'語' * index}" for index in range(40)]
    (tmp_path / "日本.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    monkeypatch.setattr(search, "_CHUNK", chunk)

    async with asyncio.timeout(LIMIT):
        hits = await scan_vault(tmp_path, literal_matcher("japanese"), 1_000)

    assert hits == [Hit("日本.md", number, line) for number, line in enumerate(lines, 1)]


async def test_a_long_line_read_over_many_chunks_is_cut_as_one(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    long = "japanese " + "日本" * 150_000
    (tmp_path / "japan.md").write_text(f"japanese first\n{long}\njapanese after", encoding="utf-8")
    monkeypatch.setattr(search, "_CHUNK", 4_093)

    async with asyncio.timeout(LIMIT):
        hits = await scan_vault(tmp_path, literal_matcher("japanese"), 1_000)

    assert [hit.text for hit in hits] == ["japanese first", long[:LONGEST_TEXT], "japanese after"]


async def test_a_last_line_with_no_newline_comes_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # rg always ends a line; a stand-in that does not shows the last bytes are kept.
    spawn = asyncio.create_subprocess_exec
    printed = f"{tmp_path}/a.md\0" + f"1:first\n{tmp_path}/b.md\0" + "2:last"

    async def unended(*_argv: str, stdout: int, stderr: int) -> asyncio.subprocess.Process:
        script = f"import sys; sys.stdout.write({printed!r})"
        return await spawn(sys.executable, "-c", script, stdout=stdout, stderr=stderr)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", unended)

    async with asyncio.timeout(LIMIT):
        hits = await scan_vault(tmp_path, literal_matcher("x"), 10)

    assert hits == [Hit("a.md", 1, "first"), Hit("b.md", 2, "last")]


# The two flags of `GET /api/search` (#1773). Here because tests/ is at its folder cap.


def _notes(vault: Path) -> None:
    (vault / "plan.md").write_text("the plan holds\n", encoding="utf-8")
    (vault / "planned.md").write_text("we planned it\n", encoding="utf-8")
    (vault / "trip.md").write_text("a trip away\nthe trips ahead\n", encoding="utf-8")


async def _texts(client: AsyncClient, **params: str | bool) -> list[str]:
    response = await client.get("/api/search", params=params)
    assert response.status_code == 200, response.text
    return sorted(hit["text"] for hit in response.json())


async def test_1773_regex_finds_a_word_edge_pattern(client: AsyncClient, vault: Path) -> None:
    _notes(vault)

    assert await _texts(client, q=r"\bplan\b", regex=True) == ["the plan holds"]


async def test_1773_word_keeps_whole_words_of_a_literal(client: AsyncClient, vault: Path) -> None:
    _notes(vault)

    assert await _texts(client, q="plan", word=True) == ["the plan holds"]


async def test_1773_regex_and_word_together_keep_whole_words_of_each_branch(
    client: AsyncClient, vault: Path
) -> None:
    _notes(vault)

    assert await _texts(client, q="plan|trip", regex=True, word=True) == [
        "a trip away",
        "the plan holds",
    ]


async def test_1773_a_literal_does_not_read_its_backslashes_as_a_pattern(
    client: AsyncClient, vault: Path
) -> None:
    _notes(vault)
    (vault / "regex.md").write_text("write \\bplan\\b to match it\n", encoding="utf-8")

    assert await _texts(client, q=r"\bplan\b") == ["write \\bplan\\b to match it"]


@pytest.mark.parametrize(
    ("pattern", "says"),
    [
        ("(open", "unclosed group"),
        ("[[like", "unclosed character class"),
        ("(?=x)", "look-around"),
        ("a\\nb", '"\\n" is not allowed'),
    ],
)
async def test_1773_a_bad_regex_answers_422_with_rgs_message(
    client: AsyncClient, vault: Path, pattern: str, says: str
) -> None:
    _notes(vault)

    response = await client.get("/api/search", params={"q": pattern, "regex": True})

    assert response.status_code == 422
    assert says in response.json()["detail"]


async def test_1773_word_on_a_literal_with_regex_characters_matches_it_literally(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "dots.md").write_text("a.b here\naxb there\nza.bz glued\n", encoding="utf-8")

    assert await _texts(client, q="a.b", word=True) == ["a.b here"]


async def test_1773_html_text_honours_both_flags(client: AsyncClient, vault: Path) -> None:
    (vault / "page.html").write_text(
        "<html><body><p>the plan here</p><p>planned there</p></body></html>", encoding="utf-8"
    )

    assert await _texts(client, q="plan", word=True) == ["the plan here"]
    assert await _texts(client, q=r"plan\w+", regex=True) == ["planned there"]
