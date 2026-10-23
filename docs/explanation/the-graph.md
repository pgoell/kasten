---
type: Explanation
title: The graph
description: Why the graph is read off the vault on every request, why its query is parsed on the backend when todos and cards are parsed in the browser, and why the query language is so small.
tags: [design, graph, links, relations, query]
status: stable
---

# The graph

The vault has always been a graph. Every `[[link]]` is an edge, and since
[typed relations](/reference/relation-format.md) every `depends-on::` is an edge
that says what it means. What was missing was a way to see it whole and a way
to ask it something. The graph pane is the first, and the query language behind
it is the second.

## Read off the vault, every time

There is no graph table. Each request runs three `rg` passes over the notes,
the lines holding a link, the fences of each note's block, and the tags, and
builds the graph from what comes back. On the prod vault that is about 50ms.

This is [the rule the whole system keeps](/explanation/vault-and-derived-index.md):
the files are the truth and anything else is derived. A graph kept in Postgres
would be one more thing to rebuild, and one more place that could say a link
exists after you deleted the line holding it. Search, the todo list, the review
and the tag completion all read the vault per request for the same reason, and
the graph is one more reader of the same kind.

The cost shows at 10,000 notes, not at 300: the answer grows with the vault,
and the whole-vault drawing is a lot of JSON. The local graph and a pattern are
what keep an answer small, which is why the agent's tool tells a model to
prefer them.

## Parsed on the backend, unlike todos

Todos, cards and the person card all ask the backend for candidate lines and
decide in the browser what the lines mean. That keeps one reader of each format
in one language, the editor's.

The graph breaks that pattern on purpose. An agent asks the graph questions
too, and an agent has no browser. If the pane parsed the query, the agent's
tool would need a second parser in Python, and the two would drift apart the
first time one of them learned a new term. So the query goes over the wire as
typed, `graph_query.py` reads it, and the pane only draws what comes back. One
parser, three callers: the pane, `GET /api/graph` and `query_graph`.

The price is paid in the link rules instead. The editor resolves a link and
reads a relation in TypeScript; the graph does both again in Python. That is
the price `links.py` already pays to rewrite links on a move, and it is paid
the same way: a copy of the rule, a comment pointing at the other copy, and
tests on both sides describing the same lines.

## Aliases and headings

The graph cuts `|alias` and `#heading` off a link before resolving it, and the
editor does not yet. Without it, the prod vault's `[[Louise Nong|Louise]]`
would draw a second, missing Louise beside the real one, and the graph would be
wrong on the first vault it met. So the graph reads links as Obsidian writes
them, and the editor's `gf` and link panels are left to catch up. That is a
known difference between two readers of one format, and
[Relation format](/reference/relation-format.md#how-the-graph-reads-it) says so
where a reader of the format will look.

## Why the language is so small

The obvious choices were Cypher or SPARQL. Both are languages to learn and
libraries to carry, and both answer questions a personal vault does not ask:
aggregation, optional matches, paths of any length.

What a vault does ask fits in two shapes. A filter, because the first thing
anyone does with a whole-vault graph is hide most of it, and Obsidian's
`tag:` and `path:` are already in the hands of anyone coming from there. A
pattern, because the questions worth asking are joins: which sources support
an idea that depends on this one, who links to a note and is a person. A triple
per clause and a shared variable to join them is the smallest thing that
answers those, and it reads like the relation lines it matches:
`?paper supports [[GraphRAG]]` is the line `supports:: [[GraphRAG]]` with the
subject left open.

The matcher is a plain nested loop that runs the most fixed clause first. It
refuses rather than grinding when two clauses share no variable and the partial
answers pass 100,000, because a query that holds the event loop for a minute
is worse than one that says to name a note.

## The drawing

The pane draws with [force-graph](https://github.com/vasturiano/force-graph)
(MIT), a canvas over d3's force simulation, which is what gives it Obsidian's
look without writing a layout engine: dots that repel, links that pull, and
zoom and drag for free. What kasten adds is the look: size by edge count,
colour by the ontology's types around a note, arrows only on typed relations,
names that fade in with the zoom. A new answer reuses the objects of notes
already drawn, so a filter taking notes away moves nothing that stays.

## Places and tags

A whole vault drawn by springs alone is a hairball: every note pulls on every
other, and the folders you filed things in leave no trace. So the vault graph
(`Space gg`) gives the notes places, like towns on a map. In Folders mode each
top folder gets a spot, and a project gets its own spot under a folder whose
name ends in "Projects". In Tags mode each tag gets one, and a note with two
tags is pulled to the point between them. Links between places then read as
roads.

The layout is Fruchterman-Reingold, built from d3's forces inside the same
simulation: the many-body force pushes every pair apart by `k²/d`, a link pulls
its ends together by `d²/k`, a spring pulls each note to its spot, and a weak
gravity pulls everything to the middle, so a note with no place rings the
clusters instead of drifting to the edge. The spots sit on a golden-angle
spiral, biggest place first, and the simulation runs a fixed number of ticks
with d3's seeded random source and no wall-clock cut, so the same vault comes
out the same on every open. It runs one tick per frame, so typing in another
pane never waits on it.

Colour is the first tag, by the same hash as the margin graph, and each further
tag adds a thin ring in its own colour. A soft round area at 8 % (11 % in dark)
shows each place. The 300 px panel beside the canvas counts what is drawn,
switches the mode, hides tags, and shows the note under the pointer. The mode
is kept per device; [the editor keys](/reference/editor-keys/panes-and-tabs.md)
name the key that switches it.
