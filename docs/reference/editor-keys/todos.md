---
type: Reference
title: Editor keys, todos
description: The keys that cycle, set and stamp a todo in the editor, and the todo overlay.
tags: [editor, keyboard, todos, frontend]
status: stable
---

# Todos in the editor

## Todos

A todo is a checkbox line in a note, and [Todo
format](/reference/todo-format.md) is what one is written in. `<leader>x` makes
and walks one where you are typing, the `<leader>s` keys put one straight into a
state, `<leader>i` gives one a name, `<leader>gt` puts the whole vault's list in
the focused pane, and `<leader>ft` opens that same list as an overlay.

`<leader>x` cycles the line the cursor is on. A plain line becomes `- [ ]`, two
more presses walk it through doing and done, and a fourth gives the words back
as prose. It edits the buffer, so `u` undoes it and the autosave writes it.
[The cycle](/reference/todo-format/state-changes.md#the-cycle) says what each press stamps.

The walk is the work and nothing else. Review, blocked, waiting and rejected are
not on it, and the seven `<leader>s` keys are how you reach any state from any
other: `so` open, `sp` doing, `sv` review, `sx` done, `sb` blocked, `sw`
waiting, `sr` rejected. On a line already in the state a key names, the key
changes nothing: no second `- ✅` line, no cursor move, nothing to undo. A press of `<leader>x` on a review line ticks it done.
`sw` stamps a dated `👤` with today after the words and any assignee, and leaves the cursor on the date,
where `a` then types
[who the todo waits on](/reference/todo-format/state-changes.md#waiting-on-somebody). They stamp what the
walk stamps and drag what it drags, so setting a parent done still ticks its
parts. `s` for state, `p` for in progress because `d` is spent on the done
list in the pane, and `v` for verify because `r` is spent on rejected.

The press that enters or leaves done also moves
[the done log](/reference/todo-format/time-and-repeats.md#the-done-log), which lives in another
note and which no buffer edit can reach. Only those two presses read the vault;
the other four touch the buffer and nothing else. `u` puts the line back and
leaves the log entry where it is, because undo is this document's history and
the log is not in it. Press the key again to put the log right.

A todo already living in today's note is the exception, and the better case:
the log line goes into that same buffer, in the press's own transaction, so it
is written by the autosave and `u` takes back both halves at once.

One press can move more than the line it was typed on. Ticking a parent ticks
[its parts](/reference/todo-format/state-changes.md#subtasks), ticking a recurring todo writes
[the next copy](/reference/todo-format/time-and-repeats.md#recurrence) above it, and closing or
reopening a todo something waits on rewrites
[its dependents](/reference/todo-format/state-changes.md#dependencies). Every one of those in
this note is part of the same buffer edit, so one `u` takes back all of it. A
dependent in another note is a write the buffer cannot reach, like the log.

The log and the dependents are found by the todo's `🆔`, so a press whose `🆔`
stands on another todo line too, a pasted copy, moves neither, in this note or
any other. The line in the buffer stays as the press left it, and the notice
says `Nothing moved: 🆔 <id> is on another todo too: <note> line <n>`. The copy
is read off the buffer, so one pasted a moment ago counts and one you just
changed does not. Fix the id on one of the two, then cycle the todo back round
or tick it from the pane: a second press now would walk the line on past done.
A log or dependent write the vault refuses says `Nothing moved:` and the
vault's reason.

`<leader>i` stamps an id on the todo the cursor is on, and does nothing to a
line that is not a todo or that carries one already. It is how you name a todo
that is still open, so a `⛔` on another line has something to point at.

`<leader>@` sends the todo the cursor is on to
[the agent worker](/reference/todo-format/tags-projects-and-views.md#agent-work): it writes `#agent` at
the end of the words, before the fields, and moves nothing else on the line. On
a plain line it makes a todo first, as `<leader>so` does. Pressed again on an
open `[ ]` todo it takes the tag back off, which recalls the todo before the
worker runs it. On a todo in any other state that carries the tag it changes
nothing, and the notice says
`Nothing moved: that todo is already with the agent`. On a todo carrying
`#client`, or under a todo that does, it writes nothing, and the notice says
`Nothing moved: the agent skips client work`, and a todo inside a code fence,
which no worker reads, with `Nothing moved: that line is code`. It edits the buffer, so `u` undoes
it. vim's own `@`, which replays a macro, has no leader in front of it and works
as before. With vim off, and on a phone, the palette's
"Send this todo to the agent, or take it back" does the same.

The editor draws each state as a symbol in place of its box, `☐ ◐ ◎ ☑ ⊘ ◷ ☒`, and
mutes and strikes through a line that is done or rejected. A due date that has
passed is drawn in red, behind any of `📅 📆 🗓`, with or without the variation
selector. A date inside a code span or a link is not the todo's due date, so it
stays uncoloured. A todo with todos indented under it carries `1/3` after
its words, counting every descendant. The whole drawing comes off the line the cursor is on,
in insert and visual mode, the way every other construct does, so `i` hands the
`- [x] ` back. The red is the one part that stays, because it colours text that
is on screen either way rather than standing in for characters.

The count stays while a line shows its source, for the reason the red does:
neither stands in for a character.

Today's date is read when the editor builds its rendering, so a tab left open
across midnight keeps yesterday's idea of overdue until it reloads.

## The todo overlay

`<leader>ft` asks the same question in the panel the finder and search use:
ranked list on the left, the note under the highlight rendered on the right, and
Enter opens it on the todo's line. A row is the note, the line number, the
todo's state symbol beside its words, and the due date where it has one. The
keys are [the note search's](/reference/editor-keys/finding.md#the-note-search).

It is that panel's backlinks mode rather than its search mode. The vault is
asked once and typing only ranks what came back, because what there is to do is
a set the vault decides and the input was never choosing the rows. So there is
no debounce here and no scan per keystroke.

The line underneath says `no open todos` for a vault with nothing to do in it.

The overlay and the pane share one answer, so opening one after the other reads
the vault once.
