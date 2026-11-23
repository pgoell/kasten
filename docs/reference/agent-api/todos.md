---
type: Reference
title: Agent todo tools
description: The five MCP tools that search, add, change, set the state of and complete a todo in the store, and their arguments.
resource: backend/src/kasten_backend/todos/serve/tools.py
tags: [api, agent, mcp, todos]
status: stable
---

# Agent todo tools

Todos live in the store, not in note lines
([Todos in Postgres](/explanation/vault-and-derived-index/todos-in-postgres.md)).
An agent reaches them through five MCP tools. Each write runs the rules the todo
pane's writes run and is recorded in the todo's history as `agent`'s. Dates are
`YYYY-MM-DD`. A refusal comes back as a tool error that says why.

| Tool | Reads only | Arguments |
|---|---|---|
| `search_todos` | yes | `words`, `state` (list), `tag`, `kind` (`client`, `internal`, `private`), `project`, `epic` (id), `parent` (id), `priority` (list, `none` for unset), `due_by`, `planned_on`, `look_again_by`, `waiting`, `shown_on`, `archive`, `sort` (`priority`, `due`, `planned`, `created`, `place`), `limit` (default 50, at most 500) |
| `add_todo` | no | `words` (required; tags typed in it), `description`, `due`, `due_hard`, `planned`, `hold_until`, `priority`, `parent_id`, `epic_id`, `epic`, `project`, `note`, `repeat`, `estimate` (minutes) |
| `change_todo` | no | `id`, `version` (both required), then any of `words`, `description`, `due`, `due_hard`, `planned`, `hold_until`, `priority`, `parent_id`, `epic_id`, `epic`, `project`, `blocked_by`, `repeat`, `estimate`, and `clear`, a list of fields to empty |
| `set_todo_state` | no | `id`, `state` (`open`, `doing`, `review`, `done`, `blocked`, `waiting`, `rejected`), `look_again`, `waiting_on` |
| `complete_todo` | no | `id` |

Every tool answers todos with `id`, `words`, `description`, `state`, `tags`, `priority`,
`due`, `due_hard`, `planned`, `hold_until`, `look_again`, `waiting_on`,
`waiting_since`, `project`, `note`, `parent_id`, `epic`, `epic_id`,
`blocked_by`, `repeat`, `estimate`, `worked`, `created`, `done` and `version`.
A write answers every todo it touched: ticking a parent ticks its open parts,
and a repeating todo's finished round comes back as a row of its own.

* `search_todos` sorts by priority unless told otherwise, a todo with none
  between medium and low. `shown_on` leaves out what no list shows that day: a
  todo held off past it and a wait whose look-again day is still ahead.
* `add_todo` with no `due` gives a soft due date 14 days out, unless the todo is
  a part. With no `note` it goes in its parent's note, else today's daily note.
* `change_todo` refuses a `version` that is not the todo's current one: search
  again and retry. Clearing `due` gives a soft one again.
* `set_todo_state` to `waiting` with no `look_again` looks again in 7 days;
  setting it again with a new day chases.
