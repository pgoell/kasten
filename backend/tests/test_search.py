"""What `GET /api/search` finds in the vault, and what it refuses to look at.

The vault is the source of truth here as everywhere else, so the rule these
tests hold to is that search sees exactly what `GET /api/files` lists. A note
the listing shows and the search cannot find is the bug this file exists to
catch.
"""

from typing import TYPE_CHECKING

from kasten_backend.search import MOST_HITS

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def test_finds_the_line_a_word_is_on(client: AsyncClient, vault: Path) -> None:
    write(vault, "projects/kasten.md", "# kasten\n\nPostgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert response.status_code == 200
    assert response.json() == [
        {"path": "projects/kasten.md", "line": 3, "text": "Postgres holds a derived index."}
    ]


async def test_ignores_the_case_of_the_query(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "POSTGRES"})

    assert [hit["line"] for hit in response.json()] == [1]


async def test_reads_the_query_as_a_literal_and_not_a_regex(
    client: AsyncClient, vault: Path
) -> None:
    # `index.` as a regex matches "index " in the second note as well. The user
    # typed a sentence, not a pattern, so only the first note is a match.
    write(vault, "literal.md", "Postgres holds a derived index.\n")
    write(vault, "pattern.md", "Postgres holds a derived index and nothing else.\n")

    response = await client.get("/api/search", params={"q": "index."})

    assert [hit["path"] for hit in response.json()] == ["literal.md"]


async def test_does_not_choke_on_a_query_that_is_a_broken_regex(
    client: AsyncClient, vault: Path
) -> None:
    # Half a bracket is what a query looks like halfway through being typed.
    write(vault, "kasten.md", "A link reads [[like this]].\n")

    response = await client.get("/api/search", params={"q": "[[like"})

    assert response.status_code == 200
    assert [hit["text"] for hit in response.json()] == ["A link reads [[like this]]."]


async def test_reads_markdown_and_nothing_else(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "derived index\n")
    write(vault, "notes.txt", "derived index\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit["path"] for hit in response.json()] == ["kasten.md"]


async def test_skips_hidden_directories(client: AsyncClient, vault: Path) -> None:
    # The vault carries its own jj repo, and jj keeps copies of note text under
    # `.jj`. Finding those would show the same line twice, once at a path the
    # editor cannot open. `GET /api/files` skips hidden parts for this reason
    # and rg skips them by default; this is what says so out loud.
    write(vault, "kasten.md", "derived index\n")
    write(vault, ".jj/repo/store/blob", "derived index\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit["path"] for hit in response.json()] == ["kasten.md"]


async def test_finds_a_note_that_gitignore_ignores(client: AsyncClient, vault: Path) -> None:
    # The vault is a git repo, so it may hold a `.gitignore`, and rg reads one
    # by default. A note the listing shows has to be a note the search finds,
    # whatever git has been told to overlook.
    #
    # The `.git` directory is the point of the setup, not scenery: rg only
    # honours a `.gitignore` once it can see a repo around it, so without this
    # the test passes whether the flag is there or not.
    (vault / ".git").mkdir()
    write(vault, ".gitignore", "drafts/\n")
    write(vault, "drafts/kasten.md", "derived index\n")

    response = await client.get("/api/search", params={"q": "derived"})

    assert [hit["path"] for hit in response.json()] == ["drafts/kasten.md"]


async def test_stops_at_the_cap(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "derived index\n" * (MOST_HITS + 100))

    response = await client.get("/api/search", params={"q": "derived"})

    assert len(response.json()) == MOST_HITS


async def test_answers_with_nothing_when_nothing_matches(client: AsyncClient, vault: Path) -> None:
    write(vault, "kasten.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": "wikilink"})

    assert response.status_code == 200
    assert response.json() == []


async def test_answers_with_nothing_for_a_blank_query(client: AsyncClient, vault: Path) -> None:
    # An empty literal matches every line in the vault, which is the one answer
    # nobody typing into a search box wants back.
    write(vault, "kasten.md", "Postgres holds a derived index.\n")

    response = await client.get("/api/search", params={"q": " "})

    assert response.json() == []


async def test_answers_with_nothing_for_a_vault_that_is_not_there(
    client: AsyncClient, missing_vault: Path
) -> None:
    response = await client.get("/api/search", params={"q": "derived"})

    assert response.status_code == 200
    assert response.json() == []
