"""The library's list of book notes and the covers inside their epubs."""

import io
import zipfile
from typing import TYPE_CHECKING

from kasten_backend.config import get_settings

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

PNG = b"\x89PNG\r\n\x1a\nnot really a picture"


def epub(opf: str, files: dict[str, bytes] | None = None) -> bytes:
    """A zip holding a container that points at `opf`, and `files` beside it."""
    held = io.BytesIO()
    with zipfile.ZipFile(held, "w") as book:
        book.writestr(
            "META-INF/container.xml",
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        )
        book.writestr("OEBPS/content.opf", opf)
        for name, data in (files or {}).items():
            book.writestr(name, data)
    return held.getvalue()


def package(manifest: str, metadata: str = "") -> str:
    return (
        '<package xmlns="http://www.idpf.org/2007/opf">'
        f"<metadata>{metadata}</metadata><manifest>{manifest}</manifest></package>"
    )


def note(vault: Path, path: str, block: str, body: str = "") -> None:
    target = vault / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"---\n{block}\n---\n# {target.stem}\n{body}")


async def test_lists_book_notes_with_their_reading(client: AsyncClient, vault: Path) -> None:
    note(
        vault,
        "Books/Tech/DDIA.md",
        "type: Book\nauthor: Martin Kleppmann\nreading: epubcfi(/6/4)\n"
        "progress: 0.42\nread_at: 2026-11-05T21:30:00+01:00\ncreated: 2026-10-01T10:00:00+00:00",
        "\n> a passage\n\nChapter 1 ^hl-4bab26\n\n> another\n\nChapter 2 ^hl-886ff1\n",
    )
    (vault / "Books/Tech/DDIA.epub").write_bytes(epub(package("")))
    note(vault, "Notes/Plain.md", "type: Note", "mentions a Book in passing")

    response = await client.get("/api/library")

    assert response.status_code == 200
    assert response.json() == [
        {
            "path": "Books/Tech/DDIA.md",
            "title": "DDIA",
            "author": "Martin Kleppmann",
            "folder": "Books/Tech",
            "status": "reading",
            "chosen": False,
            "progress": 0.42,
            "read_at": "2026-11-05T21:30:00+01:00",
            "created": "2026-10-01T10:00:00+00:00",
            "hidden": False,
            "highlights": 2,
            "current": False,
            "format": "epub",
        }
    ]


async def test_reads_the_status_a_note_chose_over_its_progress(
    client: AsyncClient, vault: Path
) -> None:
    note(vault, "Done.md", "type: Book\nprogress: 1")
    note(vault, "Dropped.md", "type: Book\nprogress: 0.2\nreading: x\nstatus: dropped")
    note(vault, "Next.md", "type: Book\nstatus: want")
    note(vault, "Odd.md", "type: Book\nstatus: maybe")

    rows = {row["title"]: row for row in (await client.get("/api/library")).json()}

    assert rows["Done"]["status"] == "finished"
    assert (rows["Dropped"]["status"], rows["Dropped"]["chosen"]) == ("dropped", True)
    assert rows["Next"]["status"] == "want"
    assert (rows["Odd"]["status"], rows["Odd"]["chosen"]) == ("unread", False)
    assert rows["Done"]["format"] is None


async def test_marks_hidden_books_and_the_current_one(client: AsyncClient, vault: Path) -> None:
    note(vault, "Shelf/Kept.md", "type: Book\nhidden: false")
    note(vault, "Shelf/Gone.md", "type: Book\nhidden: true")
    config = vault / get_settings().config_path
    config.mkdir(parents=True)
    (config / "reading-now.md").write_text("Now: [[Kept]]\n")

    rows = {row["title"]: row for row in (await client.get("/api/library")).json()}

    assert (rows["Kept"]["hidden"], rows["Kept"]["current"]) == (False, True)
    assert (rows["Gone"]["hidden"], rows["Gone"]["current"]) == (True, False)


async def test_leaves_the_archive_out(client: AsyncClient, vault: Path) -> None:
    note(vault, f"{get_settings().archive_path}/Old.md", "type: Book")

    assert (await client.get("/api/library")).json() == []


async def test_serves_the_cover_an_epub3_marks(client: AsyncClient, vault: Path) -> None:
    note(vault, "DDIA.md", "type: Book")
    opf = package(
        '<item id="c" href="images/front.png" media-type="image/png" properties="cover-image"/>'
    )
    (vault / "DDIA.epub").write_bytes(epub(opf, {"OEBPS/images/front.png": PNG}))

    response = await client.get("/api/library/cover/DDIA.md")

    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    again = await client.get(
        "/api/library/cover/DDIA.md", headers={"If-None-Match": response.headers["etag"]}
    )
    assert again.status_code == 304


async def test_serves_the_cover_an_epub2_meta_names(client: AsyncClient, vault: Path) -> None:
    note(vault, "Old.md", "type: Book")
    item = '<item id="pic" href="p.jpg" media-type="image/jpeg"/>'
    opf = package(item, '<meta name="cover" content="pic"/>')
    (vault / "Old.epub").write_bytes(epub(opf, {"OEBPS/p.jpg": b"\xff\xd8\xff jpeg"}))

    response = await client.get("/api/library/cover/Old.md")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"


async def test_refuses_an_svg_cover_and_a_book_without_one(
    client: AsyncClient, vault: Path
) -> None:
    note(vault, "Svg.md", "type: Book")
    opf = package('<item id="c" href="c.svg" media-type="image/svg+xml" properties="cover-image"/>')
    (vault / "Svg.epub").write_bytes(epub(opf, {"OEBPS/c.svg": b"<svg/>"}))
    note(vault, "Bare.md", "type: Book")
    (vault / "Bare.epub").write_bytes(epub(package("")))
    note(vault, "Paper.md", "type: Book")
    (vault / "Paper.pdf").write_bytes(b"%PDF-1.7")

    for name in ("Svg", "Bare", "Paper", "Missing"):
        response = await client.get(f"/api/library/cover/{name}.md")
        assert response.status_code == 404, name
