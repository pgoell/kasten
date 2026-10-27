"""Search takes each hit note's tags from the tag cache, so an unchanged note is parsed once.

A flashcard note of half a megabyte takes a quarter of a second to parse for its
tags, and search answered with every hit note's tags parsed afresh (#1238).
Each test counts the calls to `search_meta.tags_of`, the one parse every reader
of a note's tags goes through.
"""

import os
from typing import TYPE_CHECKING, Any

from backend.tests.book_files import pdf
from kasten_backend import search_meta

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient


def write(vault: Path, path: str, content: bytes | str) -> Path:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        note.write_bytes(content)
    else:
        note.write_text(content, encoding="utf-8")
    return note


def count_parses(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """The text of each note `tags_of` parses from here on, in order."""
    parsed: list[str] = []
    real = search_meta.tags_of

    def counted(text: str) -> list[str]:
        parsed.append(text)
        return real(text)

    monkeypatch.setattr(search_meta, "tags_of", counted)
    return parsed


def touch_later(note: Path) -> None:
    """Move the note's modification time on by a second, as an edit within one tick might not."""
    status = note.stat()
    later = status.st_mtime_ns + 1_000_000_000
    os.utime(note, ns=(later, later))


async def search(client: AsyncClient, q: str) -> list[dict[str, Any]]:
    response = await client.get("/api/search", params={"q": q})
    assert response.status_code == 200
    return response.json()


async def test_1238_a1_a_second_search_does_not_parse_an_unchanged_note_again(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "Kyoto.md", "Kyoto #travel\n")
    parsed = count_parses(monkeypatch)

    first = await search(client, "Kyoto")
    second = await search(client, "Kyoto")

    assert {"tags": [hit["tags"] for hit in first + second], "parses": len(parsed)} == {
        "tags": [["#travel"], ["#travel"]],
        "parses": 1,
    }


async def test_1238_a2_a_changed_note_is_parsed_again(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    note = write(vault, "Kyoto.md", "Kyoto #travel\n")
    parsed = count_parses(monkeypatch)
    counts: list[int] = []

    await search(client, "Kyoto")
    counts.append(len(parsed))
    await search(client, "Kyoto")
    counts.append(len(parsed))
    # The same size, so only the modification time tells the edit apart.
    note.write_text("Kyoto #trains\n", encoding="utf-8")
    touch_later(note)
    (hit,) = await search(client, "Kyoto")
    counts.append(len(parsed))

    assert {"counts": counts, "tags": hit["tags"]} == {"counts": [1, 1, 2], "tags": ["#trains"]}


async def test_1238_i1_an_edit_landing_during_a_search_is_seen_on_the_next_search(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    note = write(vault, "Kyoto.md", "Kyoto #travel\n")
    real = search_meta.read_note

    def edited_after(root: Path, path: str) -> str | None:
        # The edit lands right after the read, once: a stamp taken after the read
        # would then keep the old tags under the new file's stamp.
        monkeypatch.setattr(search_meta, "read_note", real)
        text = real(root, path)
        note.write_text("Kyoto #trains\n", encoding="utf-8")
        touch_later(note)
        return text

    monkeypatch.setattr(search_meta, "read_note", edited_after)
    (first,) = await search(client, "Kyoto")
    (second,) = await search(client, "Kyoto")

    assert [first["tags"], second["tags"]] == [["#travel"], ["#trains"]]


async def test_1238_i2_a_note_that_cannot_be_read_answers_no_tags_and_is_not_cached(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "2026-03-10 Kyoto.md", b"Kyoto #travel \xff\n")

    first = await search(client, "Kyoto")

    assert {
        "answers": [(hit["date"], hit["tags"]) for hit in first],
        "cached": [key for key in search_meta._held if key.startswith(str(vault))],
    } == {"answers": [("2026-03-10", None)], "cached": []}


async def test_1238_i3_search_and_the_written_notes_share_the_parse_of_a_note(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "2026-03-10 Kyoto.md", "Kyoto #travel\n")
    parsed = count_parses(monkeypatch)

    (hit,) = await search(client, "Kyoto")
    written = await client.get(
        "/api/written/notes", params={"from": "2026-03-01", "to": "2026-03-31"}
    )
    (again,) = await search(client, "Kyoto")

    assert {
        "search": [hit["tags"], again["tags"]],
        "written": [note["tags"] for note in written.json()],
        "parses": len(parsed),
    } == {"search": [["#travel"], ["#travel"]], "written": [["#travel"]], "parses": 1}


async def test_1238_i4_a_file_hit_takes_its_note_tags_from_the_cache(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(vault, "2026-02-14 paper.md", "#research\n")
    write(vault, "2026-02-14 paper.pdf", pdf([["needle"]]))
    parsed = count_parses(monkeypatch)

    first = await search(client, "needle")
    second = await search(client, "needle")

    assert {"tags": [hit["tags"] for hit in first + second], "parses": len(parsed)} == {
        "tags": [["#research"], ["#research"]],
        "parses": 1,
    }
