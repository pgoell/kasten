---
type: Reference
title: Graph query
description: The language the graph pane, GET /api/graph and the agent's query_graph read, what a filter keeps, what a pattern answers, and what the graph holds in the first place.
resource: backend/src/kasten_backend/graph.py
tags: [graph, query, links, relations, backend]
status: stable
---

# Graph query

One language, read in one place. The graph pane sends what you type to
[`GET /api/graph`](/reference/http-api.md#get-apigraph) as it stands, the
agent's `query_graph` does the same, and `graph.py` is the only parser of it.

A query is one of two kinds. A **filter** narrows what is drawn. A **pattern**
asks the graph a question and answers in rows. A `?variable` anywhere in the
query makes it a pattern.

```text
type:Concept -tag:#draft                       a filter
?paper supports [[GraphRAG]]; ?paper type:Source   a pattern
```

An empty query is the whole graph.

## What the graph holds

Every note is a node. A link a note writes to another is an edge from the one
to the other.

* **A typed relation** is an edge carrying the relation's name, read by the
  rules in [Relation format](/reference/relation-format.md). A plain
  `[[link]]` is an edge with no name.
* **One edge per pair and name.** A note linking another five times draws one
  edge. Where a pair holds a typed edge, the plain link between the same two
  notes is left out, a relation line being a link as well.
* **A link resolves** the way the editor's does: a path is taken at its word,
  a bare name finds the note of that name anywhere, the root's first.
* **An alias or a heading is cut off.** `[[Louise Nong|Louise]]` and
  `[[Plan#Risks]]` are edges to `Louise Nong` and `Plan`. `[[#Risks]]` names no
  other note and is no edge.
* **An embed of a file is no edge.** `![[plan.pdf]]` names a file, not a note.
  Nor is a link to a page of HTML, `[[report.html]]`, which opens in its own
  pane rather than standing in the graph.
* **A link to itself is no edge.**
* **A note nobody has written** is a node marked `missing` when a link names
  it. Its path is the name as written, with `.md`.
* **The archive folder is left out** unless `archive` is set. A link from a
  live note to an archived one is dropped rather than drawn as missing.
* **A node's type** is the `type` field between a fence on line 1 and the fence
  closing it. `type:` further down is prose. A note with no block has none.
* **A node's tags** are every `#tag` in the note, by the rule
  [`GET /api/tags`](/reference/http-api.md#get-apitags) reads.

## Filters

Terms separated by spaces. A note is drawn when it passes every term.

| Term | Keeps |
| --- | --- |
| `type:Concept` | notes of that type, ignoring case |
| `type:"Periodic Note"` | a value with a space in it goes in quotes |
| `tag:#ai` or `tag:ai` | notes carrying the tag, or a tag under it: `tag:ai` keeps `#ai/rag` |
| `path:"02 Projects"` | notes whose path holds the text, ignoring case |
| `is:missing` | notes a link names and nobody has written |
| `is:orphan` | notes with no edge in either direction |
| `rel:depends-on` | only the edges of that relation, and the notes they join |
| `rel:*` | only typed relations, and the notes they join |
| `rel:links` | every edge, and the notes with at least one |
| `rag` or `"graph rag"` | notes whose name holds the text, ignoring case |

A `-` in front of any term turns it round: `-type:"Periodic Note"`,
`-is:missing`, `-rel:cites`.

Two `rel:` terms keep the edges matching either. A `-rel:` term drops the edges
it matches and leaves the notes where they are. A `rel:` term without the `-`
also drops every note it leaves with no edge, because a graph of one relation
is the lines it draws and not the vault around them.

`is:orphan` counts the edges of the whole graph, or of the neighbourhood when
the graph is drawn around a note, before any other term narrows it.

## Patterns

Clauses, separated by `;` or a new line. Each clause is one of two shapes.

```text
subject relation object
subject filter
```

A subject or an object is a `?variable` or a `[[note]]`. A variable stands for a
note, starts with `?`, and takes letters, digits and `_`.

The relation is one of four things:

| Relation | Matches |
| --- | --- |
| `supports` | an edge of that relation |
| `*` | any typed relation |
| `links` | any edge, typed or not |
| `?how` | any edge, the variable taking the relation's name, or `links` for a plain one |

A filter is any term from the table above except `rel:`, which belongs in the
middle of a triple: `?a supports ?b`, not `?a rel:supports`.

A row is one way to fill every variable at once so that every clause holds. A
variable used twice is the same note both times, which is what joins two
clauses.

```text
?paper supports ?idea
?idea depends-on [[Embeddings]]
?paper type:Source
```

answers every source supporting an idea that depends on Embeddings:

```json
{
  "columns": ["?paper", "?idea"],
  "rows": [{ "?paper": "GraphRAG paper.md", "?idea": "rag.md" }],
  "truncated": false
}
```

The columns are the variables in the order first written. A value is a note's
path, or for a relation variable the relation's name. Identical rows come back
once.

What is drawn beside the rows is every note in a row, every `[[note]]` the
pattern names, and every edge a row matched.

More ways in:

```text
[[GraphRAG paper]] ?how ?what             everything one note says, and how
?a links [[rag]]; ?a type:Person          the people linking a note
?a depends-on ?b; ?b depends-on ?a        two notes depending on each other
?x is:orphan; ?x path:"00 Inbox"          inbox notes nothing touches
```

## Around a note

`around` names a note and `depth` how many edges out from it to reach, either
way along an edge. This is the local graph. `depth` runs from 0, the note
alone, to 5, and is 1 when not given.

The neighbourhood is taken first and the query applied inside it. A filter
never removes the note the graph is drawn around. A pattern is matched inside
the neighbourhood too.

`around` is resolved the way a link is, so a bare name works. A note that is
not in the graph is refused.

## Limits

| Limit | Value | What happens |
| --- | --- | --- |
| Rows | 500 | the rest are dropped and `truncated` is true |
| Partial answers between two clauses | 100,000 | the query is refused as too broad |
| Lines read by one scan | 200,000 | the rest of the vault is not read |

Two clauses that share no variable multiply. `?a links ?b; ?c links ?d` over a
vault of 1,000 edges is a million partial answers and is refused. Name a note,
a type or a relation to narrow it.

## What a query is refused for

Each is a `400` whose `detail` says which, and the pane shows that sentence
under the filter line.

* A filter key the language has not got, such as `colour:red`.
* `is:` with anything but `missing` or `orphan`.
* A term with no value, such as `type:`.
* A `[[note]]` in a filter rather than a pattern.
* A clause that is neither shape, such as `?a` or `?a supports`.
* A relation that is not a name, `*`, `links` or a variable.
* `rel:` inside a pattern.
* One variable standing for a note in one place and a relation in another.
* Text the reader cannot split into terms, such as an unclosed quote.
