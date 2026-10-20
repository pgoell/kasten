---
type: Reference
title: Todo format
description: The line a todo is written on, every field it carries, the seven states, the cycle, the done log, the time log, the tag that marks client work, the tag that hands a todo to the agent worker, the terms that filter one, and the note that saves them.
resource: frontend/src/lib/todo.ts
tags: [vault, todos, format, frontend]
status: stable
---

# Todo format

A todo is one line of a note. The line is the whole record: nothing about a todo
is held anywhere else, so a vault read by Obsidian, by another editor or by
`cat` carries every field a todo has.

Each topic has its own page:

* [The line and its fields](/reference/todo-format/the-line.md): the line, every field, the field order, and how a field gets written, with the add prompt's shorthand
* [States, blockers and parts](/reference/todo-format/state-changes.md): the seven states, the cycle, setting a state, subtasks, dependencies and waiting on somebody
* [Repeats, the done log and the time log](/reference/todo-format/time-and-repeats.md): the recurrence rules, the done log and the time log
* [Tags, projects and views](/reference/todo-format/tags-projects-and-views.md): client work, agent work, filter terms, saved views, the agent note and projects

## Related

* [Editor keys](/reference/editor-keys/todos.md#todos): the keys that make a todo, walk it and list it
* [HTTP API](/reference/http-api/todos.md#get-apitodos): `GET /api/todos`, which finds the lines
* [Note frontmatter](/reference/note-frontmatter.md): the other block of a note kasten keeps in step
