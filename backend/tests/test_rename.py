from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_renames_a_note_at_the_vault_root(client: AsyncClient, vault: Path) -> None:
    # Not `index.md`: renaming a note off a reserved name stamps it at the new
    # path, which `test_okf.py` is about and this test is not.
    (vault / "borges.md").write_text("# borges")

    response = await client.patch("/api/files/borges.md", json={"path": "home.md"})

    assert response.status_code == 200
    assert response.json() == {"path": "home.md", "content": "# borges"}
    assert (vault / "home.md").read_text() == "# borges"
    assert not (vault / "borges.md").exists()


async def test_moves_a_note_into_another_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.patch(
        "/api/files/inbox/borges.md", json={"path": "reading/2026/borges.md"}
    )

    assert response.status_code == 200
    assert response.json() == {"path": "reading/2026/borges.md", "content": "# borges"}
    assert (vault / "reading" / "2026" / "borges.md").read_text() == "# borges"


async def test_makes_the_folders_on_the_way(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    await client.patch("/api/files/index.md", json={"path": "a/b/c/index.md"})

    assert (vault / "a" / "b" / "c").is_dir()
    assert (vault / "a" / "b" / "c" / "index.md").read_text() == "# index"


async def test_lists_the_new_path_and_not_the_old(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    await client.patch("/api/files/index.md", json={"path": "home.md"})
    response = await client.get("/api/files")

    assert response.json() == ["home.md"]


async def test_answers_with_the_canonical_spelling(client: AsyncClient, vault: Path) -> None:
    # The client navigates to what comes back, so `ideas/./kasten.md` must not
    # reach `?note=`.
    (vault / "borges.md").write_text("# borges")

    response = await client.patch("/api/files/borges.md", json={"path": "ideas/./kasten.md"})

    assert response.json() == {"path": "ideas/kasten.md", "content": "# borges"}


async def test_refuses_a_source_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.patch("/api/files/absent.md", json={"path": "home.md"})

    assert response.status_code == 404
    assert not (vault / "home.md").exists()


@pytest.mark.parametrize("target", ["../escape.md", "note.txt", ".hidden.md", "ideas/.draft.md"])
async def test_refuses_a_target_the_vault_will_not_take(
    client: AsyncClient, vault: Path, target: str
) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.patch("/api/files/index.md", json={"path": target})

    assert response.status_code == 400
    assert (vault / "index.md").read_text() == "# index"


async def test_refuses_a_target_that_is_taken(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")
    (vault / "home.md").write_text("# home")

    response = await client.patch("/api/files/index.md", json={"path": "home.md"})

    assert response.status_code == 409
    assert (vault / "index.md").read_text() == "# index"
    assert (vault / "home.md").read_text() == "# home"


async def test_takes_the_folder_it_emptied_with_it(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    await client.patch("/api/files/inbox/borges.md", json={"path": "borges.md"})

    assert not (vault / "inbox").exists()


async def test_takes_every_folder_it_emptied(client: AsyncClient, vault: Path) -> None:
    (vault / "a" / "b" / "c").mkdir(parents=True)
    (vault / "a" / "b" / "c" / "note.md").write_text("# note")

    await client.patch("/api/files/a/b/c/note.md", json={"path": "note.md"})

    assert not (vault / "a").exists()


async def test_keeps_a_folder_that_still_holds_a_note(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "kasten.md").write_text("# kasten")

    await client.patch("/api/files/inbox/borges.md", json={"path": "borges.md"})

    assert (vault / "inbox" / "kasten.md").read_text() == "# kasten"


async def test_keeps_a_folder_holding_only_a_hidden_file(client: AsyncClient, vault: Path) -> None:
    # The listing never showed it, and it is still not ours to throw away.
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / ".keep").write_text("")

    await client.patch("/api/files/inbox/borges.md", json={"path": "borges.md"})

    assert (vault / "inbox" / ".keep").exists()


async def test_keeps_the_folder_a_rename_stays_inside(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "typo.md").write_text("# borges")

    await client.patch("/api/files/inbox/typo.md", json={"path": "inbox/borges.md"})

    assert (vault / "inbox" / "borges.md").read_text() == "# borges"


async def test_keeps_the_vault_root(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    await client.patch("/api/files/index.md", json={"path": "ideas/index.md"})

    assert vault.is_dir()  # noqa: ASYNC240


async def test_stops_at_the_first_folder_it_cannot_take(client: AsyncClient, vault: Path) -> None:
    # `a/` keeps a note, so `a/` stays and so does everything above it, even
    # though `a/b/` came away empty.
    (vault / "a" / "b").mkdir(parents=True)
    (vault / "a" / "keep.md").write_text("# keep")
    (vault / "a" / "b" / "note.md").write_text("# note")

    await client.patch("/api/files/a/b/note.md", json={"path": "note.md"})

    assert not (vault / "a" / "b").exists()
    assert (vault / "a" / "keep.md").read_text() == "# keep"


async def test_refuses_a_target_under_a_note(client: AsyncClient, vault: Path) -> None:
    # A note cannot live inside a file, which `resolve_path` refuses for every
    # ancestor of the path.
    (vault / "index.md").write_text("# index")
    (vault / "kasten.md").write_text("# kasten")

    response = await client.patch("/api/files/index.md", json={"path": "kasten.md/note.md"})

    assert response.status_code == 400
    assert (vault / "index.md").read_text() == "# index"


BOOK = b"PK\x03\x04 not really a book"


async def test_carries_the_book_beside_the_note(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "borges.epub").write_bytes(BOOK)

    response = await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert response.status_code == 200
    assert (vault / "reading" / "borges.epub").read_bytes() == BOOK
    assert not (vault / "inbox" / "borges.epub").exists()


async def test_leaves_the_book_where_it_is_when_the_target_has_one(
    client: AsyncClient, vault: Path
) -> None:
    # The move goes through and the pair stops being a pair, rather than the
    # note becoming one you cannot move at all. Overwriting is the one thing
    # nothing here does to a book.
    (vault / "inbox").mkdir()
    (vault / "reading").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "borges.epub").write_bytes(BOOK)
    (vault / "reading" / "borges.epub").write_bytes(b"PK\x03\x04 another book")

    response = await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert response.status_code == 200
    assert (vault / "reading" / "borges.md").read_text() == "# borges"
    assert (vault / "reading" / "borges.epub").read_bytes() == b"PK\x03\x04 another book"
    assert (vault / "inbox" / "borges.epub").read_bytes() == BOOK


async def test_moves_a_note_that_has_no_book(client: AsyncClient, vault: Path) -> None:
    # A guard: most notes have none, and the move must not go looking for one.
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert response.status_code == 200
    assert not (vault / "reading" / "borges.epub").exists()
