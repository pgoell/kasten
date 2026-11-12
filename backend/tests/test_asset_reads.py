from typing import TYPE_CHECKING

import pytest

from backend.tests.asset_bodies import BOOK, MP4, PDF, PNG, WEBM

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


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


async def test_reads_an_asset_whose_suffix_is_upper_case(client: AsyncClient, vault: Path) -> None:
    (vault / "Plan.PDF").write_bytes(PDF)

    response = await client.get("/api/assets/Plan.PDF")

    assert response.status_code == 200
    assert response.content == PDF
    assert response.headers["content-type"] == "application/pdf"


@pytest.mark.parametrize(
    ("name", "body", "kind"),
    [
        ("clips/walk.mp4", MP4, "video/mp4"),
        ("clips/walk.webm", WEBM, "video/webm"),
        ("clips/WALK.MP4", MP4, "video/mp4"),
    ],
)
async def test_a_video_lands_and_reads_back_whole(
    client: AsyncClient, vault: Path, name: str, body: bytes, kind: str
) -> None:
    assert (await client.post(f"/api/assets/{name}", content=body)).status_code == 201

    response = await client.get(f"/api/assets/{name}")

    assert response.status_code == 200
    assert response.content == body
    assert response.headers["content-type"] == kind
    assert response.headers["accept-ranges"] == "bytes"
    assert name in (await client.get("/api/vault-assets")).json()
    assert name not in (await client.get("/api/images")).json()


@pytest.mark.parametrize("brand", [b"isom", b"iso2", b"iso6", b"mp41", b"mp42", b"avc1", b"dash"])
async def test_an_mp4_lands_under_each_brand_a_camera_or_encoder_writes(
    client: AsyncClient, vault: Path, brand: bytes
) -> None:
    body = b"\x00\x00\x00\x18ftyp" + brand + bytes(12)

    assert (await client.post("/api/assets/c.mp4", content=body)).status_code == 201


@pytest.mark.parametrize(
    ("name", "body"),
    [
        ("c.mp4", PNG),
        ("c.mp4", WEBM),
        ("c.mp4", b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  "),
        ("c.mp4", b"\x00\x00\x00\x143gp5" + bytes(16)),
        ("c.webm", MP4),
        ("c.webm", PNG),
        ("c.webm", WEBM.replace(b"\x84webm", b"\x88matroska")),
    ],
)
async def test_refuses_a_video_whose_bytes_are_another_kind(
    client: AsyncClient, vault: Path, name: str, body: bytes
) -> None:
    response = await client.post(f"/api/assets/{name}", content=body)

    assert response.status_code == 400
    assert not (vault / name).exists()


@pytest.mark.parametrize(("name", "body"), [("walk.mp4", MP4), ("walk.webm", WEBM)])
async def test_a_video_answers_a_range_so_a_player_can_seek(
    client: AsyncClient, vault: Path, name: str, body: bytes
) -> None:
    (vault / name).write_bytes(body)

    part = await client.get(f"/api/assets/{name}", headers={"Range": "bytes=10-29"})
    tail = await client.get(f"/api/assets/{name}", headers={"Range": "bytes=-5"})
    past = await client.get(f"/api/assets/{name}", headers={"Range": f"bytes={len(body)}-"})

    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 10-29/{len(body)}"
    assert part.content == body[10:30]
    assert tail.content == body[-5:]
    assert past.status_code == 416
    assert past.headers["content-range"] == f"bytes */{len(body)}"


@pytest.mark.parametrize(
    ("name", "body"),
    [("a.png", PNG), ("b.epub", BOOK), ("c.pdf", PDF), ("d.mp3", b"ID3 sound")],
)
async def test_a_plain_get_of_another_kind_still_answers_whole(
    client: AsyncClient, vault: Path, name: str, body: bytes
) -> None:
    (vault / name).write_bytes(body)

    response = await client.get(f"/api/assets/{name}")

    assert response.status_code == 200
    assert response.content == body
    assert "content-range" not in response.headers


async def test_a_deleted_video_goes_to_the_trash(client: AsyncClient, vault: Path) -> None:
    (vault / "walk.mp4").write_bytes(MP4)

    response = await client.delete("/api/assets/walk.mp4")

    assert response.status_code == 200
    assert not (vault / "walk.mp4").exists()
