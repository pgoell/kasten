from typing import TYPE_CHECKING

import pytest

from backend.tests.asset_bodies import BOOK, PDF, PNG

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
    # An svg is markup a browser runs, and the table is what keeps it out.
    response = await client.post("/api/assets/shot.svg", content=b"<svg/>")

    assert response.status_code == 400
    assert response.json()["detail"] == "The vault will not take that path"
    assert not (vault / "shot.svg").exists()


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
