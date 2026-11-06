"""The entry cache behind `place_of`, the lookup that says which page a search hit is on.

An entry is read once and reused until its json changes. Two writes in one mtime tick
can leave jsons of one size, so the json's mtime and size alone cannot tell them apart.
The bytes an entry is written from may be in any encoding and hold a NUL, and rg must still
read the txt (#1239).
"""

import os
from typing import TYPE_CHECKING

from backend.tests.book_files import epub, xhtml
from kasten_backend.books import file_text
from kasten_backend.books.file_text import Extracted, Place

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def test_place_of_reads_the_second_of_two_same_size_writes_in_one_tick(
    tmp_path: Path,
) -> None:
    file_text._load.cache_clear()
    source = tmp_path / "book.pdf"
    source.write_bytes(b"%PDF")
    stat = source.stat()
    cache = tmp_path / "cache"
    json_path = cache / "book.pdf.json"
    tick = 1_700_000_000_000_000_000

    first = Extracted(["one", "two"], [Place("page 1", 1), Place("page 2", 2)])
    file_text._write(cache, "book.pdf", first, stat)
    os.utime(json_path, ns=(tick, tick))
    recorded = json_path.stat()
    assert file_text.place_of(cache, "book.pdf", 1) == Place("page 1", 1)

    # Same lines, pages swapped: the json comes out the same byte count.
    second = Extracted(["one", "two"], [Place("page 2", 2), Place("page 1", 1)])
    file_text._write(cache, "book.pdf", second, stat)
    os.utime(json_path, ns=(tick, tick))
    after = json_path.stat()
    assert (after.st_mtime_ns, after.st_size) == (
        recorded.st_mtime_ns,
        recorded.st_size,
    )

    assert file_text.place_of(cache, "book.pdf", 1) == Place("page 2", 2)


def test_place_of_parses_an_unchanged_entry_once(tmp_path: Path) -> None:
    file_text._load.cache_clear()
    source = tmp_path / "book.pdf"
    source.write_bytes(b"%PDF")
    cache = tmp_path / "cache"
    extracted = Extracted(["one", "two"], [Place("page 1", 1), Place("page 2", 2)])
    file_text._write(cache, "book.pdf", extracted, source.stat())

    file_text.place_of(cache, "book.pdf", 1)
    file_text.place_of(cache, "book.pdf", 2)

    info = file_text._load.cache_info()
    assert info.misses == 1
    assert info.hits >= 1


def test_place_of_answers_none_for_a_dropped_entry(tmp_path: Path) -> None:
    file_text._load.cache_clear()
    source = tmp_path / "book.pdf"
    source.write_bytes(b"%PDF")
    cache = tmp_path / "cache"
    extracted = Extracted(["one"], [Place("page 1", 1)])
    file_text._write(cache, "book.pdf", extracted, source.stat())
    assert file_text.place_of(cache, "book.pdf", 1) is not None

    file_text._drop(cache, "book.pdf")

    assert file_text.place_of(cache, "book.pdf", 1) is None


async def _texts(client: AsyncClient, q: str) -> list[str]:
    response = await client.get("/api/search", params={"q": q})
    assert response.status_code == 200
    return [hit["text"] for hit in response.json()]


def _page(body: str, head: str = "") -> str:
    return f"<html><head>{head}</head><body><p>{body}</p></body></html>"


async def test_a_windows_1252_page_is_found_by_a_word_with_an_umlaut(
    client: AsyncClient, vault: Path
) -> None:
    meta = '<meta charset="windows-1252">'
    (vault / "old.html").write_bytes(_page("ein Bär im Wald", meta).encode("cp1252"))
    # Valid utf-8 under a wrong label reads as utf-8, as main read it.
    (vault / "labelled.html").write_bytes(_page("ein Bär im Feld", meta).encode())

    assert await _texts(client, "Bär") == ["ein Bär im Feld", "ein Bär im Wald"]


async def test_a_page_with_no_or_an_unknown_charset_reads_as_windows_1252(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "bare.html").write_bytes(_page("Käse eins").encode("cp1252"))
    unknown = _page(
        "Käse zwei", '<meta http-equiv="Content-Type" content="text/html; charset=x-nope">'
    )
    (vault / "unknown.html").write_bytes(unknown.encode("cp1252"))

    assert await _texts(client, "Käse") == ["Käse eins", "Käse zwei"]


async def test_a_declared_iso_8859_15_page_is_read_in_its_own_charset(
    client: AsyncClient, vault: Path
) -> None:
    page = _page("une œuvre", '<meta charset="iso-8859-15">')
    (vault / "fr.html").write_bytes(page.encode("iso8859-15"))

    assert await _texts(client, "œuvre") == ["une œuvre"]


async def test_a_windows_1252_epub_chapter_is_found(client: AsyncClient, vault: Path) -> None:
    chapter = (
        '<?xml version="1.0" encoding="windows-1252"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml"><head/>'
        "<body><p>die Bärin schläft</p></body></html>"
    )
    (vault / "book.epub").write_bytes(epub([chapter.encode("cp1252")]))

    assert await _texts(client, "schläft") == ["die Bärin schläft"]


async def test_a_nul_byte_beside_a_word_does_not_hide_the_file_from_search(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "page.html").write_bytes(_page("a \x00needle here").encode())
    (vault / "book.epub").write_bytes(epub([xhtml("<p>a needle\x00 there</p>")]))

    assert sorted(await _texts(client, "needle")) == ["a needle here", "a needle there"]


async def test_an_entry_cached_empty_before_the_fix_is_read_again_once_its_file_is_touched(
    client: AsyncClient, vault: Path
) -> None:
    page = vault / "old.html"
    page.write_bytes(_page("ein Bär").encode("cp1252"))
    file_text._write(vault.parent / "text-cache", "old.html", Extracted([], []), page.stat())
    assert await _texts(client, "Bär") == []

    later = page.stat().st_mtime_ns + 1_000_000_000
    os.utime(page, ns=(later, later))

    assert await _texts(client, "Bär") == ["ein Bär"]
