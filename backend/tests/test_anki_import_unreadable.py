import io
import struct
import zipfile
from typing import TYPE_CHECKING

import pytest

from backend.tests.anki_build import CAT_EXPORT, apkg, deflated, zipped
from kasten_backend import anki

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def headers(export: bytes, member: str) -> tuple[int, int, int]:
    """Where `member`'s local header, its central entry and its data start in `export`."""
    with zipfile.ZipFile(io.BytesIO(export)) as bundle:
        infos = bundle.infolist()
        index = next(i for i, info in enumerate(infos) if info.filename == member)
        central = bundle.start_dir + sum(
            46 + len(info.filename.encode()) + len(info.extra) + len(info.comment)
            for info in infos[:index]
        )
        local = infos[index].header_offset
    names, extra = struct.unpack_from("<2H", export, local + 26)
    return local, central, local + 30 + names + extra


def broken(
    export: bytes,
    member: str,
    *,
    flags: int = 0,
    method: int | None = None,
    version: int | None = None,
    data: bytes = b"",
) -> bytes:
    """`export` with `member` patched: `flags` and `method` in both its headers, the
    `version` needed in its central entry, or its stored bytes begun with `data`.

    Python writes no encrypted and no deflate64 member, so these patch one it wrote.
    """
    local, central, start = headers(export, member)
    out = bytearray(export)
    out[local + 6] |= flags
    out[central + 8] |= flags
    if method is not None:
        struct.pack_into("<H", out, local + 8, method)
        struct.pack_into("<H", out, central + 10, method)
    if version is not None:
        out[central + 6] = version
    out[start : start + len(data)] = data
    return bytes(out)


def cut_short() -> bytes:
    """An export whose collection states a size past the end of the zip, so its read runs out.

    zipfile refuses a size that runs into the next member, except where a
    second entry starts at the same header, and there it only warns: `x` is
    that entry.
    """
    blob = zipfile.ZipFile(io.BytesIO(apkg())).read("collection.anki2")
    export = zipped("collection.anki2", blob, ("x", b""))
    _, central, _ = headers(export, "collection.anki2")
    _, other, _ = headers(export, "x")
    out = bytearray(export)
    struct.pack_into("<2L", out, central + 20, 2 * len(export), 2 * len(export))
    struct.pack_into("<L", out, other + 42, 0)
    return bytes(out)


UNREADABLE = {
    # A first byte of block type 3, which deflate does not have.
    "deflate": broken(deflated(apkg()), "collection.anki2", data=b"\xff"),
    "encrypted": broken(apkg(), "collection.anki2", flags=0x1),
    "deflate64": broken(deflated(apkg()), "collection.anki2", method=9),
    "cut-short": cut_short(),
    "crc": broken(apkg(), "collection.anki2", data=b"X"),
    # Past zipfile's own four bytes, an lc/lp/pb byte no LZMA allows.
    "lzma": broken(
        deflated(apkg(), zipfile.ZIP_LZMA), "collection.anki2", data=b"\x09\x04\x05\x00\xff"
    ),
    "bzip2": broken(deflated(apkg(), zipfile.ZIP_BZIP2), "collection.anki2", data=b"XXXX"),
    "zstd": broken(deflated(apkg(), zipfile.ZIP_ZSTANDARD), "collection.anki2", data=b"XXXX"),
    # zipfile reads up to version 6.3 and refuses the whole directory past it.
    "version": broken(apkg(), "collection.anki2", version=64),
}
"""Exports zipfile cannot read a member of, each in its own way."""


@pytest.fixture
def directory_reads(monkeypatch: pytest.MonkeyPatch) -> list[zipfile.ZipFile]:
    """Every zip whose directory zipfile reads from here on, an object built per entry."""
    reads: list[zipfile.ZipFile] = []
    real = zipfile.ZipFile._RealGetContents  # ty: ignore[unresolved-attribute]

    def counted(self: zipfile.ZipFile) -> None:
        reads.append(self)
        real(self)

    monkeypatch.setattr(zipfile.ZipFile, "_RealGetContents", counted)
    return reads


async def test_b1_an_export_past_the_count_cap_is_refused_before_its_directory_is_read(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
) -> None:
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=CAT_EXPORT)

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert directory_reads == []


async def test_b2_a_corrupt_deflate_stream_is_refused(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=UNREADABLE["deflate"])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


async def test_b3_an_encrypted_member_is_refused(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=UNREADABLE["encrypted"])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


async def test_b4_a_deflate64_member_is_refused(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=UNREADABLE["deflate64"])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


@pytest.mark.parametrize("case", ["cut-short", "crc", "lzma", "bzip2", "zstd", "version"])
async def test_b5_every_other_unreadable_export_is_refused(
    client: AsyncClient, vault: Path, case: str
) -> None:
    response = await client.post("/api/anki", content=UNREADABLE[case])

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")


@pytest.mark.parametrize("case", UNREADABLE)
async def test_b6_an_unreadable_export_writes_no_note_and_no_media(
    client: AsyncClient, vault: Path, case: str
) -> None:
    response = await client.post("/api/anki", content=UNREADABLE[case])

    assert response.status_code == 400
    assert not (vault / "03 Flashcards").exists()


async def test_i1_a_record_that_understates_its_count_is_refused_all_the_same(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
) -> None:
    # zipfile reads the directory by its size, so a count of 1 hides the other five.
    export = bytearray(CAT_EXPORT)
    struct.pack_into("<2H", export, len(export) - 22 + 8, 1, 1)
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=bytes(export))

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert directory_reads == []


async def test_i1_a_zip64_record_that_understates_its_count_is_refused_all_the_same(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
) -> None:
    # Both counts of the zip64 record, 56 bytes before its 20-byte locator and
    # the plain record, say 1; the directory still holds six.
    export = bytearray(rewritten(CAT_EXPORT, zip64=True))
    directory_reads.clear()  # the rewrite's own read of CAT_EXPORT
    struct.pack_into("<2Q", export, len(export) - 22 - 20 - 56 + 24, 1, 1)
    # So only the walk can refuse it: the record zipfile resolves counts 1.
    end = zipfile._EndRecData(io.BytesIO(bytes(export)))  # ty: ignore[unresolved-attribute]
    assert (end[0], end[4]) == (b"PK\x06\x06", 1)
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 2, raising=False)

    response = await client.post("/api/anki", content=bytes(export))

    assert response.status_code == 400
    assert response.json()["detail"] == "Anki export too large: it holds more than 2 files"
    assert directory_reads == []


def rewritten(export: bytes, *, zip64: bool = False, comment: bytes = b"") -> bytes:
    """`export` written again with a zip `comment`, or with a zip64 end record."""
    buffer = io.BytesIO()
    with pytest.MonkeyPatch.context() as patch:
        if zip64:
            # zipfile writes the zip64 record only past this many members.
            patch.setattr(zipfile, "ZIP_FILECOUNT_LIMIT", 0)
        with (
            zipfile.ZipFile(io.BytesIO(export)) as source,
            zipfile.ZipFile(buffer, "w") as bundle,
        ):
            bundle.comment = comment
            for info in source.infolist():
                bundle.writestr(info.filename, source.read(info))
    out = bytearray(buffer.getvalue())
    if zip64:
        # What the plain record says past 65535 members: read the zip64 one.
        struct.pack_into("<2H", out, len(out) - 22 + 8, 0xFFFF, 0xFFFF)
    return bytes(out)


@pytest.mark.parametrize("form", ["zip64", "comment"])
async def test_i2_a_zip64_record_or_a_comment_is_counted_and_imports(
    client: AsyncClient,
    vault: Path,
    monkeypatch: pytest.MonkeyPatch,
    directory_reads: list[zipfile.ZipFile],
    form: str,
) -> None:
    comment = b"from Anki" if form == "comment" else b""
    export = rewritten(CAT_EXPORT, zip64=form == "zip64", comment=comment)
    directory_reads.clear()  # the rewrite's own read of CAT_EXPORT
    # Six members: the collection, the media map, meta and three files.
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 5, raising=False)
    refused = await client.post("/api/anki", content=export)
    assert directory_reads == []
    monkeypatch.setattr(anki, "MEMBER_COUNT_LIMIT", 6, raising=False)

    imported = await client.post("/api/anki", content=export)

    assert refused.status_code == 400
    assert refused.json()["detail"] == "Anki export too large: it holds more than 5 files"
    assert imported.status_code == 201


async def test_i3_a_corrupt_media_file_refuses_the_import(client: AsyncClient, vault: Path) -> None:
    response = await client.post("/api/anki", content=broken(CAT_EXPORT, "0", data=b"X"))

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: 0: ")
    assert not (vault / "03 Flashcards").exists()


@pytest.mark.parametrize("case", [case for case in UNREADABLE if case != "version"])
async def test_i5_the_refusal_names_the_member_it_could_not_read(
    client: AsyncClient, vault: Path, case: str
) -> None:
    response = await client.post("/api/anki", content=UNREADABLE[case])

    assert response.json()["detail"].startswith("unreadable Anki export: collection.anki2: ")


async def test_a7_a_local_header_name_that_is_not_utf_8_names_the_member(
    client: AsyncClient, vault: Path
) -> None:
    # The flag and the bad byte in the local header only, so the directory
    # reads and the member's own open is what fails.
    export = apkg()
    local, _, _ = headers(export, "collection.anki2")
    out = bytearray(export)
    out[local + 7] |= 0x08  # flag bit 0x800, a name in utf-8
    out[local + 30] = 0xFF

    response = await client.post("/api/anki", content=bytes(out))

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: collection.anki2: ")
    assert not (vault / "03 Flashcards").exists()


async def test_a8_a_central_entry_name_that_is_not_utf_8_is_refused(
    client: AsyncClient, vault: Path
) -> None:
    export = apkg()
    _, central, _ = headers(export, "collection.anki2")
    out = bytearray(export)
    out[central + 9] |= 0x08  # flag bit 0x800, a name in utf-8
    out[central + 46] = 0xFF

    response = await client.post("/api/anki", content=bytes(out))

    assert response.status_code == 400
    assert response.json()["detail"].startswith("unreadable Anki export: ")
    assert not (vault / "03 Flashcards").exists()
