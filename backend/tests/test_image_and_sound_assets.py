from typing import TYPE_CHECKING

import pytest

from backend.tests.asset_bodies import BOOK, PDF, PNG
from kasten_backend.vault import fits

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_an_image_lands_and_reads_back(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/99 Misc/shot.png", content=PNG)

    assert response.status_code == 201

    read = await client.get("/api/assets/99 Misc/shot.png")

    assert read.status_code == 200
    assert read.content == PNG
    assert read.headers["content-type"] == "image/png"


async def test_refuses_an_image_whose_bytes_are_a_book(client: AsyncClient, vault: Path) -> None:
    # The magic is picked by the suffix, so a name and a body that disagree are
    # refused whichever way round they disagree.
    response = await client.post("/api/assets/shot.png", content=BOOK)

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert not (vault / "shot.png").exists()


async def test_refuses_a_suffix_the_table_does_not_hold(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/shot.bmp", content=b"BM bitmap")

    assert response.status_code == 400
    assert response.json()["detail"] == "The vault will not take that path"
    assert not (vault / "shot.bmp").exists()


SVG_ROOT = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5"/></svg>'


@pytest.mark.parametrize(
    "head",
    [
        b"",
        b"\xef\xbb\xbf",
        b'<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n',
        b'\xef\xbb\xbf<?xml version="1.0"?>\r\n<!-- Made in Inkscape -->\n',
        b'<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" '
        b'"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n',
        b'<!DOCTYPE svg [ <!ENTITY a "b"> ]>',
        b"<!-- a - comment -- with dashes --->\n\t  ",
        b"<!--" + b"x" * 900 + b"-->",
    ],
    ids=["bare", "bom", "prolog", "bom-prolog-comment", "doctype", "subset", "dashes", "long"],
)
async def test_an_svg_lands_behind_any_head_a_drawing_tool_writes(
    client: AsyncClient, vault: Path, head: bytes
) -> None:
    response = await client.post("/api/assets/pics/logo.svg", content=head + SVG_ROOT)

    assert response.status_code == 201
    assert (vault / "pics" / "logo.svg").read_bytes() == head + SVG_ROOT


@pytest.mark.parametrize(
    "body",
    [
        b"<html><body><svg></svg></body></html>",
        b"just some text, <svg> later",
        b'<?xml version="1.0"?><note>svg</note>',
        b"<svgfoo/>",
        b"<SVG/>",
        b"<!-- unclosed <svg/>",
        b"<!--" + b"x" * 1100 + b"--><svg/>",
        "<svg/>".encode("utf-16"),
        PNG,
    ],
    ids=["html", "text", "xml", "svgfoo", "upper", "unclosed", "past-head", "utf16", "png"],
)
async def test_refuses_an_svg_that_is_other_text(
    client: AsyncClient, vault: Path, body: bytes
) -> None:
    response = await client.post("/api/assets/logo.svg", content=body)

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert not (vault / "logo.svg").exists()


def test_the_svg_check_backtracks_in_linear_time() -> None:
    # A comment may not swallow the next: with one that could, these 128 would split 2**127 ways.
    head = b"<!--a-->" * 128 + b"x"

    assert not fits(".svg", head)
    assert not fits(".svg", b"<!--" * 300)
    assert not fits(".svg", b"<?xml" * 300)
    # A doctype's blank space before its `>` is read one way only, or these split 2**100 ways.
    assert not fits(".svg", b"<!doctype" + b" ><!doctype" * 100)


async def test_an_svg_is_served_so_its_script_cannot_run(client: AsyncClient, vault: Path) -> None:
    (vault / "LOGO.SVG").write_bytes(SVG_ROOT)

    whole = await client.get("/api/assets/LOGO.SVG")
    part = await client.get("/api/assets/LOGO.SVG", headers={"Range": "bytes=0-3"})

    for answer in (whole, part):
        assert answer.headers["content-type"] == "image/svg+xml"
        policy = answer.headers["content-security-policy"]
        assert "default-src 'none'" in policy
        assert "sandbox" in policy
        assert "script-src" not in policy
        assert answer.headers["x-content-type-options"] == "nosniff"
    assert whole.content == SVG_ROOT
    assert part.status_code == 206


async def test_a_png_and_a_pdf_answer_without_the_svg_headers(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "shot.png").write_bytes(PNG)
    (vault / "SICP.pdf").write_bytes(PDF)

    for name, kind in (("shot.png", "image/png"), ("SICP.pdf", "application/pdf")):
        answer = await client.get(f"/api/assets/{name}")
        assert answer.headers["content-type"] == kind
        assert "content-security-policy" not in answer.headers


async def test_an_svg_dropped_in_is_listed_as_an_image(client: AsyncClient, vault: Path) -> None:
    (vault / "pics").mkdir()
    (vault / "pics" / "logo.svg").write_bytes(SVG_ROOT)
    (vault / "LOGO.SVG").write_bytes(SVG_ROOT)

    images = await client.get("/api/images")
    assets = await client.get("/api/vault-assets")

    assert images.json() == ["LOGO.SVG", "pics/logo.svg"]
    assert assets.json() == ["LOGO.SVG", "pics/logo.svg"]


async def test_takes_a_jpeg_whose_magic_is_shorter_than_the_head(
    client: AsyncClient, vault: Path
) -> None:
    # Three bytes against a head of eight, so this is what says the comparison
    # is a prefix rather than the whole of what was read.
    response = await client.post("/api/assets/shot.jpg", content=b"\xff\xd8\xff and the rest")

    assert response.status_code == 201


async def test_lists_the_images_in_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "99 Misc").mkdir()
    (vault / "99 Misc" / "shot.png").write_bytes(PNG)
    (vault / "note.md").write_text("# note")
    (vault / "DDIA.epub").write_bytes(BOOK)
    (vault / "SICP.pdf").write_bytes(PDF)

    response = await client.get("/api/images")

    # The note and both books sit out: the listing is what a `![](` completes
    # against and what the file tree draws, and none of the three is an image.
    # The pdf is the one that gets in when the image suffixes subtract a single
    # book format rather than the whole tuple.
    assert response.status_code == 200
    assert response.json() == ["99 Misc/shot.png"]


async def test_lists_every_asset_in_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "99 Misc").mkdir()
    (vault / "99 Misc" / "shot.png").write_bytes(PNG)
    (vault / "note.md").write_text("# note")
    (vault / "report.html").write_text("<p>report</p>")
    (vault / "DDIA.epub").write_bytes(BOOK)
    (vault / "SICP.pdf").write_bytes(PDF)

    response = await client.get("/api/vault-assets")

    # The books are in, where `/api/images` leaves them out: this is what the
    # editor reads to draw `[[SICP.pdf]]` live.
    assert response.status_code == 200
    assert response.json() == ["99 Misc/shot.png", "DDIA.epub", "SICP.pdf"]


async def test_lists_an_asset_whose_suffix_is_upper_case(client: AsyncClient, vault: Path) -> None:
    # A file copied in over the terminal keeps the name it came with, and
    # Obsidian finds it whatever the case of its suffix.
    (vault / "Plan.PDF").write_bytes(PDF)

    response = await client.get("/api/vault-assets")

    assert response.json() == ["Plan.PDF"]


async def test_lists_an_image_whose_suffix_is_upper_case(client: AsyncClient, vault: Path) -> None:
    (vault / "PHOTO.PNG").write_bytes(PNG)
    (vault / "Plan.PDF").write_bytes(PDF)

    response = await client.get("/api/images")

    assert response.json() == ["PHOTO.PNG"]


@pytest.mark.parametrize(
    ("name", "body"),
    [
        ("a.mp3", b"ID3\x04\x00 tagged"),
        ("b.mp3", b"\xff\xfb\x90\x00 bare frame"),
        ("c.ogg", b"OggS\x00 page"),
        ("d.m4a", b"\x00\x00\x00\x20ftypM4A box"),
        ("e.wav", b"RIFF\x24\x00\x00\x00WAVEfmt "),
    ],
)
async def test_a_sound_lands(client: AsyncClient, vault: Path, name: str, body: bytes) -> None:
    response = await client.post(f"/api/assets/{name}", content=body)

    assert response.status_code == 201
    assert (vault / name).read_bytes() == body


async def test_refuses_a_sound_whose_bytes_are_an_image(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/a.mp3", content=PNG)

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert not (vault / "a.mp3").exists()


async def test_lists_no_sound_among_the_images(client: AsyncClient, vault: Path) -> None:
    # `/api/images` is what a `![](` completes against; a sound is a file the
    # vault takes, but no image.
    (vault / "shot.png").write_bytes(PNG)
    (vault / "meow.mp3").write_bytes(b"ID3")

    images = await client.get("/api/images")
    assets = await client.get("/api/vault-assets")

    assert images.json() == ["shot.png"]
    assert assets.json() == ["meow.mp3", "shot.png"]


async def test_takes_an_upload_whose_suffix_is_upper_case(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/assets/X.PNG", content=PNG)

    assert response.status_code == 201
    assert (vault / "X.PNG").read_bytes() == PNG


async def test_refuses_an_upper_case_upload_whose_bytes_disagree(
    client: AsyncClient, vault: Path
) -> None:
    # The magic is looked up by the lowered suffix, so the check still runs.
    response = await client.post("/api/assets/X.PNG", content=PDF)

    assert response.status_code == 400
    assert response.json()["detail"] == "That file is not what its name says"
    assert not (vault / "X.PNG").exists()


async def test_a_note_s_suffix_still_matches_exactly(client: AsyncClient, vault: Path) -> None:
    # The assets ignore case and the notes do not: `NOTES.MD` stays out of the
    # tree and cannot be read as a note.
    (vault / "NOTES.MD").write_text("# notes")

    assert (await client.get("/api/files")).json() == []
    assert (await client.get("/api/files/NOTES.MD")).status_code == 404
