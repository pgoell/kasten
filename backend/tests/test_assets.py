from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

BOOK = b"PK\x03\x04 not really a book"
"""Enough bytes to tell one response from another. Nothing on this path opens one."""


async def test_reads_a_book_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "books").mkdir()
    (vault / "books" / "DDIA.epub").write_bytes(BOOK)

    response = await client.get("/api/assets/books/DDIA.epub")

    assert response.status_code == 200
    assert response.content == BOOK


async def test_reports_a_book_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.get("/api/assets/books/missing.epub")

    assert response.status_code == 404


async def test_refuses_a_directory_named_like_a_book(client: AsyncClient, vault: Path) -> None:
    # Without the `is_file` check starlette raises inside `FileResponse.__call__`
    # and the client gets a 500 where it should get a 404.
    (vault / "books").mkdir()
    (vault / "books" / "x.epub").mkdir()

    response = await client.get("/api/assets/books/x.epub")

    assert response.status_code == 404


async def test_refuses_a_note(client: AsyncClient, vault: Path) -> None:
    # The two resolvers cannot be used for each other.
    (vault / "index.md").write_text("# index")

    response = await client.get("/api/assets/index.md")

    assert response.status_code == 404


async def test_refuses_to_climb_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    (vault.parent / "outside.epub").write_bytes(BOOK)

    response = await client.get("/api/assets/%2E%2E%2Foutside.epub")

    assert response.status_code == 404


async def test_refuses_an_absolute_path(client: AsyncClient, vault: Path) -> None:
    (vault.parent / "outside.epub").write_bytes(BOOK)

    response = await client.get(f"/api/assets/{vault.parent}/outside.epub")

    assert response.status_code == 404


async def test_serves_a_roundabout_path_that_stays_inside(client: AsyncClient, vault: Path) -> None:
    # `_resolve_inside` promises containment, not the rejection of spellings, and
    # `books/../DDIA.epub` lands at the vault root rather than inside `books`.
    (vault / "books").mkdir()
    (vault / "DDIA.epub").write_bytes(BOOK)

    response = await client.get("/api/assets/books/%2E%2E%2FDDIA.epub")

    assert response.status_code == 200
    assert response.content == BOOK


async def test_reports_a_missing_vault_rather_than_raising(
    client: AsyncClient, missing_vault: Path
) -> None:
    response = await client.get("/api/assets/books/DDIA.epub")

    assert response.status_code == 404
