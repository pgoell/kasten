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
rest are read, carried and written back untouched. You type a scheduled date, a
start date, a recurrence, a blocker, an estimate and a worked total yourself,
and kasten reads all six: `⏳` and `🛫` decide
[which group a row sits in](/reference/editor-keys.md#the-todo-pane), `⛔` hands
kasten the state of the line it sits on, and `🔁` writes the next copy when the
todo is ticked. Only the estimate and the worked total are carried and nothing
else.

There is deliberately no block anchor. The id does every job a `^anchor` would
have done: the done log names it, dependencies name it, and so will the time log.

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

An id is stamped when something first needs to name the todo: on entering done,
and on `<leader>i`, which is how you name a todo that is still open so a `⛔`
can point at it. A todo nothing refers to never gets one, and a second
`<leader>i` leaves the id the first one wrote. `kt-` prefixes it so a grep for
the id cannot hit a word of prose, and the six characters after it are hex from
the browser's own random source, because an id goes to disk and has to be unique
across machines.

Ticking a parent takes its parts with it, and ticking a recurring todo writes
the next copy. [Subtasks](#subtasks) and [Recurrence](#recurrence) below say
what those two presses write.

## The field order

The words come first, then every field the line carries, in this order:

```
📅 ⏳ 🛫 priority 🔁 ➕ ✅ ❌ ⏲ ⏱ 🆔 ⛔
```

One decision made in one place, so a note stays consistent however it was
edited. A line already in this order comes back byte for byte.

## Subtasks

A todo indented under another is a part of it:

```markdown
- [/] safari packing 📅 2026-08-14
  - [x] passport ✅ 2026-08-09
  - [ ] esim
    - [ ] pick a plan
```

The indent is the whole rule. A todo belongs to the nearest todo above it
carrying a smaller indent, and nothing ends a block: prose between two todos
leaves the nesting alone, which is what markdown itself does and what lets the
pane, which never sees that prose, read the same tree the editor reads.

A parent shows `1/3` after its words, in the editor and on its row in the pane.
The count is every descendant rather than the direct children, so a part with
parts of its own counts each of them, and a part that is done or rejected counts
as closed. A todo with no parts shows nothing.

Ticking a parent done ticks every part that is still open, stamping today's
`✅` on each and leaving a part that was already done or rejected where it is.
Blocked counts as open, so a `[b]` part goes done with the rest. One
`- ✅` line is written for the press, naming the parent, because six lines for
one press is noise, and no part gets an id, nothing naming one. It is one
buffer edit, so one `u` puts every line back.

Ticking the last part leaves the parent alone, and un-ticking a parent leaves
its parts done. Both directions are the spec's own asymmetry: finishing the
whole thing finishes the parts, while a parent usually has work of its own that
no part names.

## Dependencies

`⛔` names another todo's id, and says this todo waits on that one:

```markdown
- [/] ship the release 🆔 kt-c0ffee
- [b] write the docs ⛔ kt-c0ffee
```

Closing or reopening the blocker rewrites every dependent naming it, in
whichever note each one lives in, so the line says the truth without anything
having to work it out at read time. The write runs from the blocker's side
only: a `⛔` typed by hand takes effect the next time its blocker moves.

`⛔` on a line hands kasten the choice between `[ ]` and `[b]` there, and
nothing else. `[/]`, `[x]` and `[-]` are never touched, so a state you set by
hand cannot be destroyed by a blocker changing. A `[b]` carrying no `⛔` means
waiting on something outside the vault and is left alone entirely. Cycling a
dependent from `[b]` to `[ ]` by hand is undone the next time the blocker moves,
which is the intended behaviour: the way to unblock something is to close what
blocks it, or to delete the `⛔`.

A line may carry several `⛔`, and it opens only when every one of them is
closed. A `⛔` naming an id no note holds changes nothing: an unresolvable
blocker reads as open, so nothing is opened on a guess and nothing is destroyed
by a blocker that has been deleted.

One level per write. If A blocks B and B blocks C, closing A opens B, and C is
opened by the write that closes B rather than by the same pass.

## Recurrence

`🔁` says a todo comes back:

```
every day | every week | every month | every year
every <n> days | every <n> weeks | every <n> months | every <n> years
```

and any of them may end `when done`. A rule this cannot read stays in the words,
where you can see it, and writes nothing.

Ticking a recurring todo done leaves the completed line where it is with its
`✅` and puts the fresh copy above it, so the note carries the history of the
recurrence in place:

```markdown
- [ ] water the plants 📅 2026-08-17 🔁 every week
- [x] water the plants 📅 2026-08-10 🔁 every week ✅ 2026-08-10 🆔 kt-c11d88
```

The copy is counted off the due date, or off the scheduled date, or off the
start date, whichever the todo has first. `when done` counts off the day it was
ticked instead. Every other date on the line moves by the same number of days,
so the gaps between due, scheduled and start survive the period.

A month rule counts calendar months and clamps to the last day of one that is
too short: the thirty-first of January one month on is the twenty-eighth of
February, not the third of March. A year rule does the same to the twenty-ninth
of February.

The copy is open and carries no `✅`, no `❌`, no `🆔` and no `⏱`: those name
the instance that was finished, which the done log links to. The `➕` stays,
that being the recurrence's own birthday.

A recurring todo carrying no date at all is ticked like any other and writes no
copy. There is nothing to count from, and a copy with no date is the same todo
written twice.

## The done log

Ticking a todo done writes a line under `## Done` in today's daily note:

```markdown
- ✅ 2026-08-10 wire up the pane [[projects/kasten]] kt-3f9a2c
```

The day it was finished, the todo's words, a link to the note it lives in, and
its id. The link is left off when the todo already lives in the daily note being
written, because a note pointing at itself records nothing. The line itself is
still written there: the daily note is where most todos are, so skipping it
would leave `## Done` empty for the commonest way of working.

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
