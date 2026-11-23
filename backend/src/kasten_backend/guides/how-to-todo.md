---
type: Reference
---

# How to work with todos

For agents working in this vault, whether you run in kasten's own terminal pane
or on a machine outside it.

Todos live in kasten's todo store, not in note lines. Where a todo line used to
be, a note now holds an embed of the todo:

```markdown
![[kt-3f9a2c]]
```

The embed carries the id and nothing else. A `- [ ]` typed into a note is a
plain markdown checkbox and no todo: nothing reads it as one. So never write a
todo line into a note; add the todo through the store.

## Through MCP

A client on kasten's MCP server has five todo tools: `search_todos`,
`add_todo`, `change_todo`, `set_todo_state` and `complete_todo`. Their arguments
are in their descriptions.

## Through the HTTP API

In kasten's terminal pane the base URL is in `$KASTEN_API`. Outside it, use
whatever address serves the backend, `http://127.0.0.1:8000` when you run it
yourself.

```sh
curl -s "$KASTEN_API/api/todos/rows?state=open&words=bank"   # search, as rows
curl -s "$KASTEN_API/api/todos?state=waiting"                # search, as lines
curl -s -X POST "$KASTEN_API/api/todos/line" -H 'Content-Type: application/json' \
  -d '{"text": "- [ ] call the bank #money 📅 2026-12-01"}'    # add
curl -s -X POST "$KASTEN_API/api/todos/kt-3f9a2c/state" -H 'Content-Type: application/json' \
  -d '{"state": "done"}'                                       # tick
```

`GET /api/todos/rows` takes `state`, `words`, `tag`, `kind`, `project`, `epic`,
`parent`, `priority`, `due_by`, `planned_on`, `look_again_by`, `waiting`,
`shown_on`, `done_from`, `done_to`, `archive`, `sort` and `limit`. What got done
in a week is `state=done&done_from=<monday>&done_to=<sunday>`. A change is
`PATCH /api/todos/<id>` with the `version` a read gave and the fields to set.

## The states

| State | Means |
|---|---|
| `open` | not started |
| `doing` | started |
| `review` | done, waiting for a look |
| `done` | finished |
| `blocked` | held by a todo in `blocked_by` |
| `waiting` | waiting on somebody, until `look_again` |
| `rejected` | dropped |

## The fields

- **Three dates.** `due` is the day it must be done by, hard or soft; a todo
  with none gets a soft one 14 days out. `planned` is the day you mean to do it;
  passing it makes nothing overdue. `hold_until` hides it from every list
  before that day.
- **Waiting** carries who (`waiting_on`), since when, and `look_again`, the day
  it comes back; until then no list shows it.
- **Organisation.** Tags are typed in the words (`#money`, `#p/trip`). The kind
  is a tag: `#client`, `#internal` or `#private`. `parent_id` makes a todo a
  part of another, at any depth and across notes. `epic` marks a todo as an
  epic, and `epic_id` counts a todo toward one across projects.
- **Priority** is `highest`, `high`, `medium`, `low` or `lowest`; none sorts
  between medium and low.

Ticking a todo done ticks its open parts, moves a repeating todo on to its next
round and opens the todos that waited on it. The store does all of that; do not
do it by hand.

To read a day's notes as before:

```sh
cat '{{periodic}}/00 Daily/2026-08-10.md'
```
