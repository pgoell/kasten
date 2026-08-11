import re
from typing import TYPE_CHECKING

from asgi_lifespan import LifespanManager

from kasten_backend.main import app
from kasten_backend.trash import TRASH

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient

STAMPED = re.compile(r"@\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{6}$")


async def test_takes_the_note_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    response = await client.delete("/api/files/index.md")

    assert response.status_code == 200
    assert not (vault / "index.md").exists()
    assert (await client.get("/api/files")).json() == []


async def test_keeps_the_text_in_the_trash(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    response = await client.delete("/api/files/inbox/borges.md")
    entry = response.json()["entry"]

    assert entry.startswith("inbox/borges.md@")
    assert STAMPED.search(entry)
    assert (vault / TRASH / entry).read_text() == "# borges"


async def test_answers_with_the_path_and_the_moment(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    body = await client.delete("/api/files/index.md")

    assert body.json()["path"] == "index.md"
    assert body.json()["deleted"].endswith("Z") or "+00:00" in body.json()["deleted"]


async def test_hides_the_trash_from_the_listing_and_the_search(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# borges wrote this")

    await client.delete("/api/files/index.md")

    assert (await client.get("/api/files")).json() == []
    assert (await client.get("/api/search", params={"q": "borges"})).json() == []


async def test_takes_the_folder_it_emptied_with_it(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    await client.delete("/api/files/inbox/borges.md")

    assert not (vault / "inbox").exists()


async def test_refuses_a_note_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    response = await client.delete("/api/files/nothing.md")

    assert response.status_code == 404


async def test_refuses_a_path_climbing_out_of_the_vault(client: AsyncClient, vault: Path) -> None:
    # Encoded, because httpx folds a literal `../` away before it is ever sent.
    outside = vault.parent / "secret.md"
    outside.write_text("# not yours")

    response = await client.delete("/api/files/%2E%2E%2Fsecret.md")

    assert response.status_code == 404
    assert outside.exists()


async def test_deletes_a_folder_and_everything_under_it(client: AsyncClient, vault: Path) -> None:
    (vault / "reading" / "2026").mkdir(parents=True)
    (vault / "reading" / "2026" / "borges.md").write_text("# borges")
    (vault / "reading" / "index.md").write_text("# reading")

    response = await client.delete("/api/folders/reading")
    entry = response.json()["entry"]

    assert response.status_code == 200
    assert response.json()["path"] == "reading"
    assert not (vault / "reading").exists()
    assert (vault / TRASH / entry / "2026" / "borges.md").read_text() == "# borges"


async def test_refuses_a_folder_that_is_not_there(client: AsyncClient, vault: Path) -> None:
    (vault / "index.md").write_text("# index")

    assert (await client.delete("/api/folders/nothing")).status_code == 404
    # A note is not a folder, the way the move refuses one.
    assert (await client.delete("/api/folders/index.md")).status_code == 404


async def test_lists_what_is_in_the_trash_newest_first(client: AsyncClient, vault: Path) -> None:
    (vault / "first.md").write_text("# first")
    (vault / "second.md").write_text("# second")

    await client.delete("/api/files/first.md")
    await client.delete("/api/files/second.md")
    listed = (await client.get("/api/trash")).json()

    assert [row["path"] for row in listed] == ["second.md", "first.md"]


async def test_lists_nothing_when_nothing_was_deleted(client: AsyncClient, vault: Path) -> None:
    assert (await client.get("/api/trash")).json() == []


async def test_puts_a_note_back_where_it_was(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    entry = (await client.delete("/api/files/inbox/borges.md")).json()["entry"]

    response = await client.patch(f"/api/trash/{entry}")

    assert response.status_code == 200
    assert response.json() == {"path": "inbox/borges.md"}
    assert (vault / "inbox" / "borges.md").read_text() == "# borges"
    assert (await client.get("/api/trash")).json() == []


async def test_puts_a_folder_back_whole(client: AsyncClient, vault: Path) -> None:
    (vault / "reading" / "2026").mkdir(parents=True)
    (vault / "reading" / "2026" / "borges.md").write_text("# borges")
    entry = (await client.delete("/api/folders/reading")).json()["entry"]

    response = await client.patch(f"/api/trash/{entry}")

    assert response.status_code == 200
    assert (vault / "reading" / "2026" / "borges.md").read_text() == "# borges"


async def test_refuses_an_entry_the_trash_has_not_got(client: AsyncClient, vault: Path) -> None:
    assert (await client.patch("/api/trash/index.md@2026-08-11T14-03-02.481337")).status_code == 404


async def test_refuses_to_write_over_the_note_that_took_the_path(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# index")
    entry = (await client.delete("/api/files/index.md")).json()["entry"]
    (vault / "index.md").write_text("# a fresh one")

    response = await client.patch(f"/api/trash/{entry}")

    assert response.status_code == 409
    assert (vault / "index.md").read_text() == "# a fresh one"
    assert (vault / TRASH / entry).exists()


async def test_startup_drops_what_the_trash_has_held_too_long(startup_vault: Path) -> None:
    old = startup_vault / TRASH / "old.md@2020-01-01T00-00-00.000000"
    new = startup_vault / TRASH / "new.md@2099-01-01T00-00-00.000000"
    old.parent.mkdir(parents=True)
    old.write_text("# old")
    new.write_text("# new")

    async with LifespanManager(app):
        pass

    assert not old.exists()
    assert new.exists()
