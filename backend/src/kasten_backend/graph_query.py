"""The query language the graph pane, `GET /api/graph` and the agent's `query_graph` share.

One parser for every caller, so the pane sends what was typed and draws what
comes back. This module hides the token rules, the filter and pattern forms,
and the join that answers a pattern. A filter narrows the drawing:
`type:Concept -tag:#draft`. A pattern asks the graph a question and answers in
rows: `?paper supports [[GraphRAG]]; ?paper type:Source`. A `?variable`
anywhere is what makes a query a pattern.
"""

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from kasten_backend.graph import (
    MOST_DEPTH,
    Graph,
    GraphEdge,
    GraphError,
    GraphNode,
    _target,
    _Vault,
    read_graph,
    resolver,
)
from kasten_backend.vault import SUFFIX

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable
    from pathlib import Path

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

NAME = re.compile(r"[a-z][a-z-]*")
"""A relation's name, rule 2 of the format."""

TOO_BROAD = "That pattern matches too much to answer. Name a note, a type or a relation"

ANY_RELATION = "*"
"""The predicate, and the `rel:` value, matching any typed relation."""

ANY_LINK = "links"
"""The predicate, and the `rel:` value, matching every edge, typed or not."""

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
        # A path is taken as given before it is read as a link: `plan.pdf.md`
        # is a note, where the link `[[plan.pdf]]` names the pdf.
        if around in graph.nodes:
            center = around
        else:
            center = resolver(sorted(graph.nodes))(around.removesuffix(SUFFIX))
        if center not in graph.nodes:
            raise GraphError(f"{around} is not in the graph")
        graph = _narrowed(graph, _around(graph, center, max(0, min(depth, MOST_DEPTH))))

    if any(token.kind == "var" for token in tokens):
        return _pattern(graph, tokens, resolver(sorted(graph.nodes)))
    return _filter(graph, tokens, center)
