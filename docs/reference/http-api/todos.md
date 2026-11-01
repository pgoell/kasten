---
type: Reference
title: "HTTP API: todos"
description: The route that finds every todo line in the vault, and works out which project each one belongs to.
resource: backend/src/kasten_backend/routes/queries.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: todos

The route that finds every todo line in the vault, and works out which project each one belongs to.

## GET /api/todos

Finds every line in the vault that could be a todo. Takes an optional
`archive` and answers with at most 100,000 matches, in the shape
`GET /api/search` returns plus a `project` and a `shared` on each.

```json
[{ "path": "02 Projects/kasten/plan.md", "line": 12, "text": "- [/] wire up the pane 📅 2026-08-14 ⏫", "project": "02 Projects/kasten", "shared": false }]
```

`shared` is `true` when the todo's note sits directly inside the share folder,
`05 Shared` by default: `05 Shared/Einkauf.md` is shared, `05 Shared/sub/x.md`
and `05 Sharedx/a.md` are not. It is the rule the share lists are read by, so
the client can hide the shared lists from the todo views without a rule of its
own.

One `rg` pass, carrying the same flags search carries, so this and
`GET /api/files` cannot disagree about which notes the vault holds. Nothing is
indexed and Postgres is not consulted, for the reason search does not consult
it: the files are the source of truth.

It matches two shapes, and sends the lines below that end a todo's parts:

* a checkbox list item at any indent, in any of
  [the seven states](/reference/todo-format/state-changes.md#the-seven-states): `- [ ]`,
  `- [/]`, `- [r]`, `- [x]`, `- [X]`, `- [b]`, `- [w]` or `- [-]`
* a running session line, `- 14:03- …`, with no end time on it

`[X]` is matched because another editor writes it that way, and `[R]` is not,
because nothing does. `[` is not one of
the state characters, which is what keeps `- [[borges]]` out, and the `- `
anchor is what keeps `1. [ ] ordered` out. The done log's `- ✅` line does not
match either, which is
[the whole reason it is not a checkbox](/reference/todo-format/time-and-repeats.md#the-done-log).

A closed session line, `- 09:12-10:32 …`, is deliberately not matched. The pane's
`t` writes both spellings into the
[time log](/reference/todo-format/time-and-repeats.md#the-time-log), and a running one comes back
in the same pass as the todos because the view wants to know what is going. A
closed one says nothing the task line does not already carry, the total being on
it, and the closed ones are the half of that log that piles up. A stop reads them
through `GET /api/search` on the todo's id instead, which is one narrow pass at
the press rather than a growing answer on every fetch.

The endpoint serves no todo's state or fields. It hands the lines over whole,
because the editor has to parse a line anyway and two parsers in two languages
drift. Whether one of them is open or overdue is read on the client, off the
same module the editor draws a todo with. That is also how the client tells a
session line from a todo, which is why one endpoint can answer both. The one
thing the backend works out is `project`, below, and to find the words it reads
a project from, it takes the fields off a line the way the editor does.

### The project

`project` is the project folder a todo belongs to, as a path from the vault
root, `"02 Projects/FDE"`, or `null` for none. The board draws its lanes by it,
and an agent reading this endpoint sees the same lanes. The first of these that
answers wins:

1. A `#p/x` tag on the todo, else on the nearest todo above it that it is a part
   of and that carries one.
2. The note's project folder: a folder directly under `02 Projects` or
   `03 Areas`, with the note at any depth inside it. A note directly in one of
   those two, or outside them, has none.
3. The first `[[link]]` on the line that lands on a note that exists, in a
   folder under `02 Projects`. Areas do not count here.
4. The project of the todo it is a part of, by this same rule.
5. `null`.

Tags and links are read off the todo's words, as the editor parses them: a
link inside a field's value, such as `👤 2026-10-01 [[Vendor]]` or
`🔁 every week [[Vendor]]`, files nothing.

A part is a todo indented under another: its parent is the nearest todo above
it in the same note with a smaller indent, a tab counting as one, with prose in
between ending nothing. A heading, or a list item that is no todo, ends the parts
above it at its indent, as the
[writes end them](/reference/todo-format/state-changes.md#subtasks). A
session line is no todo, has `project: null` and is nobody's parent, and so is
a line the editor does not read as a todo, such as one holding a lone `\r`,
U+2028 or U+2029. Done, rejected and archived todos follow the same rule.

How a tag names a folder:

* A tag is read as Obsidian reads one: a letter or `_`, then letters, digits,
  `_`, `/` and `-`, with no letter, digit, `_` or `/` straight before the `#`.
  So `#p/fde.` at the end of a sentence is `#p/fde`. Inside a `[[link]]` or a
  code span counts too, as it does for the board's own tags.
* `#p/` matches with case ignored, so `#P/FDE` counts.
* `#p/x/y` names `x`, and `#p/` alone names nothing.
* `x` names a folder directly under `02 Projects` that holds at least one note.
  Case is ignored, and a `-` or `_` on either side stands for a space:
  `#p/japan-honeymoon-2027` names `02 Projects/Japan Honeymoon 2027`.
* A tag that names no folder is passed over. Of two tags, the first, left to
  right, that names a folder wins.

A link lands when it resolves, by the rule `GET /api/files` and the editor
share, to a note in that listing, which holds the archive too.

The cap is 100,000 rather than search's 2,000, and the two numbers are doing
different jobs. Search guards a query that can match anything in the vault. This
one is a backstop against a single generated file with a million list items in
it, and nothing else: reaching it truncates the answer silently, which is why it
sits where nothing written by hand reaches it.

### Fences and the lines that end parts

`rg` matches a line rather than a parse tree, so the pass also asks for every
line opening with three backticks or tildes. A note with such a line, or with an
indented todo, is then read whole (#1445):

* A line inside a fenced code block is dropped, a `- [ ]` in a note about
  markdown among them. Fences are found in the body alone, as the editor finds
  them, so a fence the frontmatter seems to open hides nothing.
* In a note with an indented todo, every heading and every list item that is no
  todo, between the first todo and the last indented one, comes back as a line
  of its own with `project: null`. Those are what can end a part, and the pane
  reads them to draw what ticks together. A client that wants todos alone keeps
  the lines its own todo parser reads, as it does for session lines.

The fence lines themselves never come back, and a note whose only hits are
fence lines is not read. On the live vault, 33 of the 136 notes holding a todo
are read whole, which adds 15 to 20 ms to the answer.

A vault directory that does not exist reads as an empty one, so a fresh
checkout still serves.

