"""What the archive folder is kept out of, and how to ask for it back.

An archive is an ordinary folder in the vault. Nothing about it is special to
the filesystem, to jj or to a note that lives in it; the one thing kasten does
is leave it out of the two rg passes by default, because work that is finished
should not crowd out work that is not.

The rule these tests hold to is that leaving it out is a default and never a
wall. Every endpoint below answers with the archive the moment it is asked, and
`GET /api/files` never leaves it out at all: the listing is what resolves a
`[[wikilink]]`, and a link into the archive that read as a dead one would make
a second note in the inbox out of a note the vault already has.
"""

from typing import TYPE_CHECKING

from kasten_backend.config import Settings

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_search_leaves_the_archive_out(client: AsyncClient, vault: Path) -> None:
    write(vault, "projects/kasten.md", "Postgres holds a derived index.\n")
    write(vault, "98 Archive/old.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "Postgres"})

    assert [hit["path"] for hit in response.json()] == ["projects/kasten.md"]


async def test_search_takes_the_archive_when_it_is_asked_for(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "projects/kasten.md", "Postgres holds a derived index.\n")
    write(vault, "98 Archive/old.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "Postgres", "archive": "true"})

    assert sorted(hit["path"] for hit in response.json()) == [
        "98 Archive/old.md",
        "projects/kasten.md",
    ]


async def test_todos_leave_the_archive_out(client: AsyncClient, vault: Path) -> None:
    write(vault, "projects/kasten.md", "- [ ] ship it\n")
    write(vault, "98 Archive/old.md", "- [ ] a todo nobody is doing\n")

    response = await client.get("/api/todos")

    assert [hit["path"] for hit in response.json()] == ["projects/kasten.md"]


async def test_todos_take_the_archive_when_it_is_asked_for(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "projects/kasten.md", "- [ ] ship it\n")
    write(vault, "98 Archive/old.md", "- [ ] a todo nobody is doing\n")

    response = await client.get("/api/todos", params={"archive": "true"})

    assert len(response.json()) == 2


async def test_a_folder_merely_starting_with_the_archive_name_stays(
    client: AsyncClient, vault: Path
) -> None:
    """`98 Archived plans` is not the archive, and a prefix match would hide it."""
    write(vault, "98 Archived plans/live.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "Postgres"})

    assert [hit["path"] for hit in response.json()] == ["98 Archived plans/live.md"]


async def test_an_archive_folder_nested_anywhere_is_skipped_too(
    client: AsyncClient, vault: Path
) -> None:
    """Stated rather than accidental. `skipping` explains why the glob is loose."""
    write(vault, "projects/98 Archive/old.md", "Postgres holds a derived index.\n")
    write(vault, "projects/kasten.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "Postgres"})

    assert [hit["path"] for hit in response.json()] == ["projects/kasten.md"]


async def test_a_note_named_like_the_archive_stays(client: AsyncClient, vault: Path) -> None:
    """The archive is a directory. A note called `98 Archive.md` is a note."""
    write(vault, "98 Archive.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "Postgres"})

    assert [hit["path"] for hit in response.json()] == ["98 Archive.md"]


async def test_the_listing_always_holds_the_archive(client: AsyncClient, vault: Path) -> None:
    """No parameter and no default drops it: a wikilink into it has to resolve."""
    write(vault, "98 Archive/old.md", "# old\n")

    response = await client.get("/api/files")

    assert response.json() == ["98 Archive/old.md"]


def test_the_archive_folder_is_configurable() -> None:
    """Named by a setting, so a vault that spells it differently is not stuck."""
    assert Settings().archive_path == "98 Archive"


async def test_an_archived_note_still_opens(client: AsyncClient, vault: Path) -> None:
    """Left out of a search is not hidden. Every other endpoint is unchanged."""
    write(vault, "98 Archive/old.md", "# old\n")

    response = await client.get("/api/files/98 Archive/old.md")

    assert response.status_code == 200
    assert response.json()["content"] == "# old\n"
