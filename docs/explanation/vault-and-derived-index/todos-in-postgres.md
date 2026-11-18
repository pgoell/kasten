---
type: Explanation
title: Todos in Postgres
description: Why todos leave the note lines for a table, what a row holds, what a note shows where a line was, what a checkbox typed in a note means, where the done log and the timer sessions go, how the import moves the lines, and what replaces the vault's history and backup for todos.
resource: backend/alembic/versions/0019_todos.py
tags: [design, database, todos, data-model]
status: draft
---

# Todos in Postgres

kasten has [one rule](/explanation/vault-and-derived-index.md): the vault is the
source of truth, and Postgres holds nothing a note needs. Money was the first
exception ([Finance in Postgres](/explanation/vault-and-derived-index/finance-in-postgres.md)). Todos
are the second. They will live in a `todos` schema as the system of record, and
the vault will no longer rebuild them.

This page records the decisions behind the move, taken in
[#2191](https://github.com/pgoell/kasten/issues/2191). Migrations `0019` and
`0020` make the tables, `todos:import` fills them, and
[the store's routes](/reference/http-api/todos.md#the-store) read and write
them. The app does not call those routes yet: the line reader still answers
`GET /api/todos` until the readers move, as [The cutover](#the-cutover) says.

## Why the line stops being enough

A todo has been one line of a note, and the line the whole record
([Todo format](/reference/todo-format.md)). That kept the vault readable in any
editor. It also made four things hard:

- **One date did two jobs.** `⏳` said both "not before" and "today's plan". A
  todo not done on its day carried a wrong date, and the owner set a new one by
  hand, day after day. Planning turned into re-dating.
- **A wait had no end.** `[w]` said who and since when, and nothing about when
  to look again, so a waiting todo sat in every list.
- **A plan had no home.** The plan for a day was text a skill wrote into the
  daily note. No pane showed it, so work got picked from the whole list.
- **Every reader parsed text.** `GET /api/todos` searched every note on every
  request, the browser patched lines by pattern, and an agent wrote todos by
  editing markdown. A planning brief, a day plan and agent tools all want to ask
  questions of todos ("what is due in the next 14 days, ranked by a fixed
  rule"), which a table answers and a directory of notes does not.

The cost is the one money pays: a todo no longer outlives kasten as a line of
text, and the database now holds information nothing else does.

## What a row holds

One row per todo in `todos.todo`, with what the line held:

| Line | Row |
| --- | --- |
| the words, tags where they were typed | `words`; `tags` read off them on every save |
| the box, one of the seven states | `state`, the same seven |
| `🆔 kt-3f9a2c` | `id`, the key; every todo has one now |
| indent under another todo | `parent_id` and `position` |
| `⛔` | `blocked_by`, ids in order |
| `🔁`, `🏁` | `repeat`, `on_completion` |
| priority glyph | `priority` |
| `⏳`, `🛫` | `from_day`, except `🛫` on a `[w]` line |
| `📅` | `deadline` with `deadline_hard` |
| undated `👤` | `assignee` |
| `👤` on a `[w]` line | `waiting_on`, and `waiting_since` when dated |
| `🛫` on a `[w]` line | `look_again` |
| `⏰` | `remind_at` |
| `⏲`, `⏱` | `estimate`, `worked`, in minutes |
| `➕`, `✅`, `❌` | `created`, `done`, `cancelled` |
| the note the line was in | `note`, and `project` worked out once |

Three things are new.

**Two dates replace scheduled, start and due.** The **from-day** hides a todo
before it. The **deadline** is the day it must be done by, marked hard or soft.
A todo saved with no deadline gets a soft one 14 days after it was made. The
day a todo is done on belongs to the day plan, not the todo: a plan picks it,
and a pick that is not done ends with the day while the todo keeps both dates.
Missing a day never asks for a new date.

**Waiting gets a look-again day.** Beside who and since, a waiting todo carries
the day to look again. Until then every list leaves it out. On that day it
shows once, with three answers: chase (it stays waiting, with a new look-again
day), wait longer, or it came in (back to open).

**The id is always there.** On the line an id was stamped only when something
needed to name the todo. A row needs a key, so every todo gets a `kt-` id when
it is made.

Parts take what they do not spell from the todo above them at read time, as
they do now: the deadline, the from-day, the priority and the kind. The 14-day
default goes only on a todo with no parent, so a part never gets a deadline of
its own by accident. Kind stays a tag (`#client`, `#internal`, `#private`) and
is read, not stored.

## What a note shows where a line was

The import replaces each todo line with an embed of the todo:

```markdown
![[kt-3f9a2c]]
```

The editor draws the live todo there, with its parts, and a tick in the note
writes the row. The embed keeps the todo's place in the note, under its
heading, and carries the id, so a search for the id still finds the note. A
`^block` id that ended the line moves to the end of the embed, so a link to it
still lands. Parts get no embed of their own: they are drawn under their
parent.

The embed holds the id and nothing else, so it can never disagree with the
row. Deleting it from the note deletes nothing: the todo stays in the store
and in the todo pane. Obsidian draws it as a missing note, which is the honest
answer for a vault whose todos live somewhere else.

## A checkbox typed in a note

`- [ ] call the bank` typed into a note stays a markdown checkbox and is no
todo. kasten does not watch saves for checkboxes to lift: the editor saves as
you type, and a lift on save would make a todo of `- [ ] call th` and leave a
second record behind. One record, in one place.

The way in is a key. `<leader>x` on such a line moves it into the store: the
row is made from the line's words and fields, and the line becomes the embed.
The todo pane's add prompt writes a row with no note at all. An agent uses the
agent tools ([#2191](https://github.com/pgoell/kasten/issues/2191), part 6), not
markdown.

## The done log and the timer

**Done.** The `## Done` section stops growing. A finished todo's `done` day is
on its row, so "what got done on a day" is a query, and the daily note can show
it without a copy. A repeating todo keeps its id when ticked: the finished round
becomes a done row of its own whose `round_of` names the todo, and the todo
moves on to its next dates. So the embed in a note, a `⛔` naming it and a day
plan's pick all still name the live todo, and the history of a series is its
rounds. The `## Done` lines already in old daily notes stay as text.

**Time.** Each stretch of work is a row in `todos.session`, with a start and an
end, empty while the timer runs. A stop sums the closed sessions into `worked`,
as it summed the `## Time` lines into `⏱`. The import moves every session line
that names an id into the table and leaves the old `## Time` sections as text.

## Shared lists

The two shared lists move too. An item is a todo whose `shared_list` names its
list, and the `/share` routes read and write rows. A shared item gets no
default deadline, and the brief and the todo pane leave the lists out unless
asked, as the pane's toggle does now.

## The import

One import moves every todo line of the vault into the tables and writes the
embeds in the same pass. It reads lines with the reader that serves
`GET /api/todos` today and the field parser held to the editor's by fixtures,
so a line reads the same in the import as in the pane.

- `⏳` and `🛫` become the from-day, the later of the two. On a `[w]` line
  `🛫` is the look-again day instead, as the planning skill writes it, and
  `⏳` alone is the from-day. `📅` becomes a hard deadline.
- An open todo with no `📅` gets a soft deadline 14 days after the import, its
  creation in the store. Fourteen days after `➕` would put most old todos past
  their deadline on the first day.
- A waiting todo with no `🛫` gets the import day as its look-again day, so
  each one comes up once for a decision.
- Done and rejected lines come in too, with their days, so the history of past
  work stays countable. So do the archive's lines; a todo whose note is in the
  archive reads as archived, as now.
- A line with no id gets a new one. Of two lines with the same id, the second
  gets a new one and the import reports it.
- `project` is worked out once by [the five steps](/reference/todo-format/tags-projects-and-views.md#projects)
  and stored, since the line's link and folder are gone afterwards.

`mise run todos:import`, or `python -m kasten_backend.todos` in the backend
container, is a dry run: it writes nothing and prints the two checks the move
must pass, the count of open todo lines against the count of open rows, and
every `kt-` id on a line found in the store. `-- --write` does the move, under
the vault's write lock, as one jj change. The rows are written first and kept
only once the notes are on disk, so a failed note write stores nothing. A
second run finds no todo lines and changes nothing.

The import moves a session line only where it names an id. A running session
in an old daily note ends at 23:59 of its day, as a stop would end it.

## History and backup

The vault's jj repository gave every todo a history and git or tar gave it a
backup. Both stop reaching todos once they are rows.

**History** is `todos.change`: every write adds a row holding the todo before
and after, who wrote it (the browser, an agent, the shared lists, a push action,
the import) and when. It has no foreign key, so a deleted todo keeps its
history, and an undo is the `before` written back.

**Backup** is the schema. `pg_dump -n todos` dumps it the way the hourly finance
dump takes `-n finance`
([Back up and restore](/how-to/back-up-and-restore.md#the-finance-dump-on-the-maintainers-server)),
and the nightly offsite dump of the whole database takes it already. `db:reset`
on a dev database loses its todos, as it loses finance.

## The cutover

The move ships in steps, and only the last one changes what anyone sees:

1. The tables, this page and the import ship with nothing reading them.
2. The routes that read and write rows, with the rules a press runs today
   (the cycle, recurrence, parts, blockers), move to the backend, so the pane,
   push, the shared lists and the agent tools all run one copy.
3. The reader switch: `GET /api/todos`, the pane, the board, the today pane,
   the reviews, push reminders and the shared lists read rows. Deploying it
   needs the import run against the vault and database it serves, in the same
   window, or the pane comes up empty.

Step 3 has more to move than the todo readers, because some readers of note
text read todo lines without knowing it:

- **Tags.** The tag list reads tags off todo lines; it reads them off rows too.
- **Links in a todo's words.** Backlinks, the graph, people cards and the
  project's link step read a `[[link]]` on a todo line; they read the rows'
  `words`, `assignee` and `waiting_on`.
- **The embed.** The graph and the link readers take `![[kt-3f9a2c]]` for a
  link to a missing note; a `kt-` target is a todo, not a note.
- **Moving a note.** A move rewrites links in notes; it rewrites them in rows
  too, and moves `note` along, since the archive filter reads it.
- **Search.** The line search and the pieces index stop finding a todo's words
  in its note.
- **Writers.** The meal plan's shopping list, the contract reminders and the
  agent guide written at startup write todo lines; they write rows.
- **Events.** A row written sends no vault event, so the store sends one of its
  own for the pane to read again.

The import loses two small things on purpose: a part's `^block` id, since parts
get no embed, and the look of old daily notes, whose ticked lines become
embeds of done todos.

The planning skill in the vault reads and writes todo lines, and it stops
working at step 3 until it moves to the agent tools.

## What is deliberately not here

- **No sync between a line and a row.** A line kept in step with a row is two
  records, and they drift. The embed holds the id only.
- **No mirror into notes.** No nightly export of todos into markdown. The
  history table and the dump are the record.
- **No lifting on save.** A checkbox becomes a todo by a key, never as a side
  effect of typing.
