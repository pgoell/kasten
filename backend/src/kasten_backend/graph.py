"""The notes as a graph: every note a node, every link between two an edge.

Built on every request, like search and todos, since a graph held elsewhere can disagree with
the files. `graph_query.py` is the one reader of the query language, shared by the graph pane,
`GET /api/graph` and the agent's `query_graph`.
"""

import asyncio
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend.links import named_path, names_a_file, split_target
from kasten_backend.search import scan_vault
from kasten_backend.tags import tags_by_note
from kasten_backend.vault import SUFFIX, list_markdown_files

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable
    from pathlib import Path

MOST_LINES = 200_000
"""How many lines one of the two scans reads at most.

A backstop against a generated file, not a vault limit: the 10,000 note benchmark holds about
50,000 linked lines.
"""

MOST_DEPTH = 5
"""How far out a local graph reaches. Five links from any note is most vaults."""

WIKILINK = re.compile(r"\[\[([^\[\]\n]+)\]\]")
"""One `[[link]]`, spelled the way `code_spans.py` and the editor's parser spell it."""

RELATION = re.compile(r"^ {0,3}(?:- )?([a-z][a-z-]*):: [ \t]*\[\[([^\[\]\n]+)\]\]")
"""`name:: [[target]]`, the rule `frontend/src/lib/relation.ts` reads.

A copy, since the editor draws a relation without asking the server, and the graph is built
without asking the editor. `docs/reference/relation-format.md` is what both answer to.
"""

TYPE = re.compile(r"^type:\s*(.*?)\s*$")
"""The `type` field of the block, the one line of it the graph reads."""


class GraphError(ValueError):
    """The query could not be read or answered. The message says why, to a person."""


class GraphNode(BaseModel):
    """One note, or one a link names that nobody has written."""

    path: str
    name: str
    type: str | None
    """The `type` in the note's block, or None for a note with no block or no note."""
    tags: list[str]
    missing: bool
    """A link names this note and there is no file there."""


class GraphEdge(BaseModel):
    """One note linking another, once per pair and relation however often it is written."""

    source: str
    target: str
    relation: str | None
    """The relation's name, or None for a plain `[[link]]`."""
    line: int
    """The first line of `source` it is written on, which is where opening it lands."""


class Graph(BaseModel):
    """What a query drew, and for a pattern the rows it matched."""

    nodes: list[GraphNode]
    edges: list[GraphEdge]
    columns: list[str]
    """A pattern's variables in the order they are first written. Empty for a filter."""
    rows: list[dict[str, str]]
    """One binding of every column per row: a note's path, or a relation's name."""
    truncated: bool
    """More rows matched than came back."""


@dataclass
class Vault:
    """The whole graph, before any query has narrowed it."""

    nodes: dict[str, GraphNode]
    edges: list[GraphEdge]
    out: dict[str, list[GraphEdge]] = field(default_factory=lambda: defaultdict(list))
    into: dict[str, list[GraphEdge]] = field(default_factory=lambda: defaultdict(list))

    def __post_init__(self) -> None:
        """Index the edges both ways, which is what every walk below reads."""
        for edge in self.edges:
            self.out[edge.source].append(edge)
            self.into[edge.target].append(edge)

    def degree(self, path: str) -> int:
        """How many edges touch the note, in either direction."""
        return len(self.out.get(path, ())) + len(self.into.get(path, ()))


def _name(path: str) -> str:
    """The note's name: the last segment, without the suffix."""
    return path.rsplit("/", 1)[-1].removesuffix(SUFFIX)


def _under(path: str, folder: str | None) -> bool:
    """Whether `path` sits in a folder of that name anywhere, the way `search.skipping` reads it."""
    return folder is not None and folder != "" and f"/{folder}/" in f"/{path}"


def resolver(paths: list[str]) -> Callable[[str], str]:
    """`links.link_path` over one listing, with the names looked up once.

    The same answer `link_path` gives, which a test holds it to. The listing is walked once here,
    not once per link. `paths` arrives sorted, so a bare `[[name]]` resolves to the first note of
    that name, the root's before a folder's.
    """
    known = set(paths)
    by_name: dict[str, str] = {}
    for path in paths:
        by_name.setdefault(path.rsplit("/", 1)[-1].lower(), path)

    def resolve(target: str) -> str:
        path = named_path(split_target(target).name)
        if path in known or "/" in path:
            return path
        return by_name.get(path.lower(), path)

    return resolve


def link_target(written: str) -> str | None:
    """The note a link's text names, or None when it names no note.

    `links.split_target` cuts off an alias and a heading, so `[[Plan#Risks]]` names `Plan`. A link
    to a heading of its own note, and an embed of a file such as `![[plan.pdf]]`, name no note.
    """
    name = split_target(written).name
    if not name or names_a_file(name):
        return None
    return name


def _types(hits: Iterable[tuple[str, int, str]]) -> dict[str, str]:
    """Each note's `type`, read off the fences and the type lines rg found.

    `type:` counts only between a fence on line 1 and the fence closing it, as `frontmatter.py`
    reads it. The same words in a body are prose.
    """
    by_note: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for path, line, text in hits:
        by_note[path].append((line, text))

    found: dict[str, str] = {}
    for path, lines in by_note.items():
        lines.sort()
        if not lines or lines[0][0] != 1 or lines[0][1].strip() != "---":
            continue
        for _, text in lines[1:]:
            if text.strip() == "---":
                break
            match = TYPE.match(text)
            if match and match.group(1):
                found[path] = match.group(1).strip("\"'")
                break
    return found


async def read_graph(root: Path, skip: str | None = None) -> Vault:
    """Every note under `root` outside the `skip` folder, and every link between them.

    A link to a skipped note is dropped: the note exists, only filed away. A link to a note that is
    nowhere is kept as a `missing` node, showing what the vault has promised and not written.
    """
    paths = list_markdown_files(root)
    resolve = resolver(paths)

    links, fences, tags = await asyncio.gather(
        scan_vault(root, ("--fixed-strings", "-e", "[["), MOST_LINES, skip),
        # Three per note: the opening fence, the type and the closing fence. The scan then stops
        # at a note's block rather than walking every horizontal rule in its body.
        scan_vault(
            root, ("--max-count", "3", "-e", r"^---\s*$", "-e", r"^type:"), MOST_LINES, skip
        ),
        tags_by_note(root, skip),
    )

    types = _types(fences)

    nodes = {
        path: GraphNode(
            path=path,
            name=_name(path),
            type=types.get(path),
            tags=sorted(tags.get(path, ())),
            missing=False,
        )
        for path in paths
        if not _under(path, skip)
    }
    existing = set(paths)

    seen: dict[tuple[str, str, str | None], GraphEdge] = {}
    for hit in links:
        relation = RELATION.match(hit.text)
        for index, match in enumerate(WIKILINK.finditer(hit.text)):
            name = link_target(match.group(1))
            if name is None:
                continue
            target = resolve(name)
            if target == hit.path or (target in existing and target not in nodes):
                continue
            if target not in nodes:
                nodes[target] = GraphNode(
                    path=target, name=_name(target), type=None, tags=[], missing=True
                )
            # The relation's own target is the first link on its line, the name
            # and the separator holding no brackets. Any link after it is prose.
            typed = relation.group(1) if relation and index == 0 else None
            key = (hit.path, target, typed)
            if key not in seen:
                seen[key] = GraphEdge(source=hit.path, target=target, relation=typed, line=hit.line)

    # A relation line is a link as well as a relation, and one pair drawn twice
    # is noise. The plain link goes wherever a typed one says more.
    typed_pairs = {(e.source, e.target) for e in seen.values() if e.relation is not None}
    edges = [
        edge
        for edge in seen.values()
        if edge.relation is not None or (edge.source, edge.target) not in typed_pairs
    ]
    return Vault(nodes=nodes, edges=edges)
