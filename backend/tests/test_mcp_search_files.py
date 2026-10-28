"""What the agent's `search_notes` finds inside the pdf, epub and html files beside the notes.

Through the whole application, MCP and `GET /agent/search` both, because the
promise is that an agent finds what the app's own search finds, from the same
cache, and that a note's hit answers exactly as it did before files were read.
"""

from typing import TYPE_CHECKING, Any

from backend.tests.book_files import epub, pdf, xhtml
from backend.tests.test_mcp import ENDPOINT, RPC, call, payload
from kasten_backend import file_search, file_text

if TYPE_CHECKING:
    from pathlib import Path

    import pytest
    from httpx import AsyncClient


def put(vault: Path, path: str, content: bytes | str) -> None:
    target = vault / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        target.write_bytes(content)
    else:
        target.write_text(content, encoding="utf-8")


async def tool(
    client: AsyncClient, bearer: dict[str, str], query: str, **arguments: Any
) -> list[dict[str, Any]]:
    """The hits `search_notes` answers over MCP, after checking the call was no tool error."""
    response = await client.post(
        ENDPOINT,
        json=call("search_notes", {"query": query, **arguments}),
        headers={**bearer, **RPC},
    )
    result = payload(response.text)["result"]
    assert response.status_code == 200
    assert result.get("isError") is not True, result
    return result["structuredContent"]["result"]


async def test_search_notes_finds_a_pdf_line_with_its_page(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    put(agent_vault, "paper.pdf", pdf([["first page"], ["second page", "the Grundschuld"]]))

    assert await tool(client, bearer, "grundschuld") == [
        {
            "path": "paper.pdf",
            "line": 3,
            "text": "the Grundschuld",
            "place": {"kind": "pdf", "label": "page 2", "page": 2, "anchor": None},
        }
    ]


async def test_search_notes_finds_an_epub_line_with_its_chapter(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    put(
        agent_vault,
        "book.epub",
        epub(
            [
                xhtml("<h1>Chapter One</h1><p>opening words</p>"),
                xhtml("<h1>Chapter Two</h1><p>the long middle</p><p>needle here</p>"),
            ]
        ),
    )

    (hit,) = await tool(client, bearer, "needle")

    assert hit["path"] == "book.epub"
    assert hit["text"] == "needle here"
    assert hit["place"] == {
        "kind": "epub",
        "label": "Chapter Two, 81%",
        "page": None,
        "anchor": None,
    }


async def test_search_notes_finds_an_html_line_with_its_heading(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    put(
        agent_vault,
        "page.html",
        "<html><head><title>Doc</title></head><body>"
        '<p>before any heading</p><h2 id="sec-2">Second</h2>'
        "<p>a needle under it</p></body></html>",
    )

    (hit,) = await tool(client, bearer, "needle")

    assert hit["path"] == "page.html"
    assert hit["text"] == "a needle under it"
    assert hit["place"] == {"kind": "html", "label": "Second", "page": None, "anchor": "sec-2"}


async def test_a_file_the_cache_cannot_read_gives_search_notes_no_hit_and_no_error(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    put(agent_vault, "fake.pdf", b"%PDF-1.7 not really a pdf, but with its magic")
    put(agent_vault, "broken.epub", b"PK\x03\x04 not really a zip")
    put(agent_vault, "note.md", "a needle in a note\n")
    # One file that reads, so the answer shows file hits are looked for at all.
    put(agent_vault, "good.pdf", pdf([["a needle that reads"]]))

    assert [hit["path"] for hit in await tool(client, bearer, "needle")] == ["note.md", "good.pdf"]


MAIN_ANSWER = [
    {"path": "2026-10-07.md", "line": 1, "text": "The garden of forking paths #borges"},
    {"path": "2026-10-07.md", "line": 3, "text": "- [ ] read FORKING again"},
    {"path": "people/borges: notes.md", "line": 4, "text": "forking, as he wrote"},
]
"""What main answered, by MCP and by `GET /agent/search` alike, for the vault below.

Taken from main before files were searched, sorted by path and line because rg
walks the vault in parallel and its order is not fixed.
"""


def _markdown_only(vault: Path) -> None:
    put(vault, "2026-10-07.md", "The garden of forking paths #borges\n\n- [ ] read FORKING again\n")
    put(vault, "people/borges: notes.md", "---\ntags: [a]\n---\nforking, as he wrote\n")
    put(vault, "98 Archive/old.md", "an archived forking\n")
    put(vault, "elsewhere.md", "nothing here\n")


def _sorted(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(hits, key=lambda hit: (hit["path"], hit["line"]))


async def test_a_markdown_only_search_answers_as_main_did_over_mcp(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _markdown_only(agent_vault)

    assert _sorted(await tool(client, bearer, "forking")) == MAIN_ANSWER


async def test_a_markdown_only_search_answers_as_main_did_over_agent_search(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    _markdown_only(agent_vault)

    response = await client.get("/agent/search", params={"q": "forking"}, headers=bearer)

    assert response.status_code == 200
    assert _sorted(response.json()) == MAIN_ANSWER


async def test_agent_search_finds_a_file_line_with_its_place(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    put(agent_vault, "paper.pdf", pdf([["the needle"]]))

    response = await client.get("/agent/search", params={"q": "needle"}, headers=bearer)

    assert response.json() == [
        {
            "path": "paper.pdf",
            "line": 1,
            "text": "the needle",
            "place": {"kind": "pdf", "label": "page 1", "page": 1, "anchor": None},
        }
    ]


async def test_search_notes_and_api_search_agree_on_every_file_hit(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    put(agent_vault, "paper.pdf", pdf([["one needle"], ["two needle"]]))
    put(agent_vault, "book.epub", epub([xhtml("<h1>Start</h1><p>a needle in a chapter</p>")]))
    put(agent_vault, "page.html", '<html><body><h1 id="top">Top</h1><p>needle</p></body></html>')

    response = await client.get("/api/search", params={"q": "needle"})
    app_hits = {
        (hit["path"], hit["line"], hit["text"], tuple(hit["place"].items()))
        for hit in response.json()
    }
    agent_hits = {
        (hit["path"], hit["line"], hit["text"], tuple(hit["place"].items()))
        for hit in await tool(client, bearer, "needle")
    }

    assert len(app_hits) == 4
    assert agent_hits == app_hits


async def test_search_notes_leaves_an_archived_file_out_unless_asked_for(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    put(agent_vault, "98 Archive/old.pdf", pdf([["needle"]]))

    assert await tool(client, bearer, "needle") == []
    assert [hit["path"] for hit in await tool(client, bearer, "needle", archive=True)] == [
        "98 Archive/old.pdf"
    ]


async def test_search_notes_puts_notes_first_and_caps_the_total(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cap = 3
    monkeypatch.setattr("kasten_backend.search.MOST_HITS", cap)
    monkeypatch.setattr(file_search, "MOST_HITS", cap)
    put(agent_vault, "note.md", "derived one\nderived two\n")
    put(agent_vault, "paper.pdf", pdf([["derived a", "derived b", "derived c"]]))

    hits = await tool(client, bearer, "derived")

    assert [hit["path"] for hit in hits] == ["note.md", "note.md", "paper.pdf"]


async def test_a_blank_search_notes_query_answers_nothing_and_extracts_nothing(
    client: AsyncClient,
    agent_vault: Path,
    bearer: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refreshed: list[object] = []

    async def refuse(*args: object) -> None:
        refreshed.append(args)

    monkeypatch.setattr(file_text, "refresh", refuse)
    put(agent_vault, "paper.pdf", pdf([["needle"]]))

    assert await tool(client, bearer, " ") == []
    assert refreshed == []


async def test_the_search_notes_description_names_file_hits_and_their_place(
    client: AsyncClient, agent_vault: Path, bearer: dict[str, str]
) -> None:
    response = await client.post(
        ENDPOINT,
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={**bearer, **RPC},
    )

    (description,) = [
        tool["description"]
        for tool in payload(response.text)["result"]["tools"]
        if tool["name"] == "search_notes"
    ]

    for word in ("pdf", "epub", "html", "place", "page", "label", "anchor"):
        assert word in description
