"""The notes as a graph: every note a node, every link between two an edge.

Built from the vault on every request, the way search, todos and tags are, and
for the same reason: the files are the source of truth, and a graph held
anywhere else is one that can disagree with them. Three rg passes read what the
graph needs, the lines holding a link, the frontmatter fences with the `type`
between them, and the tags, and at 10,000 notes that is tens of milliseconds.

One query language serves the graph pane's filter box, `GET /api/graph` and the
agent's `query_graph`, and this module is its only reader. The pane sends what
was typed and draws what comes back, so there is one parser rather than one per
language, and the reference page is `docs/reference/graph-query.md`.

Two kinds of query share the language. A filter narrows the drawing:
`type:Concept -tag:#draft`. A pattern asks the graph a question and answers in
rows: `?paper supports [[GraphRAG]]; ?paper type:Source`. A `?variable`
anywhere is what makes a query a pattern.
"""

import asyncio
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from pydantic import BaseModel

from kasten_backend.search import scan_vault
from kasten_backend.tags import TAG
from kasten_backend.vault import ASSET_MAGIC, HTML_SUFFIX, SUFFIX, list_markdown_files

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable
    from pathlib import Path

MOST_LINES = 200_000
"""How many lines one of the three scans reads at most.

A backstop against a generated file rather than a limit on a vault: the
10,000 note vault the ranking is measured on holds about 50,000 lines with a
link on them.
"""

MOST_ROWS = 500
"""How many rows a pattern answers with at most.

What a person reads or an agent's context holds, not what the matcher can
find. An answer that reaches it says so, and a narrower pattern is the fix.
"""

MOST_BINDINGS = 100_000
"""How many partial answers a pattern may hold between two clauses.

Two clauses that share no variable multiply, and three of them over a large
vault is billions of rows. The matcher refuses past this rather than holding
the event loop while it counts them.
"""

MOST_DEPTH = 5
"""How far out a local graph reaches. Five links from any note is most vaults."""

WIKILINK = re.compile(r"\[\[([^\[\]\n]+)\]\]")
"""One `[[link]]`, spelled the way `links.py` and the editor's parser spell it."""

RELATION = re.compile(r"^ {0,3}(?:- )?([a-z][a-z-]*):: [ \t]*\[\[([^\[\]\n]+)\]\]")
"""`name:: [[target]]`, the rule `frontend/src/lib/relation.ts` reads.

A copy of that one, for the reason `links.py` holds a copy of the link rule:
the editor draws a relation without asking the server, and the graph is built
without asking the editor. `docs/reference/relation-format.md` is what both
answer to, and the tests on both sides describe the same lines.
"""

TYPE = re.compile(r"^type:\s*(.*?)\s*$")
"""The `type` field of the block, the one line of it the graph reads."""

NAME = re.compile(r"[a-z][a-z-]*")
"""A relation's name, rule 2 of the format."""

TOO_BROAD = "That pattern matches too much to answer. Name a note, a type or a relation"

ANY_RELATION = "*"
"""The predicate, and the `rel:` value, matching any typed relation."""

ANY_LINK = "links"
"""The predicate, and the `rel:` value, matching every edge, typed or not."""

ASSET_SUFFIXES = frozenset((*ASSET_MAGIC, HTML_SUFFIX))
"""What a link names when it names a file rather than a note: `![[plan.pdf]]`, `[[report.html]]`."""


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
class _Vault:
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

    The same answer `link_path` gives, and a test holds them to it. The listing
    is walked once here rather than once per link, which is the difference
    between a millisecond and a minute at 10,000 notes and 50,000 links.
    `paths` arrives sorted, so the first note of a name is the one a bare
    `[[name]]` resolves to, the root's before a folder's.
    """
    known = set(paths)
    by_name: dict[str, str] = {}
    for path in paths:
        by_name.setdefault(path.rsplit("/", 1)[-1].lower(), path)

    def resolve(target: str) -> str:
        typed = target.strip()
        path = typed if typed.endswith(SUFFIX) else f"{typed}{SUFFIX}"
        if path in known or "/" in path:
            return path
        return by_name.get(path.lower(), path)

    return resolve


def _target(written: str) -> str | None:
    """The note a link's text names, or None when it names no note.

    Obsidian's alias and heading are cut off, so `[[Louise Nong|Louise]]` and
    `[[Plan#Risks]]` are links to `Louise Nong` and `Plan`. A link to a heading
    of its own note, `[[#Risks]]`, names no other note, and an embed of a file,
    `![[plan.pdf]]`, names a file rather than a note.
    """
    name = written.split("|", 1)[0].split("#", 1)[0].strip()
    if not name:
        return None
    suffix = name.rsplit(".", 1)[-1].lower() if "." in name.rsplit("/", 1)[-1] else ""
    return None if f".{suffix}" in ASSET_SUFFIXES else name


def _types(hits: Iterable[tuple[str, int, str]]) -> dict[str, str]:
    """Each note's `type`, read off the fences and the type lines rg found.

    A `type:` counts only between a fence on line 1 and the fence closing it,
    which is where `frontmatter.py` reads the block. The same words in the body
    of a note are prose.
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


async def read_graph(root: Path, skip: str | None = None) -> _Vault:
    """Every note under `root` outside the `skip` folder, and every link between them.

    A link to a note that is there but skipped is dropped rather than drawn as a
    note nobody wrote: the note exists, it is only filed away. A link to a note
    that is nowhere is kept, and its target is a node marked `missing`, which is
    how the graph shows what the vault has promised and not yet written.
    """
    paths = list_markdown_files(root)
    resolve = resolver(paths)

    links, fences, tags = await asyncio.gather(
        scan_vault(root, ("--fixed-strings", "-e", "[["), MOST_LINES, skip),
        # Three per note is the opening fence, the type and the closing fence
        # of any block that holds a type, and the scan stops reading a note
        # there rather than walking every horizontal rule in its body.
        scan_vault(
            root, ("--max-count", "3", "-e", r"^---\s*$", "-e", r"^type:"), MOST_LINES, skip
        ),
        scan_vault(root, ("--only-matching", "-e", TAG), MOST_LINES, skip),
    )

    types = _types(fences)
    tagged: dict[str, set[str]] = defaultdict(set)
    for hit in tags:
        tagged[hit.path].add(hit.text[hit.text.rindex("#") :])

    nodes = {
        path: GraphNode(
            path=path,
            name=_name(path),
            type=types.get(path),
            tags=sorted(tagged.get(path, ())),
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
            name = _target(match.group(1))
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
    return _Vault(nodes=nodes, edges=edges)


# The query language


TOKEN = re.compile(
    r"""[ \t\r]*(?:
        (?P<sep>[;\n])
      | (?P<link>\[\[[^\[\]\n]+\]\])
      | (?P<var>\?[A-Za-z_]\w*)
      | (?P<term>-?[a-z]+:(?:"[^"\n]*"|[^\s;"]+))
      | (?P<quoted>-?"[^"\n]*")
      | (?P<word>-?[^\s;"]+)
    )""",
    re.VERBOSE,
)

NODE_KEYS = frozenset({"type", "tag", "path", "is"})
"""The filter keys a note is tested against."""

IS_VALUES = frozenset({"missing", "orphan"})


@dataclass(frozen=True)
class _Token:
    kind: str
    text: str


@dataclass(frozen=True)
class _Term:
    """One filter: `type:Concept`, `-tag:#draft`, or a bare word naming notes."""

    key: str
    """`type`, `tag`, `path`, `is`, `rel`, or `name` for a bare word."""
    value: str
    negated: bool


def _tokens(query: str) -> list[_Token]:
    tokens = []
    at = 0
    while at < len(query):
        if query[at:].strip(" \t\r") == "":
            break
        match = TOKEN.match(query, at)
        if match is None or match.end() == at:
            raise GraphError(f"Cannot read the query from {query[at:].strip()!r}")
        kind = match.lastgroup or ""
        tokens.append(_Token(kind, match.group(kind)))
        at = match.end()
    return tokens


def _unquote(text: str) -> str:
    return text[1:-1] if len(text) > 1 and text[0] == text[-1] == '"' else text


def _term(token: _Token) -> _Term:
    """A filter term out of one token, refusing a key the language has not got."""
    text = token.text
    negated = text.startswith("-")
    if negated:
        text = text[1:]

    if token.kind in {"word", "quoted"}:
        return _Term("name", _unquote(text), negated)

    key, _, value = text.partition(":")
    value = _unquote(value)
    if key not in NODE_KEYS and key != "rel":
        raise GraphError(f"No filter is called {key}:. There are type:, tag:, path:, rel: and is:")
    if key == "is" and value not in IS_VALUES:
        raise GraphError(f"is:{value} means nothing. There are is:missing and is:orphan")
    if not value:
        raise GraphError(f"{key}: needs a value")
    return _Term(key, value, negated)


def _matches(term: _Term, node: GraphNode, graph: _Vault) -> bool:
    """Whether one note passes one node term, before the term's `-` is applied."""
    value = term.value.lower()
    match term.key:
        case "type":
            return node.type is not None and node.type.lower() == value
        case "tag":
            wanted = value if value.startswith("#") else f"#{value}"
            return any(t.lower() == wanted or t.lower().startswith(f"{wanted}/") for t in node.tags)
        case "path":
            return value in node.path.lower()
        case "is":
            return node.missing if value == "missing" else graph.degree(node.path) == 0
        case _:
            return value in node.name.lower()


def _passes(terms: Iterable[_Term], node: GraphNode, graph: _Vault) -> bool:
    return all(_matches(term, node, graph) != term.negated for term in terms)


def _relation_matches(predicate: str, edge: GraphEdge) -> bool:
    if predicate == ANY_LINK:
        return True
    if predicate == ANY_RELATION:
        return edge.relation is not None
    return edge.relation == predicate


def _around(graph: _Vault, center: str, depth: int) -> set[str]:
    """Every note within `depth` links of `center`, whichever way the links point."""
    reached = {center}
    frontier = {center}
    for _ in range(depth):
        step = set()
        for path in frontier:
            step.update(edge.target for edge in graph.out.get(path, ()))
            step.update(edge.source for edge in graph.into.get(path, ()))
        frontier = step - reached
        reached |= frontier
    return reached


def _narrowed(graph: _Vault, keep: set[str]) -> _Vault:
    return _Vault(
        nodes={path: node for path, node in graph.nodes.items() if path in keep},
        edges=[e for e in graph.edges if e.source in keep and e.target in keep],
    )


def _filter(graph: _Vault, tokens: list[_Token], center: str | None) -> Graph:
    terms = [_term(token) for token in tokens if token.kind != "sep"]
    if any(token.kind == "link" for token in tokens):
        raise GraphError("A [[link]] belongs in a pattern, beside a ?variable")

    node_terms = [term for term in terms if term.key != "rel"]
    wanted = {term.value for term in terms if term.key == "rel" and not term.negated}
    unwanted = {term.value for term in terms if term.key == "rel" and term.negated}

    nodes = {
        path: node
        for path, node in graph.nodes.items()
        if path == center or _passes(node_terms, node, graph)
    }
    edges = [
        edge
        for edge in graph.edges
        if edge.source in nodes
        and edge.target in nodes
        and (not wanted or any(_relation_matches(w, edge) for w in wanted))
        and not any(_relation_matches(u, edge) for u in unwanted)
    ]
    # Asking for a relation is asking for the notes it joins. The rest of the
    # vault would be a cloud of dots around the few lines that answer.
    if wanted:
        joined = {e.source for e in edges} | {e.target for e in edges}
        nodes = {path: node for path, node in nodes.items() if path in joined or path == center}

    return Graph(nodes=list(nodes.values()), edges=edges, columns=[], rows=[], truncated=False)


# Patterns


@dataclass(frozen=True)
class _Triple:
    subject: str
    predicate: str
    object: str


@dataclass(frozen=True)
class _Test:
    subject: str
    term: _Term


type _Clause = _Triple | _Test
type _Binding = tuple[dict[str, str], frozenset[int]]
"""A partial answer: each variable's value, and the edges that matched it, by index."""


def _is_var(text: str) -> bool:
    return text.startswith("?")


def _clauses(tokens: list[_Token], resolve: Callable[[str], str]) -> list[_Clause]:
    """The pattern's clauses, each a triple or a test, with every `[[link]]` a path."""

    def node(token: _Token, clause: str) -> str:
        if token.kind == "var":
            return token.text
        if token.kind == "link":
            name = _target(token.text[2:-2])
            if name is None:
                raise GraphError(f"{token.text} names no note, in {clause!r}")
            return resolve(name)
        raise GraphError(f"{token.text!r} is not a ?variable or a [[note]], in {clause!r}")

    groups: list[list[_Token]] = [[]]
    for token in tokens:
        if token.kind == "sep":
            groups.append([])
        else:
            groups[-1].append(token)

    clauses: list[_Clause] = []
    for group in groups:
        if not group:
            continue
        written = " ".join(token.text for token in group)
        match group:
            case [subject, filtering] if filtering.kind == "term":
                term = _term(filtering)
                if term.key == "rel":
                    raise GraphError(f"rel: filters a drawing. In {written!r} put it in the middle")
                clauses.append(_Test(node(subject, written), term))
            case [subject, relation, target] if relation.kind in {"word", "var"}:
                predicate = relation.text
                if relation.kind == "word" and not (
                    predicate in {ANY_LINK, ANY_RELATION} or NAME.fullmatch(predicate)
                ):
                    raise GraphError(f"{predicate!r} is not a relation name, in {written!r}")
                clauses.append(_Triple(node(subject, written), predicate, node(target, written)))
            case _:
                raise GraphError(
                    f"Cannot read {written!r}. A clause is `subject relation object` "
                    "or `subject filter`"
                )
    return clauses


def _places(clause: _Clause) -> list[str]:
    """What a clause names, in the order written: a test has one place, a triple three.

    Every other place is a note, `[::2]`, and the middle of a triple is a relation.
    """
    if isinstance(clause, _Test):
        return [clause.subject]
    return [clause.subject, clause.predicate, clause.object]


def _columns(clauses: list[_Clause]) -> list[str]:
    """The variables in the order written, refusing one used as a note and as a relation."""
    notes = {name for c in clauses for name in _places(c)[::2] if _is_var(name)}
    relations = {c.predicate for c in clauses if isinstance(c, _Triple) and _is_var(c.predicate)}
    if both := notes & relations:
        raise GraphError(f"{sorted(both)[0]} stands for a note and a relation at once")

    order: list[str] = []
    for clause in clauses:
        order.extend(name for name in _places(clause) if _is_var(name) and name not in order)
    return order


def _bound(clause: _Clause, known: set[str]) -> int:
    """How many places of the clause are already fixed, which is how cheap it is to run next."""
    return sum(1 for name in _places(clause) if not _is_var(name) or name in known)


def _value(name: str, binding: dict[str, str]) -> str | None:
    return binding.get(name) if _is_var(name) else name


def _tested(clause: _Test, graph: _Vault, binding: _Binding) -> list[_Binding]:
    """The binding once for each note the test lets through, naming it when it was open."""
    values, used = binding
    subject = _value(clause.subject, values)
    if subject is not None:
        node = graph.nodes.get(subject)
        passes = node is not None and _matches(clause.term, node, graph) != clause.term.negated
        return [binding] if passes else []
    return [
        ({**values, clause.subject: node.path}, used)
        for node in graph.nodes.values()
        if _matches(clause.term, node, graph) != clause.term.negated
    ]


def _joined(clause: _Triple, graph: _Vault, binding: _Binding) -> list[_Binding]:
    """The binding once for each edge the triple matches, its open places filled in."""
    values, used = binding
    subject = _value(clause.subject, values)
    target = _value(clause.object, values)
    predicate = _value(clause.predicate, values)
    if subject is not None:
        edges = graph.out.get(subject, [])
    elif target is not None:
        edges = graph.into.get(target, [])
    else:
        edges = graph.edges

    grown: list[_Binding] = []
    for edge in edges:
        name = edge.relation or ANY_LINK
        if predicate is not None and not (
            name == predicate if _is_var(clause.predicate) else _relation_matches(predicate, edge)
        ):
            continue
        extended = dict(values)
        places = ((clause.subject, edge.source), (clause.object, edge.target))
        places += ((clause.predicate, name),)
        # `setdefault` is what makes `?a links ?a` mean a note linking itself:
        # a variable already filled has to agree with the edge, not be overwritten.
        if all(extended.setdefault(p, v) == v for p, v in places if _is_var(p)) and all(
            p == v for p, v in places[:2] if not _is_var(p)
        ):
            grown.append((extended, used | {id(edge)}))
    return grown


def _step(clause: _Clause, graph: _Vault, bindings: list[_Binding]) -> list[_Binding]:
    """Every extension of every partial answer that the clause allows."""
    grown: list[_Binding] = []
    for binding in bindings:
        if isinstance(clause, _Test):
            grown.extend(_tested(clause, graph, binding))
        else:
            grown.extend(_joined(clause, graph, binding))
        if len(grown) > MOST_BINDINGS:
            raise GraphError(TOO_BROAD)
    return grown


def _pattern(graph: _Vault, tokens: list[_Token], resolve: Callable[[str], str]) -> Graph:
    clauses = _clauses(tokens, resolve)
    columns = _columns(clauses)

    bindings: list[_Binding] = [({}, frozenset())]
    pending = list(clauses)
    while pending and bindings:
        known = set(bindings[0][0])
        # The clause with the most places already fixed goes next, the first
        # written among equals. A clause naming a note walks that note's edges
        # rather than the whole vault's.
        clause = max(pending, key=lambda c: _bound(c, known))
        pending.remove(clause)
        bindings = _step(clause, graph, bindings)

    rows: dict[tuple[str, ...], dict[str, str]] = {}
    used: set[int] = set()
    truncated = False
    for values, edges in bindings:
        key = tuple(values[column] for column in columns)
        if key in rows:
            used |= edges
        elif len(rows) == MOST_ROWS:
            truncated = True
        else:
            rows[key] = {column: values[column] for column in columns}
            used |= edges

    matched = [edge for edge in graph.edges if id(edge) in used]
    relations = {c.predicate for c in clauses if isinstance(c, _Triple) and _is_var(c.predicate)}
    shown = {v for row in rows.values() for column, v in row.items() if column not in relations}
    shown |= {name for c in clauses for name in _places(c)[::2] if not _is_var(name)}
    shown |= {e.source for e in matched} | {e.target for e in matched}

    return Graph(
        nodes=[node for path, node in graph.nodes.items() if path in shown],
        edges=matched,
        columns=columns,
        rows=list(rows.values()),
        truncated=truncated,
    )


async def query_graph(
    root: Path,
    query: str = "",
    around: str | None = None,
    depth: int = 1,
    skip: str | None = None,
) -> Graph:
    """The graph a query draws: the whole vault, a note's neighbourhood, a filter or a pattern.

    `around` names a note and `depth` how many links out from it to reach,
    which is the local graph. The neighbourhood is taken first and the query
    applied inside it, and the note itself stays drawn whatever the filter says,
    the way Obsidian's local graph keeps its centre.
    """
    graph = await read_graph(root, skip)
    tokens = _tokens(query)

    center = None
    if around is not None:
        center = resolver(sorted(graph.nodes))(around.removesuffix(SUFFIX))
        if center not in graph.nodes:
            raise GraphError(f"{around} is not in the graph")
        graph = _narrowed(graph, _around(graph, center, max(0, min(depth, MOST_DEPTH))))

    if any(token.kind == "var" for token in tokens):
        return _pattern(graph, tokens, resolver(sorted(graph.nodes)))
    return _filter(graph, tokens, center)
