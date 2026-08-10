---
type: Reference
title: Todo format
description: The line a todo is written on, every field it carries, the five states, the cycle, and the terms that filter one.
resource: frontend/src/lib/todo.ts
tags: [vault, todos, format, frontend]
status: stable
---

# Todo format

A todo is one line of a note. The line is the whole record: nothing about a todo
is held anywhere else, so a vault read by Obsidian, by another editor or by
`cat` carries every field a todo has.

## The line

```markdown
- [/] wire up the pane #kasten 📅 2026-08-14 ⏳ 2026-08-12 🛫 2026-08-11 ⏫ 🔁 every week ➕ 2026-08-09 ⏲ 2h ⏱ 1h20m 🆔 kt-3f9a2c ⛔ kt-8b1e04
```

A markdown list item, a checkbox, the words, then the fields. Every field is
optional and the bullet and the box are not. The indent is kept, and written
back as spaces, so a todo nested under another stays nested.

Two things that look like a todo are not. `1. [ ] ordered` is an ordered list
item, and `- [[borges]]` is a bullet holding a wikilink. Neither is a todo here
or to `GET /api/todos`.

kasten rebuilds the line rather than patching it, so a line whose fields sit in
another order is written back in [the order below](#the-field-order) the first
time anything touches it. A marker kasten does not know, and one whose value
does not parse, stays in the words where the person who typed it can see it.

## The fields

| Field | Spelling | From |
| --- | --- | --- |
| state | `[ ]` `[/]` `[x]` `[b]` `[-]` | ours |
| due | `📅 2026-08-14` | obsidian-tasks |
| scheduled | `⏳ 2026-08-12` | obsidian-tasks |
| start | `🛫 2026-08-11` | obsidian-tasks |
| priority | `🔺 ⏫ 🔼 🔽 ⏬` | obsidian-tasks |
| recurrence | `🔁 every week` | obsidian-tasks |
| created | `➕ 2026-08-09` | obsidian-tasks |
| done | `✅ 2026-08-10` | obsidian-tasks |
| cancelled | `❌ 2026-08-10` | obsidian-tasks |
| estimate | `⏲ 2h` | ours |
| worked | `⏱ 1h20m` | ours |
| id | `🆔 kt-3f9a2c` | obsidian-tasks |
| blocked by | `⛔ kt-8b1e04` | obsidian-tasks |
| tags | `#kasten` | Obsidian |

The five dates are `YYYY-MM-DD` and nothing else. A `📅 next tuesday` is not a
date, so the whole of it stays in the words. The five priority glyphs read
highest, high, medium, low and lowest, in that order. The recurrence is the one
field whose value is free text, so it runs to the next field marker or the next
tag rather than to the next space.

Only the two clocks are ours. Everything else is what the obsidian-tasks plugin
already reads, so the vault opened in Obsidian shows working tasks rather than
prose.

Tags are the one field left where it was typed. `call the #health dentist` keeps
its tag mid-sentence, because moving it to the end would rewrite the note every
time somebody ticked something.

`⛔` may appear more than once, each naming another todo's id, and every one is
kept in the order it was written. Every other field appears once.

Seven of these are written by kasten today: the state, the due date, the
priority, the created date, the done date, the cancelled date and the id. The
rest are read, carried and written back untouched. Nothing in the app sets a
scheduled date, a start date, a recurrence, a blocker, an estimate or a worked
total yet.

There is deliberately no block anchor. The id does every job a `^anchor` would
have done: the done log names it, and so will dependencies and the time log.

## The five states

| Box | State | Drawn |
| --- | --- | --- |
| `[ ]` | open | ☐ |
| `[/]` | doing | ◐ |
| `[x]` | done | ☑ |
| `[b]` | blocked | ⊘ |
| `[-]` | rejected | ☒ |

`[X]` reads as done as well, because another editor writes it that way. kasten
always writes `[x]`.

Five rather than the plugin's two, because blocked and rejected are things that
happen to work and a todo that is neither open nor done has to be able to say
which. `[/]` and `[-]` are what most Obsidian themes already style; `[b]` has no
convention behind it and reads as what it is.

Open means neither done nor rejected, which is what
[the todo pane and the todo overlay](/reference/editor-keys.md#todos) both show.
A blocked todo is open work.

## The cycle

`<leader>x` in the editor, and `x` in the todo pane, walk one line one step:

| From | To | Stamps |
| --- | --- | --- |
| a plain line | `[ ]` | `➕` today, unless the line already carries one |
| `[ ]` | `[/]` | nothing |
| `[/]` | `[x]` | `✅` today, and `🆔` unless the line already carries one |
| `[x]` | `[b]` | strips the `✅` it wrote |
| `[b]` | `[-]` | `❌` today |
| `[-]` | a plain line | strips the `❌` it wrote |

The first step reads the fields already on the line, so a todo written out by
hand arrives carrying them. It takes the line's bullet off where it had one, the
box standing in for it.

The last step drops the bullet, the box and the `❌`, and keeps every other
field, so six more presses give the todo back with its dates. It rebuilds the
line the way every other step does, which is why the tags come back in front of
the fields:

```markdown
- [-] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ❌ 2026-08-10 #health
```

becomes

```markdown
call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-09
```

An id is stamped when something first needs to name the todo, which today is on
entering done. A todo nothing refers to never gets one. `kt-` prefixes it so a
grep for the id cannot hit a word of prose, and the six characters after it are
hex from the browser's own random source, because an id goes to disk and has to
be unique across machines.

## The field order

The words come first, then every field the line carries, in this order:

```
📅 ⏳ 🛫 priority 🔁 ➕ ✅ ❌ ⏲ ⏱ 🆔 ⛔
```

One decision made in one place, so a note stays consistent however it was
edited. A line already in this order comes back byte for byte.

## The done log

Ticking a todo done writes a line under `## Done` in today's daily note:

```markdown
- ✅ 2026-08-10 wire up the pane [[projects/kasten]] kt-3f9a2c
```

The day it was finished, the todo's words, a link to the note it lives in, and
its id. The link is left off when the todo already lives in the daily note being
written, because a note pointing at itself records nothing.

It is deliberately not a checkbox. `GET /api/todos` matches the shape of a
checkbox line, so a `- [x]` here would put every finished todo in the pane
twice, once as itself and once as its own log entry, with nothing on either line
to tell the two apart.

Un-ticking greps the id and drops the line wherever it turns up, which is what
lets you un-tick something you finished last Tuesday. Ticking again greps first
and appends nothing where a line is already there, so a todo cycled back and
forth leaves one line rather than a pile.

The first line written into it makes `## Done`. `## TODOs`, which is where the
add prompt writes, is in a fresh daily note from the start. Both are plain
markdown headings and both are yours to edit.

## Filter terms

The todo pane's filter line takes these:

| Term | Matches |
| --- | --- |
| `#tag` | a todo carrying that tag |
| `!highest` `!high` `!med` `!low` `!lowest` | that priority |
| `/open` `/doing` `/done` `/blocked` `/rejected` | that state |
| `due:today` | due today |
| `due:overdue` | due before today |
| `due:<7d` | due less than seven days out, so today counts and the seventh day does not |
| `-` before any of the above | negates it |
| anything else | ranked as text |

Within one group the terms are an or; across groups they are an and. So
`#kasten !high` means both, while `!high !low` means either. `-#kasten`
excludes the tag.

A `-` on a word that is not a term is kept, because `-later` is then something
you typed to look for. A bare `#` names no tag and is a word like any other.

## The add prompt's shorthand

`a` in the todo pane reads the same words as instructions rather than as
filters, so `due:08-14` sets a date rather than picking one. The line under the
input is what the vault is about to get.

`!high` and the four beside it set the priority. `due:` takes five forms:

| Typed | Means |
| --- | --- |
| `due:2026-08-14` | that day |
| `due:08-14` | that day of the current year |
| `due:friday`, `due:fri` | the next such day, and never today |
| `due:today` | today |
| `due:tomorrow` | tomorrow |

Anything else after `due:` is not a date, so the whole word stays in the todo's
words where you can see it, `due:whenever` included. So does a day the calendar
does not have: `due:2026-02-30` is read back before it is taken, because a date
nobody typed is worse on disk than no date at all.

A state term is not an instruction here, a fresh todo being open, so `/doing`
stays in the words as well. Tags stay where they were typed. The todo comes back
open and created today.

So this, typed on 2026-08-10:

```
call the dentist due:08-14 !high #health
```

writes this:

```markdown
- [ ] call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-10
```

## Related

* [Editor keys](/reference/editor-keys.md#todos) - the keys that make a todo, walk it and list it
* [HTTP API](/reference/http-api.md#get-apitodos) - `GET /api/todos`, which finds the lines
* [Note frontmatter](/reference/note-frontmatter.md) - the other block of a note kasten keeps in step
