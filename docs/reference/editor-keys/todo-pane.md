---
type: Reference
title: Editor keys, the todo pane
description: The todo pane, its rows, groups and sorting, and the keys that act on its list.
tags: [editor, keyboard, todos, todo-pane, frontend]
status: stable
---

# The todo list

## The todo pane

`<leader>gt` fills the focused pane with every open todo in the vault, grouped
by when it is due, under Overdue, Today, This week, Later and No date. An empty
group draws no heading. A row is the state's symbol, the mark where a timer is
running on it, the priority where there is one, `◆` on
[client work](/reference/todo-format/tags-projects-and-views.md#client-work), the words, the count of
its parts where it has any, the two clocks and the day of the due date.

A click or a tap on a row opens the line the todo is written on. On a touch
screen the state's symbol is a button of its own that cycles the todo as `x`
does, and the header carries a `+` that adds one as `a` does. Under the header
`done`, `next`, `view` and `board` do what `d`, `n`, `v` and `c` do, and
nothing while a row is being edited or a blocker picked. Each row ends in a `⋯`
that opens a strip under it, one strip at a time: `open`, `doing`, `review`,
`done`, `blocked`, `waiting` and `rejected` set the state as `O`, `P`, `V`, `X`,
`B`, `W` and `R` do,
`timer` is `t`, `part` is `s`, `edit` is `i`, `blocked by` is `b` and
`refile` is `m`. `edit`
does nothing while another row is being edited. After `blocked by`, a tap on a
row picks it as the blocker and opens nothing, and `cancel` beside the picker's
line is Escape. A state picked from the strip is set on one tap.

With a mouse the `done` `next` `view` `board` strip under the header shows
too, and each button names its key: `d done`, `n next`, `v view` and `c board`.
A click does what the key does, and nothing while a row is being edited or a
blocker picked.

The state button takes two taps: the first turns the symbol into the state the
todo would move to with a `?` after it, and the second is the one that cycles.
The question is taken back after four seconds, on a tap anywhere else, when the
list scrolls, and when another row's button is tapped. Opening a strip takes it
back too, and a tap on a state button shuts an open strip. The keys ask
nothing. [kasten on a phone](/explanation/kasten-on-a-phone.md#a-write-asks-first)
says why the button asks and why there is no Undo.

Inside a group the important work comes first: highest, high, medium, then what
carries no priority at all, then low and lowest, which is where obsidian-tasks
reads a bare line. Between two rows of the same priority, client work comes
before internal work. Two rows that still tie keep the order the vault answered
in. A part sorts with the todo it hangs off rather than on its own priority, so
it never leaves it.

A part is drawn one step in under the todo it belongs to, so the list reads the
way the note does. Where that todo is not a row in the same group, because it
carries a date of its own or because it is already done, the part goes back to
the edge and names it in front of its own words instead: an indent under
whichever row happened to land above it would be a lie about the note.

The group is read off the scheduled date where the todo has one and off the due
date otherwise, so a task due Friday and scheduled Tuesday sits under Tuesday,
which is the day you have to act on it. A due date in the past wins over both
and lands the row in Overdue whatever it was scheduled for. A `🛫` after today
keeps the row off the list until the day it names: a list of things you cannot
start yet is not a list of what to do. All three dates and the priority are read
off the todo above where a part spells none of its own, so an undated part sits
in its parent's group with its parent's date on the row, and one whose parent
has not started yet waits with it. [Subtasks](/reference/todo-format/state-changes.md#subtasks)
says what comes down and what never does. A blocked row is drawn muted and
sits in the group its due date names rather than under a heading of its own, its
state already being written on the line. A row
[waiting on somebody](/reference/todo-format/state-changes.md#waiting-on-somebody) is drawn
the same way and says for how many days and on whom before its date,
`👤 7d Ada Lovelace`. A narrow row cuts the name short and keeps the days. The footer counts the rows, so many open and so many
blocked, how many are waiting where any are, how many are to review where
any are, and how many timers are going
where any are.

Only open todos are listed. One that is done or rejected is not work, and the
session lines `GET /api/todos` also matches are not todos, so neither is here.

| Key | Does |
| --- | --- |
| `j` / `k` | Move the cursor down or up |
| Enter | Open the note the todo is in |
| `x` | Cycle the todo under the cursor |
| `a` | Add a todo to today's note |
| `s` | Add a part of the todo under the cursor |
| `i` | Edit the row's own line, in place, with the fields it has not got under it |
| `t` | Start a timer on the todo under the cursor, or stop the ones it has running |
| `@` | Send the todo under the cursor to the agent, or take it back |
| `d` | Show what was finished in the last seven days |
| `n` | Show one next action per task |
| `v` | Show the next saved view, or all todos again |
| `c` | Turn the list into [the board](/reference/editor-keys/todo-board.md#the-board), and back |
| `O` `P` `V` `X` `B` `W` `R` | Set the row's todo to open, doing, review, done, blocked, waiting or rejected |
| `b` | Pick the todo that blocks the row's todo |
| `m` | Move the row's todo, and every line under it, into its project's note |
| `/` | Narrow the list |
| `q` | Close the pane |
| Escape | Back to the editor |
