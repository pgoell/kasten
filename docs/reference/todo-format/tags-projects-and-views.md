---
type: Reference
title: Tags, projects and views
description: The tags that mark client work and hand a todo to the agent worker, the terms that filter the todo pane, the saved views, the agent note, and the five steps that file a todo under a project.
resource: frontend/src/lib/todo.ts
tags: [vault, todos, format, frontend]
status: stable
---

# Tags, projects and views

## Client work

`#client` on a todo says the work is for a client. Every other todo is internal
work.

```markdown
- [ ] send the offer #client 📅 2026-08-14
  - [ ] check the numbers
- [ ] tidy the wiki 📅 2026-08-14
```

A part of a client todo is client work, with no tag of its own, so `check the
numbers` above is. A part cannot take the mark off: it is client work while
anything above it is.

[The todo pane](/reference/editor-keys/todo-pane.md#the-todo-pane) draws `◆` on a row of
client work and sorts it ahead of internal work of the same priority inside a
group. The tag never lifts a row over one of a higher priority, and it moves no
row to another group.

`#client` in [the filter line](#filter-terms) shows client work alone and
`-#client` shows internal work alone, parts going with their parent. Either
makes a [saved view](#saved-views):

```markdown
- client: #client
- internal: -#client
```

The tag is fixed, as `#next` is. A vault that never writes it sees no change.
[The agent note](#the-agent-note) states the same order, so an agent that ranks
todos weights client work the way the pane does.

## Agent work

`#agent` on a todo hands it to the agent worker, a job on the server, designed
but not built yet, that is to pick up open todos carrying the tag and work on
them. The tag is the one thing the worker reads, so typing it by hand sends a
todo as surely as a key does.

```markdown
- [ ] summarise the meeting notes #agent 📅 2026-10-20
```

`@` in [the todo pane](/reference/editor-keys/todo-pane.md#the-todo-pane) and
`<leader>@` in [the editor](/reference/editor-keys/todos.md#todos) write it, at the end
of the words and before the fields. Pressed again on an open `[ ]` todo they take
it back off, which recalls the todo before the worker starts. The keys read
`#agent` by [the rule for tags](/reference/todo-format/the-line.md#the-fields), so one inside a code span, a link
or a web address is not the tag, and the keys leave it be; one after a comma, as
in `fix,#agent`, is the tag, and a press takes it back. So are `(#agent)` and
`#agent.`, and a press takes off the tag alone, leaving `()` or the stop. A
press leaves the tag in, and says so, where taking it out would make a tag of what follows it, as
in `fix,#agent#kasten`. Once the todo has moved
on to another state, the keys leave the tag where it is. They refuse
client work, a todo carrying `#client` or under one that does, because the
worker skips it. The saved view `- agent: #agent` lists every todo sent.

The tag is fixed, as `#client` is. A vault that never writes it sees no change.

## Filter terms

The todo pane's filter line takes these:

| Term | Matches |
| --- | --- |
| `#tag` | a todo carrying that tag |
| `!highest` `!high` `!med` `!low` `!lowest` | that priority |
| `/open` `/doing` `/review` `/done` `/blocked` `/waiting` `/rejected` | that state |
| `due:today` | due today |
| `due:overdue` | due before today |
| `due:<7d` | due less than seven days out, so today counts and the seventh day does not |
| `-` before any of the above | negates it |
| anything else | ranked as text, against the words and the name after a `👤` |

Within one group the terms are an or; across groups they are an and. So
`#kasten !high` means both, while `!high !low` means either. `-#kasten`
excludes the tag.

A `-` on a word that is not a term is kept, because `-later` is then something
you typed to look for. A bare `#` names no tag and is a word like any other.

`/review` is the view of what waits for your check: every todo an agent has
finished and you have not ticked. `-/review` leaves those out. A line in
[the saved views note](#saved-views), `- review: /review`, puts it one `v` away.

## Saved views

`99 Misc/01 Config/todo-views.md` on the default layout
([`KASTEN_CONFIG_PATH`](/reference/configuration.md#the-vaults-folders) moves
`99 Misc/01 Config`) holds named filters, one per list item, and
`v` in the todo pane walks them. A plain note, so a view is written and edited
like any other line of the vault.

```markdown
# Todo views

- today: due:today
- doing: /doing
- review: /review
- important: !highest !high
```

A view is a list item at the left margin: the name up to the first colon, the
filter terms after it, read by the table above. A filter carrying a colon of its
own, `due:<7d`, splits where it should, the name never crossing one.

The first `v` in a vault holding no such note writes it with those four views,
the way the periodic keys make the note they open. Change them by opening the
note.

Everything else in the note is skipped, and a line that is skipped takes no
other line with it: a heading, a paragraph, an indented item, a bullet with no
colon and one naming no terms are all read as prose, so the note is readable
while it is half written.

## The agent note

`99 Misc/01 Config/01 Agents/How-To-TODO.md` says all of the above to an agent
working in the vault: the fields, their values, the states, the field order, the
writes a completion is, and what marks client work. A note like any other, so read it, edit it or delete
it.

The backend writes it at startup into a vault holding none, rather than a key
press writing it the way [Saved views](#saved-views) are written. The agents
that read it are not all inside the app: one in a terminal pane and one on your
laptop find it the same way, by opening the note, and the second never presses a
key in kasten. A deleted one comes back the next time the backend starts. A vault that holds
the note keeps its own text, so a release that changes the note reaches that
vault only when you delete the note and restart the backend, or copy the new
sections in by hand.

The rule it carries: edit the markdown directly for everything, and tick a todo
done through `PUT /api/files/{path}`. Everything else about a todo is one line
of text, while a completion also stamps the line, writes
[the done log](/reference/todo-format/time-and-repeats.md#the-done-log), may write [the next copy](/reference/todo-format/time-and-repeats.md#recurrence) and may
reopen what waited on it. `KASTEN_API` in the shell container holds the address
to send that to.

## Projects

The [board](/reference/editor-keys/todo-board.md#the-board) files each todo under a project
by five steps, the first that answers winning. The backend works it out and
`GET /api/todos` serves it as each line's `project`.

1. A `#p/x` tag on the todo, else on the nearest todo above it that it is a
   part of and that carries one. `x` names a folder directly under
   `02 Projects`, with case ignored and a `-` or `_` for a space:
   `#p/japan-honeymoon-2027` names `02 Projects/Japan Honeymoon 2027`, and
   `#p/fde/workshops` names FDE. A tag that names no folder is passed over, and
   of two tags the first that names one wins.
2. Else the note sits in a project folder: a folder directly under
   `02 Projects` or `03 Areas`, at any depth below it. A todo in
   `02 Projects/FDE/plan.md` belongs to `02 Projects/FDE`.
3. Else the first `[[link]]` on the line that lands on a note in a folder under
   `02 Projects`. `- [ ] send the deck [[02 Projects/FDE/index|FDE]]` in a
   daily note belongs to FDE. A link to a note that is not there counts for
   nothing.
4. Else the project of the todo it is a part of.
5. Else no project.

The tag is the way to file a todo against its folder: `- [ ] book flights
#p/japan-honeymoon-2027` in `02 Projects/FDE/plan.md` belongs to Japan
Honeymoon 2027. Obsidian Tasks filters on it with `tags include #p/x`.
[HTTP API](/reference/http-api/todos.md#the-project) has the exact rule for reading
a tag.

Nothing moves: the link is one Obsidian reads and obsidian-tasks leaves alone.
[The todo board](/explanation/the-todo-board.md) says why.
