---
type: Reference
title: Todo format
description: The line a todo is written on, every field it carries, the six states, the cycle, the done log, the time log, the tag that marks client work, the terms that filter one, and the note that saves them.
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
optional and the bullet and the box are not. The indent is kept as typed, a
tab staying a tab, so a todo nested under another stays nested.

Two things that look like a todo are not. `1. [ ] ordered` is an ordered list
item, and `- [[borges]]` is a bullet holding a wikilink. Neither is a todo here
or to `GET /api/todos`.

A state change patches the line rather than rebuilding it. The box changes, and
the stamps the change adds or drops (`✅`, `❌`, `🆔`, `👤`, `➕`) go in or come
out; every other byte stays where it was typed. That keeps a tab indent, a
`^block` id at the end of the line where links find it, the spacing in the
words, and fields that sit out of [the order below](#the-field-order). A stamp
goes in at its place in that order. If no place reads back right, kasten writes
the whole line in the field order instead, since correct fields matter more than
kept bytes.

A marker kasten does not know, and one whose value does not parse, stays in the
words where the person who typed it can see it. So does a marker inside a
`[[wikilink]]`, a markdown link or a code span: `[[notes 📅 2026-10-20]]` gives
the todo no due date.

## The fields

| Field | Spelling | From |
| --- | --- | --- |
| state | `[ ]` `[/]` `[x]` `[b]` `[w]` `[-]` | ours |
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
| waiting on | `👤 2026-08-03 [[Ada Lovelace]]` | ours |
| tags | `#kasten` | Obsidian |

The five dates are `YYYY-MM-DD` and nothing else. A `📅 next tuesday` is not a
date, so the whole of it stays in the words. The five priority glyphs read
highest, high, medium, low and lowest, in that order. The recurrence is the one
field whose value is free text, so it runs to the next field marker or the next
tag rather than to the next space.

Both clocks take a duration, written `2h`, `45m` or `1h20m`. Nothing else is
one: `90`, `1h30` and `two hours` are words, not times.

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

`⛔` may appear more than once, each naming another todo's id, and every one is
kept in the order it was written. Every other field appears once.

Ten of these are written by kasten today: the state, the due date, the
priority, the created date, the done date, the cancelled date, the id, the
estimate, the worked total and the day a wait began. `est:45m` in
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

## The six states

| Box | State | Drawn |
| --- | --- | --- |
| `[ ]` | open | ☐ |
| `[/]` | doing | ◐ |
| `[x]` | done | ☑ |
| `[b]` | blocked | ⊘ |
| `[w]` | waiting | ◷ |
| `[-]` | rejected | ☒ |

`[X]` reads as done as well, because another editor writes it that way. kasten
always writes `[x]`.

Six rather than the plugin's two, because blocked, waiting and rejected are
things that happen to work and a todo that is neither open nor done has to be
able to say which. `[/]` and `[-]` are what most Obsidian themes already style;
`[b]` and `[w]` have no convention behind them and read as what they are.
Obsidian shows a box it does not know as a task that is not done.

Blocked and waiting are two different holds. A blocked todo waits on another
todo, which its `⛔` names. A waiting todo waits on somebody, for an approval or
an answer, and [its `👤`](#waiting-on-somebody) says who and since when.

Open means neither done nor rejected, which is what
[the todo pane and the todo overlay](/reference/editor-keys.md#todos) both show.
A blocked todo is open work, and so is a waiting one.

## The cycle

`<leader>x` in the editor, and `x` in the todo pane, walk one line one step:

| From | To | Stamps |
| --- | --- | --- |
| a plain line | `[ ]` | `➕` today, unless the line already carries one |
| `[ ]` | `[/]` | nothing |
| `[/]` | `[x]` | `✅` today, and `🆔` unless the line already carries one |
| `[x]` | a plain line | strips the `✅` it wrote |
| `[b]` | `[/]` | nothing |
| `[w]` | `[/]` | strips the `👤` |
| `[-]` | a plain line | strips the `❌` it wrote |

The walk is the work: not started, started, finished, and out of the list again.
Blocked, waiting and rejected are things that happen to work rather than steps
in it, so none is on the walk and each has [a key of its own](#setting-a-state). That
is also what puts done last. A list of open work loses a row the moment it is
done, so a walk with two closed states in it could never reach the second: from
the todo pane the old order made blocked and rejected unreachable, because the
row left the list at done and took the rest of the walk with it.

The walk picks a blocked line up where the work left off, at doing, rather than
at the start of it. A todo somebody blocked is one somebody had begun. It picks
a waiting line up at the same place, the answer having come.

The first step reads the fields already on the line, so a todo written out by
hand arrives carrying them. It takes the line's bullet off where it had one, the
box standing in for it.

Either step out drops the bullet, the box and the stamp its own state wrote, and
keeps every other field, so three more presses give the todo back with its
dates. It patches the line the way every other step does, so the tag stays
where it was typed:

```markdown
- [-] call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 ❌ 2026-08-10 #health
```

becomes

```markdown
call the dentist 📅 2026-08-14 ⏫ ➕ 2026-08-09 #health
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

Six keys put a line straight into one state from wherever it was: `O`, `P`,
`X`, `B`, `W` and `R` in the todo pane, and `<leader>so`, `<leader>sp`,
`<leader>sx`, `<leader>sb`, `<leader>sw` and `<leader>sr` in the editor. `p` is
in progress, `d` being spent on the done list.

A state is worth the same whichever key wrote it. Entering done stamps `✅`
today and an `🆔` where the line carries none, entering rejected stamps `❌`
today, and leaving either drops the stamp it wrote, exactly as the walk does.
Entering waiting stamps `👤` today, and leaving it drops the `👤` whole.
A key aimed at the state a line is already in changes nothing. A plain line
becomes a todo in that state, carrying the `➕` the walk would have stamped.

Everything a press drags with it comes too: a parent set to done takes its open
parts, a recurring todo set to done writes its next copy, and a todo carrying an
`🆔` set into or out of done moves what waits on it.

## The field order

The words come first, then every field the line carries, in this order:

```
👤 📅 ⏳ 🛫 priority 🔁 🏁 ➕ ✅ ❌ ⏲ ⏱ 🆔 ⛔
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
[Completing a todo field](/reference/editor-keys.md#completing-a-todo-field)
says which keys, and which four fields are deliberately left out of all three.

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

A part takes what the todo above it carries and does not spell for itself: the
due date, the scheduled date, the start date, the priority and
[the client mark](#client-work). `esim` above is
due 2026-08-14, and so is `pick a plan`, each field coming off the nearest todo
above it that carries one. A part that spells its own wins, and that is the
whole of the override: `- [ ] esim 📅 2026-08-12` is due on the twelfth whatever
its parent says.

Nothing else comes down. `🆔` names one line, `➕`, `✅` and `❌` stamp what
happened to it, `⏲` and `⏱` measure it, `⛔` waits on something and `🔁` copies
it: passing any of those down would say of five lines what was written of one.

This is read rather than written. The line still says only what somebody typed
on it, so moving a parent's date moves every part with it, and what the vault
holds is what you would write by hand. The pane is where it shows: an undated
part sits in its parent's group, drawn under it, with that date on the row, and
a part whose parent has a `🛫` in the future waits with it. The editor draws the
note, so a part's line shows the date it carries and no other.

A parent shows `1/3` after its words, in the editor and on its row in the pane.
The count is every descendant rather than the direct children, so a part with
parts of its own counts each of them, and a part that is done or rejected counts
as closed. A todo with no parts shows nothing.

Ticking a parent done ticks every part that is still open, stamping today's
`✅` on each and leaving a part that was already done or rejected where it is.
Blocked and waiting count as open, so a `[b]` or a `[w]` part goes done with the
rest, the `[w]` one losing its `👤`. One
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

[`b` in the todo pane](/reference/editor-keys.md#the-todo-pane) writes the
pair: you pick the blocker from the list, kasten stamps a `🆔` on it where it
has none, and the todo under the cursor gets the `⛔`. An open todo becomes
`[b]` in the same write, unless the blocker is already closed. The blocker's
note is written first, so a write that fails halfway leaves an id nothing
names and never a `⛔` naming nothing.

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

Deleting the last `⛔` from a `[b]` line with the pane's `i` opens the line in
the same write, since no blocker is left whose press could open it. The same
deletion typed in the editor leaves the `[b]`, which `<leader>so` clears.

A line may carry several `⛔`, and it opens only when every one of them is
closed. A `⛔` naming an id no note holds changes nothing: an unresolvable
blocker reads as open, so nothing is opened on a guess and nothing is destroyed
by a blocker that has been deleted.

One level per write. If A blocks B and B blocks C, closing A opens B, and C is
opened by the write that closes B rather than by the same pass.

## Waiting on somebody

`[w]` says a todo waits on a person, and `👤` says who and since when:

```markdown
- [w] decision record for the queue #adr 👤 2026-08-03 [[Ada Lovelace]] 📅 2026-08-14
```

The date comes first and is the day the wait began. The name comes after it and
runs to the next field, the next tag or the end of the line. It is free text,
so `the tax office` is a name. A `[[link]]` to
[a person's note](/explanation/people-in-the-vault.md) is the better one: the
link is on the line, so the todo shows on that person's card. Either half may
be missing. A `👤` with nothing after it is not a field and stays in the words.

`W` in the todo pane and `<leader>sw` in the editor set the state and stamp
`👤` with today. A date the line already carries is kept, so setting the state
twice does not restart the wait. kasten cannot know the name, so you type it,
straight after the date. Both places put the cursor there on a waiting line
that names nobody: `i` in the pane opens the line with the cursor after the
date, and `<leader>sw` leaves it on the date's last digit, where `a` appends.
From the pane that is `W`, `i`, a space and the name, Enter.

The `👤` is written straight after the words, ahead of every other field, so
that [Obsidian still reads the rest of the line](#the-fields).

Leaving the state drops the `👤` whole, the name with the date, whichever key
leaves and wherever it goes. The field says who the todo waits on, and it no
longer waits. `x` on a waiting line goes to doing, as it does on a blocked one.

A `👤` on a line that is not `[w]` is read, carried and written back by every
key, and means nothing until the line is set to waiting. Then its name is kept
and the date is stamped.

`⛔` and `[w]` do not meet. kasten moves a line carrying `⛔` between `[ ]` and
`[b]` only, so a waiting line that also names a blocker stays waiting when the
blocker closes.

The todo pane keeps a waiting row in the group its due date names, drawn muted
as a blocked row is, with the days waited and the name on the row: `👤 7d Ada
Lovelace`. [The todo pane](/reference/editor-keys.md#the-todo-pane) says the
rest.

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

[The todo pane](/reference/editor-keys.md#the-todo-pane) draws `◆` on a row of
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

## Filter terms

The todo pane's filter line takes these:

| Term | Matches |
| --- | --- |
| `#tag` | a todo carrying that tag |
| `!highest` `!high` `!med` `!low` `!lowest` | that priority |
| `/open` `/doing` `/done` `/blocked` `/waiting` `/rejected` | that state |
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
[the done log](#the-done-log), may write [the next copy](#recurrence) and may
reopen what waited on it. `KASTEN_API` in the shell container holds the address
to send that to.

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

## Projects

The [board](/reference/editor-keys.md#the-board) files each todo under a project
by four steps, the first that answers winning:

1. The note sits in a project folder: a folder directly under `02 Projects` or
   `03 Areas`, at any depth below it. A todo in `02 Projects/FDE/plan.md`
   belongs to `02 Projects/FDE`.
2. Else the first `[[link]]` on the line that lands on a note in a folder under
   `02 Projects`. `- [ ] send the deck [[02 Projects/FDE/index|FDE]]` in a
   daily note belongs to FDE. A link to a note that is not there counts for
   nothing.
3. Else the project of the todo it is a part of.
4. Else no project.

Nothing moves: the link is one Obsidian reads and obsidian-tasks leaves alone.
[The todo board](/explanation/the-todo-board.md) says why.

## Related

* [Editor keys](/reference/editor-keys.md#todos): the keys that make a todo, walk it and list it
* [HTTP API](/reference/http-api.md#get-apitodos): `GET /api/todos`, which finds the lines
* [Note frontmatter](/reference/note-frontmatter.md): the other block of a note kasten keeps in step
