from typing import TYPE_CHECKING

from kasten_backend.indexes import backfill

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


async def test_lists_a_folder_a_create_made(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/files/reading/2026/borges.md")

    assert (vault / "reading" / "index.md").read_text() == "# reading\n\n* [2026](2026/)\n"
    assert (vault / "reading" / "2026" / "index.md").read_text() == (
        "# 2026\n\n* [borges](borges.md)\n"
    )


async def test_leaves_a_folder_that_was_there_alone(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()

    await client.post("/api/files/reading/borges.md")

    assert not (vault / "reading" / "index.md").exists()


async def test_escapes_a_name_with_a_space(client: AsyncClient, vault: Path) -> None:
    await client.post("/api/files/Reading List/Le Guin.md")

    assert (vault / "Reading List" / "index.md").read_text() == (
        "# Reading List\n\n* [Le Guin](Le%20Guin.md)\n"
    )


async def test_lists_a_folder_a_move_made(client: AsyncClient, vault: Path) -> None:
    (vault / "borges.md").write_text("# borges")

    await client.patch("/api/files/borges.md", json={"path": "reading/borges.md"})

    assert (vault / "reading" / "index.md").read_text() == "# reading\n\n* [borges](borges.md)\n"


async def test_carries_an_entry_to_the_new_folder(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "poe.md").write_text("# poe")
    (vault / "inbox" / "index.md").write_text(
        "# Inbox\n\n* [Borges](borges.md) - the labyrinths\n* [Poe](poe.md)\n"
    )
    (vault / "reading").mkdir()
    (vault / "reading" / "index.md").write_text("# Reading\n\n* [Dune](dune.md)")

    await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert (vault / "inbox" / "index.md").read_text() == "# Inbox\n\n* [Poe](poe.md)\n"
    assert (vault / "reading" / "index.md").read_text() == (
        "# Reading\n\n* [Dune](dune.md)\n* [Borges](borges.md) - the labyrinths\n"
    )


async def test_carries_an_entry_into_a_folder_the_move_made(
    client: AsyncClient, vault: Path
) -> None:
    # The new folder's listing already holds a plain line for the note, and
    # the carried one with its description takes its place.
    (vault / "index.md").write_text("# Vault\n\n* [Borges](borges.md) - the labyrinths\n")
    (vault / "borges.md").write_text("# borges")

    await client.patch("/api/files/borges.md", json={"path": "reading/borges.md"})

    # The new folder is listed in its place, the vault's index being a listing.
    assert (vault / "index.md").read_text() == "# Vault\n\n* [reading](reading/)\n"
    assert (vault / "reading" / "index.md").read_text() == (
        "# reading\n\n* [Borges](borges.md) - the labyrinths\n"
    )


async def test_carries_a_folder_s_entry(client: AsyncClient, vault: Path) -> None:
    (vault / "projects" / "kasten").mkdir(parents=True)
    (vault / "projects" / "kasten" / "plan.md").write_text("# plan")
    (vault / "projects" / "index.md").write_text("* [Kasten](kasten/) - the notebook\n")
    (vault / "projects" / "garden.md").write_text("# garden")
    (vault / "archive").mkdir()
    (vault / "archive" / "index.md").write_text("# Archive\n")

    await client.patch("/api/folders/projects/kasten", json={"path": "archive/kasten"})

    assert (vault / "projects" / "index.md").read_text() == ""
    assert (vault / "archive" / "index.md").read_text() == (
        "# Archive\n* [Kasten](kasten/) - the notebook\n"
    )


async def test_adds_no_entry_the_old_index_did_not_have(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "index.md").write_text("# Inbox\n")
    (vault / "reading").mkdir()
    (vault / "reading" / "index.md").write_text("# Reading\n")

    await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert (vault / "reading" / "index.md").read_text() == "# Reading\n"


async def test_takes_a_folder_left_holding_only_its_index(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "index.md").write_text("# Inbox\n\n* [Borges](borges.md)\n")

    await client.patch("/api/files/inbox/borges.md", json={"path": "borges.md"})

    assert not (vault / "inbox").exists()


async def test_drops_the_entry_for_a_folder_the_move_emptied(
    client: AsyncClient, vault: Path
) -> None:
    (vault / "index.md").write_text("# Vault\n\n* [Inbox](inbox/)\n* [Home](home.md)\n")
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")

    await client.patch("/api/files/inbox/borges.md", json={"path": "reading/borges.md"})

    assert (vault / "index.md").read_text() == (
        "# Vault\n\n* [Home](home.md)\n* [reading](reading/)\n"
    )


async def test_backfill_lists_every_folder_without_an_index(vault: Path) -> None:
    (vault / "reading" / "2026").mkdir(parents=True)
    (vault / "reading" / "2026" / "borges.md").write_text("# borges")
    (vault / "projects").mkdir()
    (vault / "projects" / "index.md").write_text("# mine\n")
    (vault / ".trash" / "old").mkdir(parents=True)

    written = await backfill(vault)

    assert written == ["reading/index.md", "reading/2026/index.md"]
    assert (vault / "projects" / "index.md").read_text() == "# mine\n"
    assert not (vault / "index.md").exists()
    assert not (vault / ".trash" / "old" / "index.md").exists()


async def test_previews_what_a_move_rewrites(client: AsyncClient, vault: Path) -> None:
    (vault / "inbox").mkdir()
    (vault / "inbox" / "borges.md").write_text("# borges")
    (vault / "inbox" / "index.md").write_text("* [Borges](borges.md)\n")
    (vault / "home.md").write_text("[[inbox/borges]]")
    (vault / "poe.md").write_text("nothing here")

    response = await client.get(
        "/api/move-preview", params={"source": "inbox/borges.md", "target": "reading/borges.md"}
    )

    assert response.status_code == 200
    assert response.json() == {"rewrites": ["home.md", "inbox/index.md", "reading/index.md"]}
    assert (vault / "home.md").read_text() == "[[inbox/borges]]"


async def test_previews_a_folder_move(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("[up](../home.md)")
    (vault / "home.md").write_text("# home")

    response = await client.get(
        "/api/move-preview", params={"source": "reading", "target": "a/reading"}
    )

    assert response.json() == {"rewrites": ["reading/borges.md"]}


async def test_refuses_to_preview_nothing(client: AsyncClient, vault: Path) -> None:
    response = await client.get(
        "/api/move-preview", params={"source": "nope.md", "target": "a/nope.md"}
    )

    assert response.status_code == 404


async def test_refuses_to_preview_a_folder_into_itself(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")

    response = await client.get(
        "/api/move-preview", params={"source": "reading", "target": "reading/inner"}
    )

    assert response.status_code == 400


async def test_lists_a_new_folder_in_the_index_above(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "index.md").write_text("# Reading\n\n* [Dune](dune.md)\n")

    await client.post("/api/files/reading/2026/borges.md")

    assert (vault / "reading" / "index.md").read_text() == (
        "# Reading\n\n* [Dune](dune.md)\n* [2026](2026/)\n"
    )


async def test_retitles_a_renamed_folder_s_index(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "borges.md").write_text("# borges")
    (vault / "reading" / "index.md").write_text("# reading\n\n* [borges](borges.md)\n")

    await client.patch("/api/folders/reading", json={"path": "books"})

    assert (vault / "books" / "index.md").read_text() == "# books\n\n* [borges](borges.md)\n"


async def test_keeps_a_heading_somebody_wrote(client: AsyncClient, vault: Path) -> None:
    (vault / "reading").mkdir()
    (vault / "reading" / "index.md").write_text("# What I read\n")

    await client.patch("/api/folders/reading", json={"path": "books"})

    assert (vault / "books" / "index.md").read_text() == "# What I read\n"
