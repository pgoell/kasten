---
type: Reference
title: Repeats, the done log and the time log
description: The recurrence rules a todo repeats on, the done log that records a finished todo in the daily note, and the time log that records the sessions a todo was worked in.
resource: frontend/src/lib/todo/todo.ts
tags: [vault, todos, format, frontend]
status: stable
---

# Repeats, the done log and the time log

## Recurrence

`🔁` says a todo comes back:

```
every day | every week | every month | every year
every <n> days | every <n> weeks | every <n> months | every <n> years
every weekday
every week on Monday, Thursday | every <n> weeks on Friday | every Sunday
every month on the 15th | every month on the last
every month on the 2nd Tuesday | every month on the last Friday
```

and any of them may end `when done`. A month rule naming a day takes a number
as well, `every 3 months on the 1st`. A rule this cannot read stays in the
words, where you can see it, and writes nothing.

The first two lines count periods. The rest name their days:

| Rule | Lands on |
| --- | --- |
| `every weekday` | Monday to Friday |
| `every week on Monday, Thursday` | each day named, any number of them |
| `every Sunday` | the same as `every week on Sunday` |
| `every month on the 15th` | that day, the 1st to the 31st |
| `every month on the last` | the last day of the month, whatever its length |
| `every month on the 2nd Tuesday` | the 1st, 2nd, 3rd or 4th of that weekday |
| `every month on the last Friday` | the last of that weekday |

These are obsidian-tasks' own spellings, a subset of what it reads. A weekday
is read in full or by its first three letters, and case and spare spaces do
not matter: `every week on mon,thu` is the rule above. kasten writes back
what you typed and does not respell it.

Ticking a recurring todo done leaves the completed line where it is with its
`✅` and puts the fresh copy above it, so the note carries the history of the
recurrence in place. The copy takes the ticked line's indent as typed and leaves
off its `^block` id, which names the ticked line alone:

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

A rule naming its days lands on the first of them after the date it counts
from, and never on that date itself. So the date a todo carries need not be one
of the days named: `every week on Monday, Thursday` ticked with a due date on a
Tuesday comes back on the Thursday. Every other date still moves by the same
number of days.

`every 2 weeks on Friday` counts its weeks from the week the date is in, Monday
first. From a Friday the copy is fourteen days on. From the Wednesday before,
the Friday of that same week still counts, so the copy is two days on.

A month that lacks the day named is passed over, not clamped:
`every month on the 31st` counted from the thirty-first of January lands on the
thirty-first of March. That is what obsidian-tasks does with it, and
`every month on the last` is the rule for the end of every month. A rule whose
months never have the day, `every 12 months on the 30th` counted from a
February, writes no copy.

The copy is open and carries no `✅`, no `❌`, no `🆔` and no `⏱`: those name
the instance that was finished, which the done log links to. The `➕` stays,
that being the recurrence's own birthday.

The copy brings the todo's parts along (#802), so a routine keeps its steps.
Every todo indented under the ticked one comes back under the copy at the indent
it carries as typed, open, whatever state it ended in. A part drops what the
copy drops, and its `👤` as well: who took a step this round says nothing about
the next. Its `^block` id goes too. Its dates move by the parent's number of
days, and a part that recurs itself keeps its `🔁` but writes no copy of its
own. The parts under the ticked line stay ticked, the history of the round. A
plain bullet or a line of prose under the todo is no part and stays where it is:

```markdown
- [ ] japanese practice 📅 2026-08-11 🔁 every day
  - [ ] Kaishi cards
  - [ ] one Speak lesson
- [x] japanese practice 📅 2026-08-10 🔁 every day ✅ 2026-08-10 🆔 kt-c11d88
  - [x] Kaishi cards ✅ 2026-08-10
  - [x] one Speak lesson ✅ 2026-08-10
```

A recurring todo closed with `❌` instead of ticked writes no copy and no parts.

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

The words leave off a `^block` id that ends the todo's line, since that id
names the todo's own line and a second copy would make links to it ambiguous.
The session line in [the time log](#the-time-log) and
[the recurring copy](#recurrence) leave it off the same way.

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
running and rewrites its `⏱`. A stop writes the end clock into the session line
and leaves the rest of the line as it stands: the words, every link in them, the
indent and anything typed after the id.

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
