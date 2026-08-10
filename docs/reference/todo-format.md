---
type: Reference
title: Todo format
description: The line a todo is written on, every field it carries, the five states, the cycle, the done log, the time log, the terms that filter one, and the note that saves them.
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

Both clocks take a duration, written `2h`, `45m` or `1h20m`. Nothing else is
one: `90`, `1h30` and `two hours` are words, not times.

Only the two clocks are ours. Everything else is what the obsidian-tasks plugin
already reads, so the vault opened in Obsidian shows working tasks rather than
prose.

Tags are the one field left where it was typed. `call the #health dentist` keeps
its tag mid-sentence, because moving it to the end would rewrite the note every
time somebody ticked something.

`⛔` may appear more than once, each naming another todo's id, and every one is
kept in the order it was written. Every other field appears once.

Nine of these are written by kasten today: the state, the due date, the
priority, the created date, the done date, the cancelled date, the id, the
estimate and the worked total. The last two are the newest. `est:45m` in
[the add prompt](#the-add-prompts-shorthand) writes the `⏲`, and every stop of
the timer rewrites the `⏱` off [the time log](#the-time-log). The rest are read,
carried and written back untouched: you type a scheduled date, a start date, a
recurrence and a blocker yourself, and kasten reads all four. `⏳` and `🛫`
decide [which group a row sits in](/reference/editor-keys.md#the-todo-pane), `⛔`
hands kasten the state of the line it sits on, and `🔁` writes the next copy
when the todo is ticked.

There is deliberately no block anchor. The id does every job a `^anchor` would
have done: the done log names it, dependencies name it, and the time log names
it.

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
| `[x]` | a plain line | strips the `✅` it wrote |
| `[b]` | `[/]` | nothing |
| `[-]` | a plain line | strips the `❌` it wrote |

The walk is the work: not started, started, finished, and out of the list again.
Blocked and rejected are things that happen to work rather than steps in it, so
neither is on the walk and each has [a key of its own](#setting-a-state). That
is also what puts done last. A list of open work loses a row the moment it is
done, so a walk with two closed states in it could never reach the second: from
the todo pane the old order made blocked and rejected unreachable, because the
row left the list at done and took the rest of the walk with it.

The walk picks a blocked line up where the work left off, at doing, rather than
at the start of it. A todo somebody blocked is one somebody had begun.

The first step reads the fields already on the line, so a todo written out by
hand arrives carrying them. It takes the line's bullet off where it had one, the
box standing in for it.

Either step out drops the bullet, the box and the stamp its own state wrote, and
keeps every other field, so three more presses give the todo back with its
dates. It rebuilds the line the way every other step does, which is why the tags
come back in front of the fields:

```markdown
- [-] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ❌ 2026-08-10 #health
```

becomes

```markdown
call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-09
```

An id is stamped when something first needs to name the todo: on entering done,
on starting a timer, whose session line has to name it, and on `<leader>i`,
which is how you name a todo that is still open so a `⛔` can point at it. A
todo nothing refers to never gets one, and a second
`<leader>i` leaves the id the first one wrote. `kt-` prefixes it so a grep for
the id cannot hit a word of prose, and the six characters after it are hex from
the browser's own random source, because an id goes to disk and has to be unique
across machines.

Ticking a parent takes its parts with it, and ticking a recurring todo writes
the next copy. [Subtasks](#subtasks) and [Recurrence](#recurrence) below say
what those two presses write.

## Setting a state

Five keys put a line straight into one state from wherever it was: `O`, `P`,
`X`, `B` and `R` in the todo pane, and `<leader>so`, `<leader>sp`,
`<leader>sx`, `<leader>sb` and `<leader>sr` in the editor. `p` is in progress,
`d` being spent on the done list.

A state is worth the same whichever key wrote it. Entering done stamps `✅`
today and an `🆔` where the line carries none, entering rejected stamps `❌`
today, and leaving either drops the stamp it wrote, exactly as the walk does.
A key aimed at the state a line is already in changes nothing. A plain line
becomes a todo in that state, carrying the `➕` the walk would have stamped.

Everything a press drags with it comes too: a parent set to done takes its open
parts, a recurring todo set to done writes its next copy, and a todo carrying an
`🆔` set into or out of done moves what waits on it.

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

The indent is typed by hand in a note, and written for you from the todo pane:
[`s`](/reference/editor-keys.md#the-todo-pane) puts what you type in as a part
of the row under the cursor, two spaces further in than that row's own line and
after the parts it already has. It is the add prompt's shorthand either way, so
`s` and `a` write the same kind of line into different places.

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

## The time log

`t` in the todo pane starts a session on the todo under the cursor and writes a
line under `## Time` in today's daily note:

```markdown
## Time
- 09:12-10:32 wire up the pane [[projects/kasten]] kt-3f9a2c
- 14:03-      call the dentist kt-4c2d11
```

Both clocks, the todo's words, a link to the note it lives in, and its id. The
first line is closed and the second is still running. The times are padded to
one width so the words line up either way, and the link is left off a todo that
already lives in the note being written, exactly as the done log leaves it off.

A start stamps an `🆔` where the todo carries none, so the session line has
something to name. A second `t` on that row closes every session the todo has
running and rewrites its `⏱`.

Timers run in parallel and `t` touches one todo. Three going is three rows
marked `▶` in the pane and `3 running` in its footer. A day's total is the sum
of its intervals rather than the wall clock they span, so two todos worked in
the same hour count an hour each.

The log is the record and `⏱` is kasten's summary of it. Every stop rewrites the
worked total as the sum of every closed session naming that todo, across the
whole vault, and never adds to what the line carried. So a session line
corrected by hand puts the total back in step at the next stop, and a `⏱` typed
onto a line the log does not back is replaced.

A session is closed in the note it lives in, at 23:59 when that note is not
today's. One rule covers the timer left running on Friday and the one that ran
past midnight: a session started at 23:50 and stopped at 00:10 records nine
minutes rather than twenty, in the note of the day it started. kasten never
splits a session across two daily notes. The line is text, so a number that is
wrong is corrected by typing over it and the next stop takes the correction into
`⏱`.

A total of zero is written `⏱ 0m` rather than dropped, and an end typed before
its start counts as nothing.

A `## Time` section written by hand into a note that is not a daily note is your
own log. kasten reads a session line for the day its note is named for, and a
note not named for a day cannot answer that, so it neither closes those lines nor
counts them.

The first line written into it makes `## Time`, the way the first `- ✅` makes
`## Done`.

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

## Saved views

`99 Misc/01 Config/todo-views.md` holds named filters, one per list item, and
`v` in the todo pane walks them. A plain note, so a view is written and edited
like any other line of the vault.

```markdown
# Todo views

- today: due:today
- doing: /doing
- important: !highest !high
```

A view is a list item at the left margin: the name up to the first colon, the
filter terms after it, read by the table above. A filter carrying a colon of its
own, `due:<7d`, splits where it should, the name never crossing one.

The first `v` in a vault holding no such note writes it with those three views,
the way the periodic keys make the note they open. Change them by opening the
note.

Everything else in the note is skipped, and a line that is skipped takes no
other line with it: a heading, a paragraph, an indented item, a bullet with no
colon and one naming no terms are all read as prose, so the note is readable
while it is half written.

## The add prompt's shorthand

`a` and `s` in the todo pane read the same words as instructions rather than as
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

`est:` takes a duration and writes the `⏲`: `est:2h`, `est:45m` and `est:1h20m`.
It is the one path by which kasten rather than your keyboard puts an estimate on
a line, and it is not a filter term, there being nothing useful to filter on.
Anything after `est:` that is not a duration stays in the words, as a mistyped
date does.

A state term is not an instruction here, a fresh todo being open, so `/doing`
stays in the words as well. Tags stay where they were typed. The todo comes back
open and created today.

So this, typed on 2026-08-10:

```
call the dentist due:08-14 est:45m !high #health
```

writes this:

```markdown
- [ ] call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-10 ⏲ 45m
```

## Related

* [Editor keys](/reference/editor-keys.md#todos) - the keys that make a todo, walk it and list it
* [HTTP API](/reference/http-api.md#get-apitodos) - `GET /api/todos`, which finds the lines
* [Note frontmatter](/reference/note-frontmatter.md) - the other block of a note kasten keeps in step
