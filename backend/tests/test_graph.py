"""What `GET /api/graph` draws, and what its query language asks.

Built from the vault on every request, so each test writes a few notes and
reads the answer. The link and relation rules are the editor's, and the cases
here are the ones `wikilink.test.ts` and `relation.test.ts` describe.
"""

from typing import TYPE_CHECKING, Any

import pytest

from kasten_backend.graph import resolver
from kasten_backend.links import link_path

if TYPE_CHECKING:
    from pathlib import Path

    from httpx import AsyncClient


def write(vault: Path, path: str, text: str) -> None:
    note = vault / path
    note.parent.mkdir(parents=True, exist_ok=True)
    note.write_text(text, encoding="utf-8")


def block(kind: str) -> str:
    return f"---\nid: x\ntype: {kind}\n---\n\n"


async def graph(client: AsyncClient, **params: Any) -> dict[str, Any]:
    response = await client.get("/api/graph", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def paths(answer: dict[str, Any]) -> set[str]:
    return {node["path"] for node in answer["nodes"]}


def edges(answer: dict[str, Any]) -> set[tuple[str, str, str | None]]:
    return {(e["source"], e["target"], e["relation"]) for e in answer["edges"]}


@pytest.fixture
def small(vault: Path) -> Path:
    """Three concepts, a paper supporting one, and a person nobody has written."""
    write(vault, "rag.md", block("Concept") + "depends-on:: [[Embeddings]]\n#ai\n")
    write(vault, "ideas/Embeddings.md", block("Concept") + "See [[rag]].\n")
    write(vault, "GraphRAG paper.md", block("Source") + "- supports:: [[rag]] and [[Ghost]]\n")
    write(vault, "lonely.md", "nothing links here\n")
    return vault


async def test_draws_every_note_and_link(client: AsyncClient, small: Path) -> None:
    answer = await graph(client)

    assert paths(answer) == {
        "rag.md",
        "ideas/Embeddings.md",
        "GraphRAG paper.md",
        "lonely.md",
        "Ghost.md",
    }
    assert edges(answer) == {
        ("rag.md", "ideas/Embeddings.md", "depends-on"),
        ("ideas/Embeddings.md", "rag.md", None),
        ("GraphRAG paper.md", "rag.md", "supports"),
        ("GraphRAG paper.md", "Ghost.md", None),
    }
    nodes = {node["path"]: node for node in answer["nodes"]}
    assert nodes["rag.md"]["type"] == "Concept"
    assert nodes["rag.md"]["tags"] == ["#ai"]
    assert nodes["lonely.md"]["type"] is None
    assert nodes["Ghost.md"]["missing"] is True


async def test_reads_aliases_headings_and_skips_embeds(client: AsyncClient, vault: Path) -> None:
    write(vault, "Louise Nong.md", "")
    write(vault, "plan.md", "")
    write(vault, "a.md", "[[Louise Nong|Louise]] [[plan#Risks]] [[#Top]] ![[plan.pdf]] [[a]]\n")

    answer = await graph(client)

    assert edges(answer) == {("a.md", "Louise Nong.md", None), ("a.md", "plan.md", None)}


async def test_a_type_in_the_body_is_prose(client: AsyncClient, vault: Path) -> None:
    write(vault, "a.md", "# Title\n\ntype: Concept\n")

    answer = await graph(client)

    assert answer["nodes"][0]["type"] is None


async def test_leaves_the_archive_out(client: AsyncClient, vault: Path) -> None:
    write(vault, "a.md", "[[old]]\n")
    write(vault, "98 Archive/old.md", "")

    assert paths(await graph(client)) == {"a.md"}
    assert paths(await graph(client, archive=True)) == {"a.md", "98 Archive/old.md"}


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("type:Concept", {"rag.md", "ideas/Embeddings.md"}),
        ("-type:Concept", {"GraphRAG paper.md", "lonely.md", "Ghost.md"}),
        ("tag:ai", {"rag.md"}),
        ('path:"ideas"', {"ideas/Embeddings.md"}),
        ("is:missing", {"Ghost.md"}),
        ("is:orphan", {"lonely.md"}),
        ("paper", {"GraphRAG paper.md"}),
        ("rel:supports", {"GraphRAG paper.md", "rag.md"}),
        ("rel:*", {"GraphRAG paper.md", "rag.md", "ideas/Embeddings.md"}),
    ],
)
async def test_filters(client: AsyncClient, small: Path, query: str, expected: set[str]) -> None:
    assert paths(await graph(client, q=query)) == expected


async def test_rel_filter_keeps_only_those_edges(client: AsyncClient, small: Path) -> None:
    answer = await graph(client, q="-rel:depends-on type:Concept")

    assert edges(answer) == {("ideas/Embeddings.md", "rag.md", None)}


async def test_local_graph_keeps_its_centre(client: AsyncClient, small: Path) -> None:
    answer = await graph(client, around="ideas/Embeddings.md", depth=1, q="type:Source")

    assert paths(answer) == {"ideas/Embeddings.md"}

    answer = await graph(client, around="Embeddings", depth=2)

    assert paths(answer) == {"ideas/Embeddings.md", "rag.md", "GraphRAG paper.md"}


async def test_pattern_answers_rows(client: AsyncClient, small: Path) -> None:
    answer = await graph(client, q="?paper supports ?idea; ?idea depends-on [[Embeddings]]")

    assert answer["columns"] == ["?paper", "?idea"]
    assert answer["rows"] == [{"?paper": "GraphRAG paper.md", "?idea": "rag.md"}]
    assert edges(answer) == {
        ("GraphRAG paper.md", "rag.md", "supports"),
        ("rag.md", "ideas/Embeddings.md", "depends-on"),
    }


async def test_pattern_binds_a_relation(client: AsyncClient, small: Path) -> None:
    answer = await graph(client, q="[[GraphRAG paper]] ?how ?what\n?what type:Concept")

    assert answer["rows"] == [{"?how": "supports", "?what": "rag.md"}]


async def test_pattern_links_matches_every_edge(client: AsyncClient, small: Path) -> None:
    answer = await graph(client, q="?a links [[rag]]")

    assert {row["?a"] for row in answer["rows"]} == {"ideas/Embeddings.md", "GraphRAG paper.md"}


@pytest.mark.parametrize(
    "query",
    ["colour:red", "is:big", "?a", "?a supports", "?x ?x ?y", "[[rag]]", "?a rel:supports"],
)
async def test_refuses_what_it_cannot_read(client: AsyncClient, small: Path, query: str) -> None:
    response = await client.get("/api/graph", params={"q": query})

    assert response.status_code == 400
    assert response.json()["detail"]


async def test_refuses_a_centre_not_in_the_graph(client: AsyncClient, small: Path) -> None:
    response = await client.get("/api/graph", params={"around": "nowhere.md"})

    assert response.status_code == 400


@pytest.mark.parametrize("target", ["borges", "reading/borges", "BORGES.md", "nobody", "x/nobody"])
def test_resolver_agrees_with_link_path(target: str) -> None:
    listing = ["borges.md", "reading/borges.md", "z/other.md"]

    assert resolver(listing)(target) == link_path(target, listing)
