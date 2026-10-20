from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

BOOK = b"%PDF-1.7 not really a book"


async def test_follows_an_asset_in_a_folder_that_moved(client: AsyncClient, vault: Path) -> None:
    (vault / "rehearse").mkdir()
    (vault / "rehearse" / "plan.pdf").write_bytes(BOOK)
    (vault / "index.md").write_text(
        "[[rehearse/plan.pdf]] ![[rehearse/plan.pdf]] [[rehearse/plan.pdf|Plan]]"
        " [[rehearse/plan.pdf#page=2]] [[plan.pdf]]\n"
    )

    await client.patch("/api/folders/rehearse", json={"path": "elsewhere"})

    assert (vault / "index.md").read_text() == (
        "[[elsewhere/plan.pdf]] ![[elsewhere/plan.pdf]] [[elsewhere/plan.pdf|Plan]]"
        " [[elsewhere/plan.pdf#page=2]] [[plan.pdf]]\n"
    )
    assert (vault / "elsewhere" / "plan.pdf").read_bytes() == BOOK


async def test_follows_the_book_a_moved_note_carries(client: AsyncClient, vault: Path) -> None:
    (vault / "a").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "a" / "x.pdf").write_bytes(BOOK)
    (vault / "index.md").write_text("[[a/x.pdf]] ![[a/x.pdf|the book]]\n")

    await client.patch("/api/files/a/x.md", json={"path": "b/x.md"})

    assert (vault / "index.md").read_text() == "[[b/x.pdf]] ![[b/x.pdf|the book]]\n"
    assert (vault / "b" / "x.pdf").read_bytes() == BOOK


async def test_follows_the_book_a_renamed_note_carries_by_its_name(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "x.md").write_text("# x")
    (vault / "x.pdf").write_bytes(BOOK)
    (vault / "index.md").write_text("[[x.pdf]] [[x]]\n")

    await client.patch("/api/files/x.md", json={"path": "y.md"})

    assert (vault / "index.md").read_text() == "[[y.pdf]] [[y]]\n"
    assert (vault / "y.pdf").read_bytes() == BOOK


async def test_leaves_the_links_of_a_book_held_back(client: AsyncClient, vault: Path) -> None:
    # The landing is taken, so the book stays where it is, and so do the links
    # to it: rewriting them would point them at the other book.
    (vault / "a").mkdir()
    (vault / "b").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "a" / "x.pdf").write_bytes(BOOK)
    (vault / "b" / "x.pdf").write_bytes(b"%PDF-1.7 another book")
    (vault / "index.md").write_text("[[a/x.pdf]] [[a/x]]\n")

    await client.patch("/api/files/a/x.md", json={"path": "b/x.md"})

    assert (vault / "index.md").read_text() == "[[a/x.pdf]] [[b/x]]\n"
    assert (vault / "a" / "x.pdf").read_bytes() == BOOK


@pytest.mark.parametrize(
    ("source", "target"),
    [("a/x.md", "b/x.md"), ("a", "c")],
)
async def test_previews_the_files_a_move_with_assets_writes(
    client: AsyncClient, vault: Path, source: str, target: str
) -> None:
    (vault / "a").mkdir()
    (vault / "a" / "x.md").write_text("# x")
    (vault / "a" / "x.pdf").write_bytes(BOOK)
    (vault / "a" / "shot.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (vault / "book.md").write_text("[[a/x.pdf]]\n")
    (vault / "shot.md").write_text("![[a/shot.png]]\n")
    (vault / "none.md").write_text("[[x.pdf]]\n")
    notes = ["a/x.md", "book.md", "shot.md", "none.md"]
    before = {name: (vault / name).read_text() for name in notes}

    response = await client.get("/api/move-preview", params={"source": source, "target": target})
    route = "/api/files/" if source.endswith(".md") else "/api/folders/"
    await client.patch(f"{route}{source}", json={"path": target})

    # `a/x.md` has moved and holds no link, so a file missing now wrote nothing.
    written = sorted(
        name
        for name, text in before.items()
        if (vault / name).exists() and (vault / name).read_text() != text
    )
    assert response.json()["rewrites"] == written
    assert written == (["book.md"] if source == "a/x.md" else ["book.md", "shot.md"])


async def test_follows_a_markdown_link_to_the_book_a_moved_note_carries(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "books").mkdir()
    (vault / "notes").mkdir()
    (vault / "books" / "Ulysses.md").write_text("# Ulysses")
    (vault / "books" / "Ulysses.pdf").write_bytes(BOOK)
    (vault / "notes" / "reading.md").write_text("[the book](../books/Ulysses.pdf)\n")

    await client.patch("/api/files/books/Ulysses.md", json={"path": "shelf/Joyce.md"})

    assert (vault / "shelf" / "Joyce.pdf").read_bytes() == BOOK
    assert (vault / "notes" / "reading.md").read_text() == "[the book](../shelf/Joyce.pdf)\n"


async def test_leaves_a_markdown_link_to_a_book_held_back(client: AsyncClient, vault: Path) -> None:
    # The landing is taken, so the book stays, and the link points where it stays.
    (vault / "books").mkdir()
    (vault / "shelf").mkdir()
    (vault / "books" / "Ulysses.md").write_text("# Ulysses")
    (vault / "books" / "Ulysses.pdf").write_bytes(BOOK)
    (vault / "shelf" / "Joyce.pdf").write_bytes(b"%PDF-1.7 another book")
    (vault / "index.md").write_text("[the book](books/Ulysses.pdf) [the note](books/Ulysses.md)\n")

    await client.patch("/api/files/books/Ulysses.md", json={"path": "shelf/Joyce.md"})

    assert (vault / "books" / "Ulysses.pdf").read_bytes() == BOOK
    assert (vault / "index.md").read_text() == (
        "[the book](books/Ulysses.pdf) [the note](shelf/Joyce.md)\n"
    )


async def test_follows_a_markdown_link_to_a_folder_that_moved(
    client: AsyncClient, vault: Path
) -> None:
    # A folder is in no mapping of files, so its link lands by the move itself.
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "reading" / "plan.pdf").write_bytes(BOOK)
    (vault / "index.md").write_text("[x](reading/) [p](reading/plan.pdf)\n")

    await client.patch("/api/folders/reading", json={"path": "archive"})

    assert (vault / "index.md").read_text() == "[x](archive/) [p](archive/plan.pdf)\n"
