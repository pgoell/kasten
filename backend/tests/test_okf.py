"""What Open Knowledge Format asks of the vault, and what kasten stops doing for it.

The reserved filenames are the whole of this file's first half: OKF gives
`index.md` and `log.md` a shape of their own, so kasten writes no block into one
and the bytes that arrive are the bytes on disk.
"""

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, call

from asgi_lifespan import LifespanManager

from kasten_backend.main import app
from kasten_backend.okf import (
    BACKFILL_LABEL,
    INDEX_GUIDE_PATH,
    ONTOLOGY_PATH,
    READER_PATH,
    backfill,
)

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
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


def note(root: Path, relative: str, text: str) -> Path:
    """Put `text` at `relative` under `root`, making the folders on the way."""
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


async def test_backfill_types_a_note_that_has_no_block(tmp_path: Path) -> None:
    written = note(tmp_path, "borges.md", "# borges\n")

    await backfill(tmp_path)

    assert written.read_text(encoding="utf-8") == "---\ntype: Note\n---\n# borges\n"


async def test_backfill_writes_the_type_and_nothing_else(tmp_path: Path) -> None:
    # Never `modified`, which is why this cannot go through `PUT`: a pass over
    # the vault through the save path would date every note today.
    held = "---\nid: kept\nmodified: 2020-01-01T00:00:00+00:00\n---\n# borges\n"
    written = note(tmp_path, "borges.md", held)

    await backfill(tmp_path)

    after = written.read_text(encoding="utf-8")
    assert "\nmodified: 2020-01-01T00:00:00+00:00\n" in after
    assert "\ntype: Note\n" in after
    assert "\nid: kept\n" in after


async def test_backfill_leaves_the_reserved_names_alone(tmp_path: Path) -> None:
    root = note(tmp_path, "index.md", "# The vault\n")
    log = note(tmp_path, "log.md", "# Log\n")
    nested = note(tmp_path, "folder/index.md", "# Folder\n")

    changed = await backfill(tmp_path)

    assert changed == []
    assert root.read_text(encoding="utf-8") == "# The vault\n"
    assert log.read_text(encoding="utf-8") == "# Log\n"
    assert nested.read_text(encoding="utf-8") == "# Folder\n"


async def test_backfill_does_not_walk_into_a_dot_directory(tmp_path: Path) -> None:
    # `.trash` and the jj repo beside the notes are both hidden, and the walk
    # this reads the vault with skips a hidden directory without entering it.
    binned = note(tmp_path, ".trash/borges.md", "# borges\n")

    await backfill(tmp_path)

    assert binned.read_text(encoding="utf-8") == "# borges\n"


async def test_backfill_changes_nothing_the_second_time(tmp_path: Path) -> None:
    written = note(tmp_path, "borges.md", "# borges\n")
    await backfill(tmp_path)
    once = written.read_text(encoding="utf-8")

    changed = await backfill(tmp_path)

    assert changed == []
    assert written.read_text(encoding="utf-8") == once


async def test_backfill_returns_what_it_changed_in_sorted_order(tmp_path: Path) -> None:
    note(tmp_path, "reading/borges.md", "# borges\n")
    note(tmp_path, "aleph.md", "# aleph\n")
    note(tmp_path, "00 Inbox/zahir.md", "# zahir\n")
    note(tmp_path, "typed.md", "---\ntype: Source\n---\n")

    assert await backfill(tmp_path) == ["00 Inbox/zahir.md", "aleph.md", "reading/borges.md"]


async def test_backfill_records_one_change_for_the_whole_pass(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # One change for the pass rather than one per note. A vault of a thousand
    # untyped notes is one line in `jj log`, not a thousand.
    begin = AsyncMock()
    end = AsyncMock()
    monkeypatch.setattr("kasten_backend.okf.begin_change", begin)
    monkeypatch.setattr("kasten_backend.okf.snapshot", end)
    for name in ("a.md", "b.md", "c.md"):
        note(tmp_path, name, "# note\n")

    await backfill(tmp_path)

    assert begin.await_args_list == [call(tmp_path, BACKFILL_LABEL)]
    assert end.await_count == 1


async def test_backfill_touches_jj_not_at_all_when_it_writes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A boot on an unchanged vault leaves no empty change behind, which is why
    # every rewrite is worked out before anything is written.
    begin = AsyncMock()
    monkeypatch.setattr("kasten_backend.okf.begin_change", begin)
    note(tmp_path, "typed.md", "---\ntype: Source\n---\n")

    assert await backfill(tmp_path) == []
    assert begin.await_count == 0


async def test_startup_writes_the_reader_guide(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    text = (startup_vault / READER_PATH).read_text(encoding="utf-8")

    assert text.startswith("---\n")
    assert "\ntype: Reference\n" in text


async def test_startup_keeps_the_reader_guide_the_vault_already_has(startup_vault: Path) -> None:
    # Typed text and not a bare `mine\n`: the backfill runs in this same
    # lifespan, so a bare one would be typed and the test would be asserting
    # that the pass it sits beside does not run.
    kept = "---\ntype: Reference\n---\nmine\n"
    note(startup_vault, READER_PATH, kept)

    async with LifespanManager(app):
        pass

    assert (startup_vault / READER_PATH).read_text(encoding="utf-8") == kept


async def test_startup_types_a_note_the_vault_already_held(startup_vault: Path) -> None:
    untyped = note(startup_vault, "borges.md", "# borges\n")

    async with LifespanManager(app):
        pass

    assert "\ntype: Note\n" in untyped.read_text(encoding="utf-8")


async def test_backfill_leaves_the_line_endings_it_found(tmp_path: Path) -> None:
    # A note written on Windows keeps its line endings. Reading a file the plain
    # way translates them, and `write_note` writes what it is handed, so the one
    # field asked for would arrive with every line in the note rewritten beside it.
    written = tmp_path / "borges.md"
    written.write_text("# borges\r\n\r\nText.\r\n", encoding="utf-8", newline="")

    await backfill(tmp_path)

    assert written.read_text(encoding="utf-8", newline="") == (
        "---\r\ntype: Note\r\n---\r\n# borges\r\n\r\nText.\r\n"
    )


async def test_stamping_a_renamed_index_leaves_its_line_endings(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# Was the index\r\n", encoding="utf-8", newline="")

    await client.patch("/api/files/index.md", json={"path": "ideas.md"})

    written = (vault / "ideas.md").read_text(encoding="utf-8", newline="")
    assert "\ntype: Note\r\n" in written
    assert "\n" not in written.replace("\r\n", "")


async def test_startup_writes_the_ontology_note(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    text = (startup_vault / ONTOLOGY_PATH).read_text(encoding="utf-8")

    assert "\ntype: Reference\n" in text
    assert "## Relations" in text


async def test_startup_keeps_the_ontology_note_the_vault_already_has(startup_vault: Path) -> None:
    # Typed, for the reason the reader guide's kept-note case is: the backfill
    # runs in this same lifespan and would type a bare `mine\n`.
    kept = "---\ntype: Reference\n---\nmine\n"
    note(startup_vault, ONTOLOGY_PATH, kept)

    async with LifespanManager(app):
        pass

    assert (startup_vault / ONTOLOGY_PATH).read_text(encoding="utf-8") == kept


async def test_startup_writes_the_index_guide(startup_vault: Path) -> None:
    async with LifespanManager(app):
        pass

    text = (startup_vault / INDEX_GUIDE_PATH).read_text(encoding="utf-8")

    assert "\ntype: Reference\n" in text
    # Both reserved names, because an agent that knows one needs the other.
    assert "index.md" in text
    assert "log.md" in text
    # The listing shape itself, which is the whole reason the note exists.
    assert "](" in text


async def test_startup_keeps_the_index_guide_the_vault_already_has(startup_vault: Path) -> None:
    kept = "---\ntype: Reference\n---\nmine\n"
    note(startup_vault, INDEX_GUIDE_PATH, kept)

    async with LifespanManager(app):
        pass

    assert (startup_vault / INDEX_GUIDE_PATH).read_text(encoding="utf-8") == kept


async def test_the_index_guide_is_not_stamped_into_a_reserved_name(startup_vault: Path) -> None:
    # It is a note about the reserved files, not one of them, so it carries the
    # block every other note carries.
    async with LifespanManager(app):
        pass

    assert "\nid: " in (startup_vault / INDEX_GUIDE_PATH).read_text(encoding="utf-8")
