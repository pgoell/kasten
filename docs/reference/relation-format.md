---
type: Reference
title: Relation format
description: The line a typed relation is written on, the nine rules of its grammar, how the backlinks panel groups by it, and the one thing it reads that it should not.
resource: frontend/src/lib/relation.ts
tags: [vault, links, format, frontend]
status: stable
---

# Relation format

A relation is one line of a note. The line is the whole record: nothing about a
relation is held anywhere else, so a vault read by Obsidian, by another editor
or by `cat` carries every relation in it.

```markdown
depends-on:: [[Embeddings]]
- supports:: [[GraphRAG paper]]
  contradicts:: [[Naive RAG]] and the paper says why
```

A name, `:: `, and the note it points at. It is Dataview's inline field, which
is what a reader coming from Obsidian already knows, with one rule of our own
noted under [the separator](#3-the-separator-carries-a-space).

A plain [wikilink](/reference/editor-keys.md#wikilinks) says two notes are
connected. A relation says how.

## The nine rules

### 1. The prefix

Up to three spaces of indent, then either nothing or exactly `- `.

Every other prefix is a plain line: `+`, `*`, `1.`, `1)`, `- - `, a task marker
between the bullet and the name, and a tab in place of the spaces.

Three spaces and not any number, because four opens a code block and a code
block should not become a relation. That cap takes two more things with it, and
they are the price of the one rule: a bullet nested two levels deep, and a line
indented with a tab. Both are cheap to allow later if the writing wants them.

### 2. The name

It starts with a lowercase letter and holds lowercase letters and hyphens.

So `depends-on` and `supports` are names, and `Depends-on`, `depends2` and
`depends_on` are not.

### 3. The separator carries a space

`:: ` follows the name, the space included. `depends-on::[[A]]` is a plain
line.

Dataview accepts it without the space and we do not, because the space is what
makes `GET /api/search?q=":: "` a candidate superset of every relation in the
vault. That is the whole reason there is no endpoint for relations.

### 4. The target follows the separator

The target is the wikilink immediately after it, horizontal whitespace aside.
Prose between the separator and the link means this is not a relation, so
`depends-on:: not really [[A]]` is a plain line.

### 5. The target is a wikilink

It has to be a wikilink the editor's own parser would accept: not empty, no
brackets, no line break. `depends-on:: [[   ]]` is a plain line. One grammar for
links, not two.

### 6. No wikilink, no relation

A line with no wikilink on it is a plain line, which keeps `std::vector is fast`
and every URL out.

### 7. What follows the target is prose

Everything after the target is ignored, so a relation can say why on its own
line.

### 8. One relation, one target

One relation and one target per line. A second wikilink is prose.

### 9. An unknown name is valid

A name nothing has defined is a relation, and it groups under its own spelling.

## What the editor draws

The `name::` in front is drawn as a label and the wikilink beside it is drawn
the way a wikilink is drawn anywhere else. The label hides nothing, so the
prefix reads the same in normal mode and in insert mode, the way a tag does.
The wikilink keeps its own rule: the brackets are hidden until the cursor is
inside them, exactly as on a line that is not a relation.

## How the backlinks panel groups

[`<leader>gb`](/reference/editor-keys.md#the-link-panels) over a note draws one
heading per relation name pointing at it, with the untyped links last under no
heading of their own. The rows under a heading keep the order they ranked in,
and the headings come in the order their first row does.

**A hit is typed only when the relation's target resolves to the note being
viewed.** The panel keeps a line when any wikilink on it resolves, so
`depends-on:: [[A]] because [[B]]` shows in B's panel too. Grouping that by the
name alone would tell you B is a dependency when the line says A is. Where the
target is another note, the hit goes in the untyped group.

## The accepted cost

A line inside a fenced code block that reads like a relation is read as one.

Search knows nothing about fences, and neither does the backlinks panel: such a
line already shows there today if it holds a wikilink. Reading fences would mean
a parser over every answer for the sake of a line nobody writes by accident, and
it is not worth one. An indented code block is out already, by rule 1.
