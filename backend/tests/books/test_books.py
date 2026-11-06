from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

EPUB = b"PK\x03\x04 not really a book"
PDF = b"%PDF-1.7 not really a book either"


async def test_reads_the_epub_beside_a_note(client: AsyncClient, vault: Path) -> None:
    (vault / "20 Literature").mkdir()
    (vault / "20 Literature" / "DDIA.md").write_text("# DDIA")
    (vault / "20 Literature" / "DDIA.epub").write_bytes(EPUB)

    response = await client.get("/api/books/20 Literature/DDIA.md")

    assert response.status_code == 200
    assert response.content == EPUB
    assert response.headers["x-book-path"] == "20%20Literature/DDIA.epub"


async def test_reads_the_pdf_beside_a_note(client: AsyncClient, vault: Path) -> None:
    (vault / "SICP.md").write_text("# SICP")
    (vault / "SICP.pdf").write_bytes(PDF)

    response = await client.get("/api/books/SICP.md")

    assert response.status_code == 200
    assert response.content == PDF
    assert response.headers["x-book-path"] == "SICP.pdf"
    assert response.headers["content-type"] == "application/pdf"


async def test_takes_the_epub_when_a_note_has_both(client: AsyncClient, vault: Path) -> None:
    # `BOOK_SUFFIXES` is what decides, and the header is how the client learns
    # which of the two it is holding.
    (vault / "DDIA.md").write_text("# DDIA")
    (vault / "DDIA.epub").write_bytes(EPUB)
    (vault / "DDIA.pdf").write_bytes(PDF)

    response = await client.get("/api/books/DDIA.md")

    assert response.status_code == 200
    assert response.content == EPUB
    assert response.headers["x-book-path"] == "DDIA.epub"


async def test_reports_a_note_with_no_book_beside_it(client: AsyncClient, vault: Path) -> None:
    (vault / "DDIA.md").write_text("# DDIA")

    response = await client.get("/api/books/DDIA.md")

    assert response.status_code == 404
    assert response.json()["detail"] == "No book beside that note"


async def test_reports_a_note_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    # Nothing here asks whether the note exists: the book is what was asked for,
    # and a stem with neither suffix beside it answers the same either way.
    response = await client.get("/api/books/nothing/at/all.md")

    assert response.status_code == 404


async def test_refuses_to_climb_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    (vault.parent / "outside.epub").write_bytes(EPUB)

    response = await client.get("/api/books/%2E%2E%2Foutside.md")

    assert response.status_code == 404


async def test_refuses_the_book_path_itself(client: AsyncClient, vault: Path) -> None:
    # The parameter is the note's path, so the swap is the vault's to make. A
    # client handing over the book it already found gets nothing, and
    # `/api/assets/{path}` is the route that reads a file by its own name.
    #
    # The second file is what makes this a test rather than a coincidence. The
    # swap used to be a `removesuffix`, which leaves a path it does not end with
    # alone, so this asked for `DDIA.epub.epub` and then `DDIA.epub.pdf`; with
    # only the epub on disk both missed and the refusal looked deliberate.
    (vault / "DDIA.epub").write_bytes(EPUB)
    (vault / "DDIA.epub.pdf").write_bytes(PDF)

    response = await client.get("/api/books/DDIA.epub")

    assert response.status_code == 404


async def test_refuses_a_path_that_is_not_a_note(client: AsyncClient, vault: Path) -> None:
    # The other half of the same rule: a stem with no suffix at all would have
    # been swapped into `DDIA.epub` and answered, which is a second shape for a
    # route documented as taking one.
    (vault / "DDIA.epub").write_bytes(EPUB)

    response = await client.get("/api/books/DDIA")

    assert response.status_code == 404


async def test_names_a_book_a_header_cannot_carry_as_it_is(
    client: AsyncClient, vault: Path
) -> None:
    # A header goes down the wire as latin-1, so an unencoded umlaut raises on
    # the way out and the read becomes a 500. The client reverses this.
    (vault / "Grundzüge.md").write_text("# Grundzüge")
    (vault / "Grundzüge.pdf").write_bytes(PDF)

    response = await client.get("/api/books/Grundzüge.md")

    assert response.status_code == 200
    assert response.headers["x-book-path"] == "Grundz%C3%BCge.pdf"


async def test_reports_a_missing_vault_rather_than_raising(
    client: AsyncClient, missing_vault: Path
) -> None:
    response = await client.get("/api/books/DDIA.md")

    assert response.status_code == 404


CONFIG = "99 Misc/01 Config"


def _book(vault: Path, name: str, fields: str) -> None:
    (vault / f"{name}.md").write_text(f"---\n{fields}\n---\n# {name}\n")


async def test_reading_answers_the_newest_read_at(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _book(agent_vault, "Old", "reading: epubcfi(/6/2)\nread_at: 2026-10-01T09:00:00+02:00")
    _book(
        agent_vault,
        "New",
        "reading: epubcfi(/6/4)\nprogress: 0.41\nread_at: 2026-11-05T21:30:00+01:00\n"
        "author: Tanya Reilly",
    )
    # A newer time on a note with no position does not count.
    _book(agent_vault, "Shelf", "read_at: 2026-11-06T08:00:00+01:00")

    response = await client.get("/agent/reading", headers=bearer)

    assert response.status_code == 200
    assert response.json() == {
        "title": "New",
        "author": "Tanya Reilly",
        "progress": 0.41,
        "read_at": "2026-11-05T21:30:00+01:00",
    }


async def test_reading_prefers_the_book_reading_now_names(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _book(agent_vault, "New", "reading: epubcfi(/6/4)\nread_at: 2026-11-05T21:30:00+01:00")
    _book(agent_vault, "Named", "reading: epubcfi(/6/2)\nread_at: 2026-10-01T09:00:00+02:00")
    (agent_vault / CONFIG).mkdir(parents=True)
    (agent_vault / CONFIG / "reading-now.md").write_text("Now: [[named]] and [[New]]\n")

    response = await client.get("/agent/reading", headers=bearer)

    assert response.json() == {
        "title": "Named",
        "author": None,
        "progress": None,
        "read_at": "2026-10-01T09:00:00+02:00",
    }


async def test_reading_falls_back_when_reading_now_names_no_note(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _book(agent_vault, "New", "reading: epubcfi(/6/4)\nread_at: 2026-11-05T21:30:00+01:00")
    (agent_vault / CONFIG).mkdir(parents=True)
    (agent_vault / CONFIG / "reading-now.md").write_text("[[Nowhere]]\n")

    response = await client.get("/agent/reading", headers=bearer)

    assert response.json()["title"] == "New"


async def test_reading_is_204_when_no_note_qualifies(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    # A position with no time, or a time that is no time, does not qualify.
    _book(agent_vault, "Untimed", "reading: epubcfi(/6/4)")
    _book(agent_vault, "Garbled", "reading: epubcfi(/6/4)\nread_at: yesterday")

    response = await client.get("/agent/reading", headers=bearer)

    assert response.status_code == 204
    assert response.content == b""
