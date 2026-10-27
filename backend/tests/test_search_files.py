"""What `GET /api/search` finds inside the pdf, epub and html files beside the notes.

The files are read into a cache outside the vault, so the rules these tests hold to
are that a line of a book is found where its note's lines are, that the place it
names is where the reader opens, and that the vault itself is left as it was.
"""

import asyncio
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from backend.tests.book_files import epub, pdf, xhtml
from kasten_backend import file_text
from kasten_backend.routes import search as search_route

if TYPE_CHECKING:
    import pytest
    from httpx import AsyncClient


def put(vault: Path, path: str, content: bytes | str) -> Path:
    target = vault / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        target.write_bytes(content)
    else:
        target.write_text(content, encoding="utf-8")
    return target


def cache_of(vault: Path) -> Path:
    """The text cache the `vault` fixture points the app at: beside the vault, never in it."""
    return vault.parent / "text-cache"


def listing(vault: Path) -> set[str]:
    """Every file and folder in the vault, as paths from its root."""
    found: set[str] = set()
    for directory, folders, files in os.walk(vault):
        for name in [*folders, *files]:
            found.add(str(Path(directory, name).relative_to(vault)))
    return found


async def search(client: AsyncClient, q: str, **params: Any) -> list[dict[str, Any]]:
    response = await client.get("/api/search", params={"q": q, **params})
    assert response.status_code == 200
    return response.json()


async def test_finds_a_line_in_a_pdf_an_epub_and_an_html_page(
    client: AsyncClient, vault: Path
) -> None:
    put(vault, "paper.pdf", pdf([["the needle is here"]]))
    put(vault, "book.epub", epub([xhtml("<p>a needle in a chapter</p>", "Book")]))
    put(vault, "page.html", "<html><body><p>a needle on a page</p></body></html>")

    hits = await search(client, "needle")

    assert sorted((hit["path"], hit["place"]["kind"]) for hit in hits) == [
        ("book.epub", "epub"),
        ("page.html", "html"),
        ("paper.pdf", "pdf"),
    ]


async def test_a_pdf_hit_names_its_page(client: AsyncClient, vault: Path) -> None:
    put(vault, "paper.pdf", pdf([["first page"], ["second page", "the needle"]]))

    (hit,) = await search(client, "needle")

    assert hit["text"] == "the needle"
    assert hit["place"] == {"kind": "pdf", "label": "page 2", "page": 2, "anchor": None}


async def test_an_epub_hit_names_its_chapter_and_how_far_into_the_book(
    client: AsyncClient, vault: Path
) -> None:
    # Lines: "Chapter One", "opening words", "Chapter Two", "the long middle",
    # "needle here". The 61 characters of the book, 50 of them before the needle.
    put(
        vault,
        "book.epub",
        epub(
            [
                xhtml("<h1>Chapter One</h1><p>opening words</p>"),
                xhtml("<h1>Chapter Two</h1><p>the long middle</p><p>needle here</p>"),
            ]
        ),
    )

    (hit,) = await search(client, "needle")

    assert hit["place"] == {
        "kind": "epub",
        "label": "Chapter Two, 81%",
        "page": None,
        "anchor": None,
    }


async def test_an_html_hit_names_the_heading_above_it_and_its_anchor(
    client: AsyncClient, vault: Path
) -> None:
    put(
        vault,
        "page.html",
        "<html><head><title>Doc</title></head><body>"
        '<p>before any heading</p><h2 id="sec-2">Second</h2>'
        "<p>a needle under it</p></body></html>",
    )

    (hit,) = await search(client, "needle")

    assert hit["place"] == {"kind": "html", "label": "Second", "page": None, "anchor": "sec-2"}


async def test_a_file_hit_is_under_the_path_of_its_folder(client: AsyncClient, vault: Path) -> None:
    put(vault, "projects/paper.pdf", pdf([["needle"]]))

    (hit,) = await search(client, "needle")

    assert hit["path"] == "projects/paper.pdf"


async def test_the_archive_is_left_out_unless_asked_for(client: AsyncClient, vault: Path) -> None:
    put(vault, "98 Archive/old.pdf", pdf([["needle"]]))

    assert await search(client, "needle") == []
    (hit,) = await search(client, "needle", archive="true")
    assert hit["path"] == "98 Archive/old.pdf"


async def test_a_file_hit_takes_the_tags_of_its_note(client: AsyncClient, vault: Path) -> None:
    put(vault, "2026-02-14 paper.md", "#research\n")
    put(vault, "2026-02-14 paper.pdf", pdf([["needle"]]))

    (hit,) = await search(client, "needle")

    assert hit["tags"] == ["#research"]


async def test_a_file_hit_takes_the_date_of_its_note_when_it_has_one(
    client: AsyncClient, vault: Path
) -> None:
    # The note is `paper.md`, the file's own name with the suffix swapped. Its date
    # comes from `created`, which the file's modification time would not give.
    put(vault, "paper.md", "---\ncreated: 2026-02-14\n---\na note\n")
    file = put(vault, "paper.pdf", pdf([["needle"]]))
    os.utime(file, (_moment(2026, 1, 5), _moment(2026, 1, 5)))

    (hit,) = await search(client, "needle")

    assert hit["date"] == "2026-02-14"


async def test_a_file_hit_with_no_note_takes_the_modification_time_of_the_file(
    client: AsyncClient, vault: Path
) -> None:
    file = put(vault, "loose.pdf", pdf([["needle"]]))
    os.utime(file, (_moment(2026, 1, 5), _moment(2026, 1, 5)))

    (hit,) = await search(client, "needle")

    assert hit["date"] == "2026-01-05T00:00:00+00:00"
    assert hit["tags"] == []


def _moment(year: int, month: int, day: int) -> float:
    return datetime(year, month, day, tzinfo=UTC).timestamp()


async def test_the_cache_is_outside_the_vault_and_the_vault_is_left_as_it_was(
    client: AsyncClient, vault: Path
) -> None:
    put(vault, "paper.pdf", pdf([["needle"]]))
    before = listing(vault)

    await search(client, "needle")

    assert listing(vault) == before
    assert (cache_of(vault) / "paper.pdf.txt").read_text(encoding="utf-8") == "needle"
    assert (cache_of(vault) / "paper.pdf.json").is_file()


async def test_a_changed_file_is_extracted_again(client: AsyncClient, vault: Path) -> None:
    put(vault, "paper.pdf", pdf([["alpha"]]))
    assert [hit["text"] for hit in await search(client, "alpha")] == ["alpha"]

    put(vault, "paper.pdf", pdf([["beta is longer now"]]))

    assert await search(client, "alpha") == []
    assert [hit["text"] for hit in await search(client, "beta")] == ["beta is longer now"]


async def test_a_deleted_file_loses_its_cache_entry_on_the_next_query(
    client: AsyncClient, vault: Path
) -> None:
    file = put(vault, "paper.pdf", pdf([["needle"]]))
    await search(client, "needle")
    assert (cache_of(vault) / "paper.pdf.json").is_file()

    file.unlink()
    assert await search(client, "needle") == []

    assert not (cache_of(vault) / "paper.pdf.json").exists()
    assert not (cache_of(vault) / "paper.pdf.txt").exists()


async def test_a_scanned_pdf_with_no_text_is_not_extracted_again(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    put(vault, "scan.pdf", pdf([[]]))
    extractions: list[Path] = []
    extract = file_text._pdf_text

    def counting(path: Path) -> file_text.Extracted:
        extractions.append(path)
        return extract(path)

    monkeypatch.setattr(file_text, "_pdf_text", counting)

    assert await search(client, "anything") == []
    assert await search(client, "anything") == []

    assert len(extractions) == 1
    assert (cache_of(vault) / "scan.pdf.json").is_file()


async def test_text_past_the_cap_is_not_searched(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(file_text, "MOST_CHARS", 10)
    put(vault, "long.pdf", pdf([["short", "needle beyond cap"]]))

    assert [hit["text"] for hit in await search(client, "short")] == ["short"]
    # Cut to the five characters left after "short", so the word is gone.
    assert await search(client, "needle") == []


async def test_a_file_that_will_not_extract_gives_no_hits_and_no_error(
    client: AsyncClient, vault: Path
) -> None:
    put(vault, "fake.pdf", b"%PDF-1.7 not really a pdf, but with its magic")
    put(vault, "broken.epub", b"PK\x03\x04 not really a zip")
    put(vault, "note.md", "a needle in a note\n")

    hits = await search(client, "needle")

    assert [hit["path"] for hit in hits] == ["note.md"]


async def test_a_blank_query_answers_nothing_and_extracts_nothing(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    refreshed: list[object] = []

    async def refuse(*args: object) -> None:
        refreshed.append(args)

    monkeypatch.setattr(file_text, "refresh", refuse)
    put(vault, "paper.pdf", pdf([["needle"]]))

    assert await search(client, " ") == []
    assert refreshed == []


async def test_notes_come_first_and_the_total_is_capped(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cap = 3
    monkeypatch.setattr("kasten_backend.search.MOST_HITS", cap)
    monkeypatch.setattr(search_route, "MOST_HITS", cap)
    put(vault, "note.md", "derived one\nderived two\n")
    put(vault, "paper.pdf", pdf([["derived a", "derived b", "derived c"]]))

    hits = await search(client, "derived")

    assert [hit["path"] for hit in hits] == ["note.md", "note.md", "paper.pdf"]
    assert len(hits) == cap


async def test_two_queries_over_a_cold_cache_both_answer_and_leave_a_whole_entry(
    client: AsyncClient, vault: Path
) -> None:
    put(vault, "paper.pdf", pdf([["first line", "needle line"], ["second page"]]))

    first, second = await asyncio.gather(search(client, "needle"), search(client, "needle"))

    assert [hit["text"] for hit in first] == ["needle line"]
    assert [hit["text"] for hit in second] == ["needle line"]
    entry = json.loads((cache_of(vault) / "paper.pdf.json").read_text(encoding="utf-8"))
    text = (cache_of(vault) / "paper.pdf.txt").read_text(encoding="utf-8")
    assert text.split("\n") == ["first line", "needle line", "second page"]
    assert entry["places"] == [[1, "page 1", 1, None], [3, "page 2", 2, None]]


async def test_script_and_style_text_is_not_searched(client: AsyncClient, vault: Path) -> None:
    put(
        vault,
        "page.html",
        "<html><head><style>.hiddenword { color: red }</style>"
        "<script>var hiddenword = 1;</script></head>"
        "<body><p>visible hiddenword here</p>"
        "<noscript>hiddenword</noscript></body></html>",
    )

    hits = await search(client, "hiddenword")

    assert [hit["text"] for hit in hits] == ["visible hiddenword here"]


async def test_an_upper_case_suffix_is_listed_and_searched(
    client: AsyncClient, vault: Path
) -> None:
    put(vault, "Plan.PDF", pdf([["the needle"]]))

    (hit,) = await search(client, "needle")

    assert hit["path"] == "Plan.PDF"
    assert hit["place"]["kind"] == "pdf"
