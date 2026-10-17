"""What `GET /api/mentions` finds: the notes naming a note in plain text, unlinked.

The bar is Obsidian's unlinked mentions. A name counts whole and ignoring case,
and a name already inside a link, in code or in the block at the top of a note
is not a place a link would go, so it is not a mention.
"""

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


async def mentions(client: AsyncClient, path: str, **params: str) -> list[dict[str, Any]]:
    response = await client.get("/api/mentions", params={"path": path, **params})
    assert response.status_code == 200
    return response.json()


def spans(found: list[dict[str, Any]]) -> list[tuple[str, int, str]]:
    """Each mention as its note, its line and the words it covers."""
    return [(hit["path"], hit["line"], hit["text"][hit["start"] : hit["end"]]) for hit in found]


async def test_matches_the_title_and_every_spelling_of_aliases(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "reading/Borges.md", "---\naliases: [Jorge Luis, 'JLB']\n---\n")
    write(vault, "people/Kafka.md", '---\naliases:\n  - Franz\n  - "F. K."\n---\n')
    write(vault, "people/Woolf.md", "---\naliases: Virginia\n---\n")
    write(
        vault,
        "journal.md",
        "Read Borges today.\nJorge Luis again, and JLB.\nFranz and F. K. and Virginia.\n",
    )

    found = await mentions(client, "reading/Borges.md")

    assert found == [
        {
            "path": "journal.md",
            "line": 1,
            "text": "Read Borges today.",
            "start": 5,
            "end": 11,
            "name": "Borges",
        },
        {
            "path": "journal.md",
            "line": 2,
            "text": "Jorge Luis again, and JLB.",
            "start": 0,
            "end": 10,
            "name": "Jorge Luis",
        },
        {
            "path": "journal.md",
            "line": 2,
            "text": "Jorge Luis again, and JLB.",
            "start": 22,
            "end": 25,
            "name": "JLB",
        },
    ]
    assert [hit["name"] for hit in await mentions(client, "people/Kafka.md")] == ["Franz", "F. K."]
    assert [hit["name"] for hit in await mentions(client, "people/Woolf.md")] == ["Virginia"]


async def test_lists_mentions_by_path_then_line(client: AsyncClient, vault: Path) -> None:
    write(vault, "Borges.md", "")
    write(vault, "b.md", "Borges\n\nBorges\n")
    write(vault, "a.md", "x\nBorges\n")

    found = await mentions(client, "Borges.md")

    assert [(hit["path"], hit["line"]) for hit in found] == [("a.md", 2), ("b.md", 1), ("b.md", 3)]


async def test_ignores_case_and_matches_whole_words_only(client: AsyncClient, vault: Path) -> None:
    write(vault, "Borges.md", "")
    write(vault, "Müller.md", "")
    write(vault, "C++.md", "")
    write(vault, "2026-W32.md", "")
    write(vault, "a.md", "borges, the borgesian\nMüllers and (müller)\nc++ in 2026-W32.\n")

    assert spans(await mentions(client, "Borges.md")) == [("a.md", 1, "borges")]
    assert spans(await mentions(client, "Müller.md")) == [("a.md", 2, "müller")]
    assert spans(await mentions(client, "C++.md")) == [("a.md", 3, "c++")]
    assert spans(await mentions(client, "2026-W32.md")) == [("a.md", 3, "2026-W32")]


async def test_matches_a_name_inside_underscore_emphasis(client: AsyncClient, vault: Path) -> None:
    write(vault, "Borges.md", "")
    write(vault, "a.md", "_Borges_ and __Borges__\n")

    assert spans(await mentions(client, "Borges.md")) == [("a.md", 1, "Borges")] * 2


async def test_skips_names_inside_links_code_and_frontmatter(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "Borges.md", "")
    write(
        vault,
        "a.md",
        "---\ntitle: Borges\n---\n"
        "[[Borges]] and [[other|Borges]] and ![[Borges]]\n"
        "[Borges](x.md) and [him](Borges.md)\n"
        "`Borges` inline\n"
        "```\nBorges fenced\n```\n"
        "plain Borges\n",
    )

    assert spans(await mentions(client, "Borges.md")) == [("a.md", 10, "Borges")]


async def test_skips_names_inside_tags_and_bare_urls(client: AsyncClient, vault: Path) -> None:
    write(vault, "Borges.md", "")
    write(
        vault,
        "a.md",
        "#borges and #reading/borges\nhttps://x.org/borges and http://borges.org\nBorges\n",
    )

    assert spans(await mentions(client, "Borges.md")) == [("a.md", 3, "Borges")]


async def test_never_lists_the_note_itself(client: AsyncClient, vault: Path) -> None:
    write(vault, "reading/Borges.md", "Borges wrote this.\n")

    assert await mentions(client, "reading/Borges.md") == []


async def test_two_mentions_on_one_line_are_two_results(client: AsyncClient, vault: Path) -> None:
    write(vault, "Borges.md", "")
    write(vault, "a.md", "Borges met borges.\n")

    found = await mentions(client, "Borges.md")

    assert [(hit["line"], hit["start"], hit["end"]) for hit in found] == [(1, 0, 6), (1, 11, 17)]


async def test_counts_offsets_in_utf16(client: AsyncClient, vault: Path) -> None:
    write(vault, "Borges.md", "")
    write(vault, "a.md", "📚 Borges\nnext\n")

    found = await mentions(client, "Borges.md")

    # The emoji is two UTF-16 units, so the name starts at 3 for the browser.
    assert [(hit["text"], hit["start"], hit["end"]) for hit in found] == [("📚 Borges", 3, 9)]


async def test_gives_the_line_of_a_crlf_note_as_the_notes_endpoint_reads_it(
    client: AsyncClient, vault: Path
) -> None:
    write(vault, "Borges.md", "")
    write(vault, "a.md", "first\r\nsee Borges\r\nlast\r\n")

    found = await mentions(client, "Borges.md")
    note = await client.get("/api/files/a.md")

    # The client links a mention by finding `text` on that line of the note it
    # read, so the two have to be the same string.
    lines = note.json()["content"].split("\n")
    assert [(hit["text"], lines[hit["line"] - 1]) for hit in found] == [
        ("see Borges", "see Borges")
    ]


async def test_skips_the_archive_unless_asked(client: AsyncClient, vault: Path) -> None:
    write(vault, "Borges.md", "")
    write(vault, "98 Archive/old.md", "Borges\n")

    assert await mentions(client, "Borges.md") == []
    assert [hit["path"] for hit in await mentions(client, "Borges.md", archive="true")] == [
        "98 Archive/old.md"
    ]


async def test_answers_404_for_a_note_that_does_not_exist(client: AsyncClient, vault: Path) -> None:
    response = await client.get("/api/mentions", params={"path": "nobody.md"})

    assert response.status_code == 404
