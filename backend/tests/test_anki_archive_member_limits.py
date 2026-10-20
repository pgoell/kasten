import io
import zipfile
from compression import zstd
from typing import TYPE_CHECKING

import pytest

from backend.tests.anki_build import CAT_EXPORT, apkg, deflated, sides, zipped
from kasten_backend import anki
from kasten_backend.anki import read_apkg

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def whole(*args: object, **kwargs: object) -> bytes:
    """What stands in for a whole read, which a bomb gets through before any cap is checked."""
    raise AssertionError("read a member whole rather than counting it as it unpacked")


def unpacked(export: bytes, *members: str) -> int:
    """What reading `members` of `export` spends: the bytes the zip gives, and zstd's besides."""
    total = 0
    with zipfile.ZipFile(io.BytesIO(export)) as bundle:
        for member in members:
            data = bundle.read(member)
            total += len(data)
            if data.startswith(anki.ZSTD_MAGIC):
                total += len(zstd.decompress(data))
    return total


def test_a_collection_of_two_zstd_frames_reads_whole() -> None:
    # `zstd.decompress` reads every frame, and a decompressor stops after one.
    export = apkg(schema18=True, member="collection.anki21b")
    blob = zstd.decompress(zipfile.ZipFile(io.BytesIO(export)).read("collection.anki21b"))
    half = len(blob) // 2
    split = zipped("collection.anki21b", zstd.compress(blob[:half]) + zstd.compress(blob[half:]))

    assert sides(read_apkg(split)) == sides(read_apkg(export))


@pytest.mark.parametrize("layer", ["deflate", "zstd"])
async def test_a4_a_member_unpacking_past_its_cap_is_refused(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch, layer: str
) -> None:
    if layer == "deflate":
        export, cap = deflated(apkg()), 1024
    else:
        # The cap the stored member's own size, so the zip passes and zstd runs over.
        export = apkg(schema18=True, member="collection.anki21b")
        cap = zipfile.ZipFile(io.BytesIO(export)).getinfo("collection.anki21b").file_size
    monkeypatch.setattr(anki, "MEMBER_LIMIT_BYTES", cap, raising=False)
    monkeypatch.setattr(zipfile.ZipFile, "read", whole)
    monkeypatch.setattr(zstd, "decompress", whole)

    response = await client.post("/api/anki", content=export)

    member = "collection.anki2" if layer == "deflate" else "collection.anki21b"
    assert response.status_code == 400
    assert response.json()["detail"] == f"Anki export too large: {member} unpacks past {cap} bytes"
    assert not (vault / "03 Flashcards").exists()


async def test_a5_members_together_past_the_total_cap_are_refused(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Room for the collection to the byte, so the media map after it runs over.
    total = unpacked(CAT_EXPORT, "collection.anki21b")
    monkeypatch.setattr(anki, "TOTAL_LIMIT_BYTES", total, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert response.json()["detail"] == (
        f"Anki export too large: its files unpack past {total} bytes together"
    )
    assert not (vault / "03 Flashcards").exists()


async def test_a6_more_members_than_the_count_cap_are_refused(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert not (vault / "03 Flashcards").exists()


async def test_a7_an_export_refused_at_its_media_writes_no_notes_and_no_media(
    client: AsyncClient, vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Room for the collection and the media map but not one file more, so the
    # refusal comes after every card is read and before any is written.
    total = unpacked(CAT_EXPORT, "collection.anki21b", "media")
    monkeypatch.setattr(anki, "TOTAL_LIMIT_BYTES", total, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert "together" in response.json()["detail"]
    assert not (vault / "03 Flashcards").exists()
