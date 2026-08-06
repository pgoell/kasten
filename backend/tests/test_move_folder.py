from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_renames_a_folder_at_the_vault_root(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.patch("/api/folders/inbox", json={"path": "reading"})

    assert response.status_code == 200
    assert response.json() == {"path": "reading"}
    assert (vault / "reading" / "borges.md").read_text() == "# borges"
    assert not (vault / "inbox").exists()


async def test_takes_every_note_under_it(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox" / "deep" / "deeper").mkdir(parents=True)
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "deep" / "kasten.md").write_text("# kasten")
    (vault / "inbox" / "deep" / "deeper" / "note.md").write_text("# note")

    await client.patch("/api/folders/inbox", json={"path": "reading"})

    assert (vault / "reading" / "borges.md").read_text() == "# borges"
    assert (vault / "reading" / "deep" / "kasten.md").read_text() == "# kasten"
    assert (vault / "reading" / "deep" / "deeper" / "note.md").read_text() == "# note"


async def test_moves_a_folder_into_another_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "archive").mkdir()
    (vault / "archive" / "old.md").write_text("# old")

    response = await client.patch("/api/folders/inbox", json={"path": "archive/inbox"})

    assert response.status_code == 200
    assert (vault / "archive" / "inbox" / "borges.md").read_text() == "# borges"
    assert (vault / "archive" / "old.md").read_text() == "# old"


async def test_makes_the_folders_on_the_way(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    await client.patch("/api/folders/inbox", json={"path": "a/b/c/inbox"})

    assert (vault / "a" / "b" / "c" / "inbox" / "borges.md").read_text() == "# borges"


async def test_lists_the_new_paths_and_not_the_old(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox" / "deep").mkdir(parents=True)
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "deep" / "kasten.md").write_text("# kasten")

    await client.patch("/api/folders/inbox", json={"path": "reading"})
    response = await client.get("/api/files")

    assert response.json() == ["reading/borges.md", "reading/deep/kasten.md"]


async def test_answers_with_the_canonical_spelling(client: AsyncClient, vault: Path) -> None:
    # The client rewrites `?note=` against what comes back, so a roundabout
    # spelling of the folder must not reach the address bar.
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.patch("/api/folders/inbox", json={"path": "archive/./2026"})

    assert response.json() == {"path": "archive/2026"}


async def test_takes_a_trailing_slash_on_either_side(client: AsyncClient, vault: Path) -> None:
    # The prompt completes a folder with its slash on the end, so both spellings
    # of one folder arrive here.
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.patch("/api/folders/inbox/", json={"path": "reading/"})

    assert response.json() == {"path": "reading"}
    assert (vault / "reading" / "borges.md").read_text() == "# borges"


async def test_refuses_a_folder_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.patch("/api/folders/absent", json={"path": "reading"})

    assert response.status_code == 404
    assert not (vault / "reading").exists()


async def test_refuses_a_source_that_is_a_note(client: AsyncClient, vault: Path) -> None:
    # `PATCH /api/files/{path}` is what moves a note, and answering here would
    # be a second way to do it with none of the note's rules.
    (vault / "index.md").write_text("# index")

    response = await client.patch("/api/folders/index.md", json={"path": "reading"})

    assert response.status_code == 404
    assert (vault / "index.md").read_text() == "# index"


async def test_refuses_the_vault_root(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.patch("/api/folders/", json={"path": "reading"})

    assert response.status_code == 404
    assert (vault / "index.md").read_text() == "# index"


@pytest.mark.parametrize("source", ["../vault", ".hidden", "inbox/.hidden"])
async def test_refuses_a_source_the_vault_will_not_take(
    client: AsyncClient, vault: Path, source: str
) -> None:
    (vault / "inbox" / ".hidden").mkdir(parents=True)
    (vault / ".hidden").mkdir()

    response = await client.patch(f"/api/folders/{source}", json={"path": "reading"})

    assert response.status_code == 404
    assert not (vault / "reading").exists()


@pytest.mark.parametrize("target", ["../escape", ".hidden", "archive/.hidden", ""])
async def test_refuses_a_target_the_vault_will_not_take(
    client: AsyncClient, vault: Path, target: str
) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.patch("/api/folders/inbox", json={"path": target})

    assert response.status_code == 400
    assert (vault / "inbox" / "borges.md").read_text() == "# borges"


async def test_refuses_a_target_inside_the_folder(client: AsyncClient, vault: Path) -> None:
    # A folder cannot hold itself, and `rename` raises on this rather than
    # refusing, so it is caught before anything is touched.
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.patch("/api/folders/inbox", json={"path": "inbox/archive"})

    assert response.status_code == 400
    assert (vault / "inbox" / "borges.md").read_text() == "# borges"


async def test_refuses_a_target_folder_that_is_taken(client: AsyncClient, vault: Path) -> None:
    # Merging two folders is a different operation, with a different way of
    # failing partway through, and this is not it.
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "reading").mkdir()
    (vault / "reading" / "kasten.md").write_text("# kasten")

    response = await client.patch("/api/folders/inbox", json={"path": "reading"})

    assert response.status_code == 409
    assert (vault / "inbox" / "borges.md").read_text() == "# borges"
    assert (vault / "reading" / "kasten.md").read_text() == "# kasten"


async def test_refuses_a_target_that_is_a_note(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "reading.md").write_text("# reading")

    response = await client.patch("/api/folders/inbox", json={"path": "reading.md"})

    assert response.status_code == 409
    assert (vault / "reading.md").read_text() == "# reading"
    assert (vault / "inbox" / "borges.md").read_text() == "# borges"


async def test_refuses_a_target_under_a_note(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "reading.md").write_text("# reading")

    response = await client.patch("/api/folders/inbox", json={"path": "reading.md/archive"})

    assert response.status_code == 400
    assert (vault / "inbox" / "borges.md").read_text() == "# borges"


async def test_takes_the_folders_it_emptied_with_it(client: AsyncClient, vault: Path) -> None:
    (vault / "a" / "b" / "inbox").mkdir(parents=True)
    (vault / "a" / "b" / "inbox" / "borges.md").write_text("# borges")

    await client.patch("/api/folders/a/b/inbox", json={"path": "inbox"})

    assert (vault / "inbox" / "borges.md").read_text() == "# borges"
    assert not (vault / "a").exists()


async def test_keeps_a_folder_that_still_holds_a_note(client: AsyncClient, vault: Path) -> None:
    (vault / "a" / "inbox").mkdir(parents=True)
    (vault / "a" / "keep.md").write_text("# keep")
    (vault / "a" / "inbox" / "borges.md").write_text("# borges")

    await client.patch("/api/folders/a/inbox", json={"path": "inbox"})

    assert (vault / "a" / "keep.md").read_text() == "# keep"


async def test_keeps_the_vault_root(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    await client.patch("/api/folders/inbox", json={"path": "reading"})

    assert vault.is_dir()  # noqa: ASYNC240
