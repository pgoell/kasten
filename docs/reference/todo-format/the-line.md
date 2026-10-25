---
type: Reference
title: The line and its fields
description: The line a todo is written on, every field it carries, the field order, and the two ways a field gets written, the editor's colon list and the add prompt's shorthand.
resource: frontend/src/lib/todo.ts
tags: [vault, todos, format, frontend]
status: stable
---

# The line and its fields

## The line

```markdown
- [/] wire up the pane #kasten 📅 2026-08-14 ⏳ 2026-08-12 🛫 2026-08-11 ⏫ 🔁 every week ➕ 2026-08-09 ⏲ 2h ⏱ 1h20m 🆔 kt-3f9a2c ⛔ kt-8b1e04
```

A markdown list item, a checkbox, the words, then the fields. Every field is
optional and the bullet and the box are not. The indent is kept as typed, a
tab staying a tab, so a todo nested under another stays nested.

Two things that look like a todo are not. `1. [ ] ordered` is an ordered list
item, and `- [[borges]]` is a bullet holding a wikilink. Neither is a todo here
or to `GET /api/todos`.

A state change patches the line rather than rebuilding it. The box changes, and
the stamps the change adds or drops (`✅`, `❌`, `🆔`, `👤`, `➕`) go in or come
out; every other byte stays where it was typed. A field kasten writes without a
state change patches the line the same way: picking a blocker adds its `⛔`
after the last `⛔` the line names and a `🆔` to the blocker where it has none,
`<leader>i` adds `🆔`, a timer's first start adds `🆔`, a stop
writes the `⏱` total over the old one or adds it, and an edit that takes off
the last `⛔` opens the box and touches nothing else. That keeps a tab indent, a
`^block` id at the end of the line where links find it, the spacing in the
words, and fields that sit out of [the order below](#the-field-order). A stamp
goes in at its place in that order. If no place reads back right, kasten writes
the whole line in the field order instead, since correct fields matter more than
kept bytes.

A marker kasten does not know, and one whose value does not parse, stays in the
words where the person who typed it can see it. So does a marker inside a
`[[wikilink]]`, a markdown link or a code span: `[[notes 📅 2026-10-20]]` gives
the todo no due date. A marker whose value would start a link or a code span
has no value either, so in ``⛔ `c d` `` the `⛔` stays words, a later `⛔` on
the line still reads, and a blocker picked for the line goes in at its place
and leaves the span whole.

## The fields

| Field | Spelling | From |
| --- | --- | --- |
| state | `[ ]` `[/]` `[r]` `[x]` `[b]` `[w]` `[-]` | ours |
| due | `📅 2026-08-14`, also `📆` or `🗓` | obsidian-tasks |
| scheduled | `⏳ 2026-08-12` | obsidian-tasks |
| start | `🛫 2026-08-11` | obsidian-tasks |
| priority | `🔺 ⏫ 🔼 🔽 ⏬` | obsidian-tasks |
| recurrence | `🔁 every week` | obsidian-tasks |
| on completion | `🏁 keep` or `🏁 delete` | obsidian-tasks |
| created | `➕ 2026-08-09` | obsidian-tasks |
| done | `✅ 2026-08-10` | obsidian-tasks |
| cancelled | `❌ 2026-08-10` | obsidian-tasks |
| estimate | `⏲ 2h` | ours |
| worked | `⏱ 1h20m` | ours |
| id | `🆔 kt-3f9a2c` | obsidian-tasks |
| blocked by | `⛔ kt-8b1e04` | obsidian-tasks |
| assignee | `👤 [[Pascal]]` | ours |
| waiting on | `👤 2026-08-03 [[Ada Lovelace]]` | ours |
| tags | `#kasten` | Obsidian |

The `👤` marker has two forms, and the text after it tells them apart. A date
after it makes the field the wait: the day a todo began waiting, and who it
waits on, the name optional. Anything else that is no date makes it the
assignee, the person the todo is for, in any state. A line may carry both, the
assignee first:

```markdown
- [w] buy paint 👤 [[Pascal]] 👤 2026-10-25 [[Alicia]] 📅 2026-10-30
```

Of two undated `👤` on one line the first is the assignee and the second stays
in the words. A name of either form ends where the next field, a tag or a
`^block` id starts, so `👤 Bob 📅 2026-10-20 more` names `Bob` and keeps `more`
in the words. A bare `👤` with neither a date nor a name is words, and so is one
with a field straight after it, as in `👤 ⏲ 2h Bob`. One spelling
changed meaning: an undated `👤 Ada` on a `[w]` line used to be who the todo
waits on, and is now the assignee. To keep it as the wait, put the date first.

A `🔁` or `🏁`, and each of `⏲`, `⏱`, `🆔` and `⛔`, with a date field or a
priority straight after it stays in the words, and a recurrence ends at such a
field. So `a ⛔ 📅 2026-10-20 more` keeps `⛔ more` as words, and
`a 🔁 every week 📅 2026-10-20 more` reads the rule `every week` and keeps
`more`. Each of `⏲`, `⏱`, `🆔` and `⛔` also stays in the words straight before
any other marker but `👤`, even when no space follows that marker:
`a ⏲ 🆔 kt-1 more` reads the id `kt-1` and keeps `⏲ more`, while
`a ⏲ 🆔kt-1 more` keeps all of it as words, since `🆔kt-1` is no id.

Where kasten writes such a line again, as the next copy of a recurring todo or
a line whose fields it rebuilds, it writes a date field or the priority straight
after each such marker. Where that does not read back, it writes a `⏲`, `⏱` or
`🆔` straight after it. Either way the marker stays words: the copy of
`a ⛔ 📅 2026-10-20 more 🔁 every week` is `a ⛔ 📅 2026-10-27 more 🔁 every week`.

The five dates are `YYYY-MM-DD` and nothing else. A `📅 next tuesday` is not a
date, so the whole of it stays in the words. The five priority glyphs read
highest, high, medium, low and lowest, in that order. The recurrence is the one
field whose value is free text, so it runs to the next field marker or the next
tag rather than to the next space.

Both clocks take a duration, written `2h`, `45m` or `1h20m`. Nothing else is
one: `90`, `1h30` and `two hours` are words, not times.

Every field marker may carry the variation selector (U+FE0F) after the glyph,
as many keyboards type them, and reads the same either way. A value kasten
writes over one, such as a stop's `⏱` total, keeps the marker as typed.

Only the two clocks and the `👤` are ours. Everything else is what the
obsidian-tasks plugin already reads, so the vault opened in Obsidian shows
working tasks rather than prose. The plugin leaves a marker it does not know in
the task's words, so the three of ours show there as text.

The plugin reads a line back from its end and stops at the first thing it does
not know, so it reads no field written before one of ours. That is why `👤` sits
ahead of every field the plugin reads. `⏲` and `⏱` do not: on a line carrying
either, Obsidian reads the `🆔` and the `⛔` after them and takes the dates
before them for words.

Tags stay where they were typed, even on a line kasten writes new: `call the
#health dentist` keeps its tag mid-sentence, because a tag belongs to the words.

A tag follows [the one tag rule](/reference/tag-format.md): a `#`, then
letters, numbers, `_`, `/` or `-`, at least one of them not a number, read on
the words once the fields are out. So `call #1on1` carries `#1on1`, and `#1984`
is no tag. Any other character ends it, so `(#next)`, `#next,` and `#next.`
carry `#next`, as does `#next` before a `:` or a `!`. A hash inside a code span, a markdown link, a
`[[wikilink]]` or an HTML comment closed on the line is no tag, and neither is one straight after a letter, a digit,
`_` or `/` of the words. So `` `grep #client log` ``,
`[see](https://a.io/p#next)`, `https://a.io/p#next` and `[[note#p/x]]` carry no
tag, and the words keep them as typed. A field's value is not words:
`📅 2026-10-20#next` carries `#next`, while `🆔 kt-3f9a2c,#next` carries none,
the hash being part of the id. The filter line, the saved views, the client mark,
the board and the add prompt all read tags this way.

`⛔` may appear more than once, each naming another todo's id, and every one is
kept in the order it was written. Every other field appears once.

Ten of these are written by kasten today: the state, the due date, the
priority, the created date, the done date, the cancelled date, the id, the
estimate, the worked total and the day a wait began. `est:45m` in
[the add prompt](#the-add-prompts-shorthand) writes the `⏲`, and every stop of
the timer rewrites the `⏱` off [the time log](/reference/todo-format/time-and-repeats.md#the-time-log). The rest are read,
carried and written back untouched: you type a scheduled date, a start date, a
recurrence and a blocker yourself, and kasten reads all four. `⏳` and `🛫`
decide [which group a row sits in](/reference/editor-keys/todo-pane.md#the-todo-pane), `⛔`
hands kasten the state of the line it sits on, and `🔁` writes the next copy
when the todo is ticked.

There is deliberately no block anchor. The id does every job a `^anchor` would
have done: the done log names it, dependencies name it, and the time log names
it.

## The field order

The words come first, then every field the line carries, in this order:

```
👤 assignee 👤 wait 📅 ⏳ 🛫 priority 🔁 🏁 ➕ ✅ ❌ ⏲ ⏱ 🆔 ⛔
```

A line kasten writes new, from the add prompt or as a recurring copy, comes out
in this order. A line already there keeps the order it has: a state change puts
each stamp it adds at its place in the order and moves nothing else.

## Writing a field

A glyph is easy to read and hard to type, so all three places a todo is written
offer the fields it has not got yet. A colon opens the list in the editor, the
todo pane's `i` draws it under the row, and the add prompt draws it under the
input in [its own shorthand](#the-add-prompts-shorthand). One table of fields
answers all three, so a field cannot be reachable in one and missing from
another. `daily`, `weekly` and `monthly` write those three rules in one press,
and `repeat` writes the `🔁` and then offers every plain period, `every weekday`
and the rules naming the day the todo is due: its weekday, its day of the month
and which of that weekday in the month it is. A todo with no due date is read
by its scheduled date, then its start date, then today.

Each reads what is written so far and leaves out what is there: a line already
carrying a `📅` is not offered another. The fields that take a value are written
in two steps, the marker first and the days or the durations after it, so what
lands is a value the table above reads rather than a word it cannot.
[Completing a todo field](/reference/editor-keys/completing.md#completing-a-todo-field)
says which keys, and which four fields are deliberately left out of all three.

## The add prompt's shorthand

`a` and `s` in the todo pane read the same words as instructions rather than as
filters, so `due:08-14` sets a date rather than picking one. The line under the
input is what the vault is about to get.

`!high` and the four beside it set the priority. Every other field is
`term:value`:

| Typed | Writes |
| --- | --- |
| `due:` | `📅` |
| `sched:` | `⏳` |
| `start:` | `🛫` |
| `every:` | `🔁` |
| `est:` | `⏲` |

The three dates take the same five forms:

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

`est:` takes a duration: `est:2h`, `est:45m` and `est:1h20m`. It is the one path
by which kasten rather than your keyboard puts an estimate on a line. Anything
after it that is not a duration stays in the words, as a mistyped date does.

`every:` takes the rule as one word, a word being one word. The `every` is the
term itself, a hyphen stands for each space, and a number may be written
against its unit:

| Typed | Writes |
| --- | --- |
| `every:week` | `🔁 every week` |
| `every:3months` | `🔁 every 3 months` |
| `every:weekday` | `🔁 every weekday` |
| `every:week-on-mon,thu` | `🔁 every week on Monday, Thursday` |
| `every:2-weeks-on-friday` | `🔁 every 2 weeks on Friday` |
| `every:month-on-the-15th` | `🔁 every month on the 15th` |
| `every:month-on-the-last-friday` | `🔁 every month on the last Friday` |
| `every:week-when-done` | `🔁 every week when done` |

It is read through the parser that will count from it and written in
obsidian-tasks' spelling, so `every:fortnight` stays in the words rather than
sitting on the line saying nothing.

Only `due:` is a filter term as well. There is nothing useful to filter on in
the other four, so `sched:tomorrow` in the filter line is text to rank against
rather than a term.

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

None of it has to be typed: the prompt draws every term the input has not used
under it, and a press writes the term and then offers the days or the durations
that follow it. [Writing a field](#writing-a-field) says where else that
happens.
