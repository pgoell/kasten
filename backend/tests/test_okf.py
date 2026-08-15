"""What Open Knowledge Format asks of the vault, and what kasten stops doing for it.

The reserved filenames are the whole of this file's first half: OKF gives
`index.md` and `log.md` a shape of their own, so kasten writes no block into one
and the bytes that arrive are the bytes on disk.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_creates_a_root_index_exactly_as_it_was_sent(
    client: AsyncClient, vault: Path
) -> None:
    body = "# The vault\n\n* [Inbox](00%20Inbox/) - notes with nowhere to be yet\n"

    response = await client.post("/api/files/index.md", json={"content": body})

    assert response.status_code == 201
    assert response.json()["content"] == body
    assert (vault / "index.md").read_text(encoding="utf-8") == body


async def test_reserves_the_name_at_every_level(client: AsyncClient, vault: Path) -> None:
    # The last component, not the whole path: a folder's listing is a listing.
    (vault / "folder").mkdir()
    body = "# Folder\n"

    response = await client.post("/api/files/folder/index.md", json={"content": body})

    assert response.json()["content"] == body
    assert (vault / "folder" / "index.md").read_text(encoding="utf-8") == body


async def test_creates_a_log_exactly_as_it_was_sent(client: AsyncClient, vault: Path) -> None:
    body = "# Log\n\n## 2026-08-15\n\nSomething happened.\n"

    response = await client.post("/api/files/log.md", json={"content": body})

    assert response.json()["content"] == body
    assert (vault / "log.md").read_text(encoding="utf-8") == body


async def test_saves_a_reserved_file_without_touching_its_block(
    client: AsyncClient, vault: Path
) -> None:
    # `okf_version` is the one field a reserved file may carry, and a save that
    # added an id beside it would be kasten naming a file it does not own.
    body = '---\nokf_version: "0.2"\n---\n\n# The vault\n'
    (vault / "index.md").write_text(body, encoding="utf-8")

    response = await client.put("/api/files/index.md", json={"content": body})

    assert response.json()["content"] == body
    assert (vault / "index.md").read_text(encoding="utf-8") == body
    assert "id:" not in body


async def test_writes_no_id_into_a_nested_index(client: AsyncClient, vault: Path) -> None:
    (vault / "notes").mkdir()

    await client.post("/api/files/notes/index.md", json={"content": "# Notes\n"})

    assert "id:" not in (vault / "notes" / "index.md").read_text(encoding="utf-8")


async def test_stamps_a_note_renamed_off_a_reserved_name(client: AsyncClient, vault: Path) -> None:
    # The file was exempt because of what it was called. Rename it and it is a
    # note like any other, so it gets the block a note has.
    await client.post("/api/files/index.md", json={"content": "# Was the index\n"})

    response = await client.patch("/api/files/index.md", json={"path": "ideas.md"})

    written = (vault / "ideas.md").read_text(encoding="utf-8")
    assert response.json()["content"] == written
    assert written.startswith("---\n")
    assert "\nid: " in written
    assert "\ncreated: " in written
    assert "\nmodified: " in written
    assert "\ntype: Note\n" in written


async def test_keeps_the_okf_version_a_renamed_index_carried(
    client: AsyncClient, vault: Path
) -> None:
    body = '---\nokf_version: "0.2"\n---\n\n# Was the index\n'
    await client.post("/api/files/index.md", json={"content": body})

    await client.patch("/api/files/index.md", json={"path": "ideas.md"})

    written = (vault / "ideas.md").read_text(encoding="utf-8")
    assert '\nokf_version: "0.2"\n' in written
    assert "\nid: " in written


async def test_leaves_the_block_alone_on_a_rename_onto_a_reserved_name(
    client: AsyncClient, vault: Path
) -> None:
    # The other direction is not handled and must not be. Deleting the block
    # here would delete the note's id and its creation date, and kasten does not
    # delete a field you own. The bundle stops conforming until the file is
    # converted by hand, body and all.
    created = (await client.post("/api/files/ideas.md")).json()["content"]

    await client.patch("/api/files/ideas.md", json={"path": "index.md"})

    assert (vault / "index.md").read_text(encoding="utf-8") == created
