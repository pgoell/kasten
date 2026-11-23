---
type: Reference
title: Editor keys, the todo pane
description: The todo pane, its table and side panel, the list and board under its Board tab, and the keys that act on each.
tags: [editor, keyboard, todos, todo-pane, frontend]
status: stable
---

# The todo list

## The todo view

`<leader>gt` fills the focused pane with the todo view: a table of todos with a
side panel where every todo is edited. Across the top run the tabs Today,
Upcoming, Inbox, All and Board, then a filter, the grouping and New.

* **Today** lists what is on now: a todo planned for today or before, one due
  today or overdue, one being done or in review, and one waiting on somebody.
  A part counts with its parent's planned day.
* **Upcoming** lists the todos planned, or else hard due, in the next fourteen days,
  grouped by day: one group for each of the next seven days, then one for the
  week after. Above them a strip draws the seven days, each with how many todos
  it holds, their estimates added up, and a bar that fills at six hours; a flag
  marks a day with a hard due date. A todo counts on the day it is filed under,
  so one planned on Monday and due on Wednesday counts on Monday, where its
  deadline does not fall, and flags neither day. A press on a day scrolls to
  its group. Each day group's heading says its hard due dates and the time planned on it, and
  its `+` plans the new todo on that day.
* **Inbox** lists the todos with no project, no planned day and no parent.
* **All** lists every open todo, those held off until a later day included.
* **Board** draws [the todo pane](#the-todo-pane) below on its board, as it was.

Today, Upcoming and Inbox leave out a todo held off until a later day, and a
waiting one before its look-again day. Today and All end in **Done today**,
the todos finished today.

The table groups by state (Doing, Review, Open, Waiting, Blocked) or, picked
from **Group**, by project; Upcoming groups by day. A heading names its group and how many it holds,
and its `+` starts a new todo in that state or project. Each row shows the
priority as bars, the state box, the words with the tags after them, the parts
done of all, then one detail (who it waits on and for how many days, the todo
that blocks it, the time worked of the estimate, or how it repeats), the
project, how many notes it touches (the note it lives in and each `[[link]]` in
its words or description), and the day: a hard due date with its flag, red once
past, else the planned day, else a soft due date two days out or nearer. A part
sits under its parent when both are in the group. On a pane narrower than about
720 pixels a row takes two lines, the words over the project and the day.

A click on the state box ticks the todo done, or opens a finished one again. A
click on the rest of the row opens it in the panel.

### The side panel

The panel sits to the right of the table, or in its place on a pane narrower
than 900 pixels. It holds the project, the words, a description, the fields
State, Priority, Planned, Due, Hold until, Time, Repeat and Tags, the notes and
the parts.
Everything saves as it is typed: changes rest 0.4 seconds, then go to the store
as one change. A change the store refuses because the todo moved since it was
read is read again and sent once more. The foot of the panel says Saving… or
Saved as you type.

* The project, State and Priority are pickers. Planned, Due and Hold until each
  open [the date popover](#the-date-popover) on their own tab.
* Time takes an estimate as `2h`, `45m`, `1h30m` or minutes, and Start or Stop
  runs the timer.
* Tags are read off the words, so a `#tag` typed in the words adds one.
* Notes lists the note the todo lives in, then each note a `[[link]]` in the
  words or description names; a click opens it. Link a note, or `n` with the panel
  open and the focus outside a field, or `[[` typed in the description, opens a picker of
  the vault's notes: type part of a name, and Enter or a click writes its link
  into the description, in place of the `[[` that opened it or on a line of its
  own. A note named alike in two folders is linked by its path.
* A note that a todo's words or description link to lists that todo at its foot
  under **Todos that link here**, open ones first; its box ticks it and its
  note's name opens where it lives. A todo living in the note is left out, as
  the note draws it where it sits.
* Parts lists the todo's parts, each box ticking it and each name opening it in
  the panel, and Add part adds one on Enter.
* The `⋯` asks once more, then deletes the todo and its parts.

### The date popover

`d` on a row, or a press on a date in the panel, opens one popover for the
todo's three dates: Planned, Due and Hold until, one tab each, and Tab moves
between them. A day is typed (`wed`, `tomorrow`, `2026-12-01`), picked from the
list (Today, Tomorrow, Next week, which is the coming Monday, and No day) with
the arrows and Enter, or pressed on the three weeks of calendar below. A due
date picked this way is hard; No day on Due gives back the soft one the store
keeps 14 days out. With a due date set, a switch at the foot makes it hard or
soft, and the line under it says how the todo repeats.

`s` and `p` open a short list of the states or the priorities by the row: `j`
and `k` or the arrows move, Enter or the number beside one picks it. Escape or
a press outside closes any of them.

### A new todo

New or `a` opens the panel empty. Words in the title fill the fields as they are
typed, and are marked where they sit: `today`, `tomorrow`, a weekday or a
`YYYY-MM-DD` plan the day, `due:` with one of those sets the due date, `p1` to
`p4` the priority from highest to low, `#Name` the project of that name, `30m`
or `2h` the estimate, and `daily`, `weekly`, `monthly` or `yearly` the repeat.
Each field filled that way says "from the words", and a field picked by hand
wins. The todo lands in today's daily note. Enter adds it and opens it, Shift
Enter adds it and starts the next, Escape cancels.

| Key | Does |
| --- | --- |
| `j` / `k` | Move the cursor down or up; with the panel open, it follows |
| Enter | Edit the cursor's todo in the panel |
| `x` | Tick the cursor's todo done, or open it again |
| `d` | Open the date popover on the cursor's todo |
| `s` | Pick the cursor's todo's state |
| `p` | Pick the cursor's todo's priority |
| `a` | Start a new todo in the panel |
| `n` | With the panel open, link a note into its description |
| `g` `n` | Open the note the cursor's todo lives in |
| `/` | Filter the table by its words |
| Escape | Close the panel |
| Space | The leader |

## The todo pane

The todo view's Board tab holds this pane, on its board; `c` turns it into the
list this section describes. The list holds every open todo in the vault,
grouped by when it is due, under Overdue, Today, This week, Later and No date. An empty
group draws no heading. Done this week comes last and stays folded, see
[Done this week](#done-this-week).

A row starts with its state box. Each state has a box of its own look: open,
doing, review, waiting, blocked, done and rejected. In front of the words
come the timer mark `▶` where a timer runs, the priority where there is one,
and `◆` on [client work](/reference/todo-format/tags-projects-and-views.md#client-work).
The date sits at the right. It is red when it is overdue. Under the words is a
meta line with the project, the tags, who the todo waits on and since when, the
blocker, the count of its parts, the time, and the assignee chip where there is
one.

A click or a tap on a row opens the line the todo is written on. On a touch
screen the state box is a button of its own that cycles the todo as `x`
does, and the header carries a `+` that adds one as `a` does. Under the header
one line holds the list switches, then the [kind chips](#kind-chips) and the
[Shared lists](#shared-lists) toggle, and scrolls sideways where the pane is
too narrow for all of them. `done`, `next`, `view` and `board` do what `d`, `n`,
`v` and `c` do, and
nothing while a row is being edited or a blocker picked. Enter and Space on a
focused button press that button, and on the cursor's row they keep their own
meaning. Each row ends in a `⋯`
that opens a strip under it, one strip at a time: `open`, `doing`, `review`,
`done`, `blocked`, `waiting` and `rejected` set the state as `O`, `P`, `V`, `X`,
`B`, `W` and `R` do,
`timer` is `t`, `part` is `s`, `edit` is `i`, `blocked by` is `b` and
`refile` is `m`. `edit`
does nothing while another row is being edited. After `blocked by`, a tap on a
row picks it as the blocker and opens nothing, and `cancel` beside the picker's
line is Escape. A state picked from the strip is set on one tap.

With a mouse the `done` `next` `view` `board` switches show too, and the
header names the pane, `todos`, before the filter. Each button names its key: `d done`, `n next`, `v view` and `c board`.
A click does what the key does, and nothing while a row is being edited or a
blocker picked.

The state box takes two taps: the first turns the box into the state the
todo would move to with a `?` after it, and the second is the one that cycles.
The question is taken back after four seconds, on a tap anywhere else, when the
list scrolls, and when another row's button is tapped. Opening a strip takes it
back too, and a tap on a state box shuts an open strip. The keys ask
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
`👤 7d Ada Lovelace`. A narrow row cuts the name short and keeps the days. A todo with an assignee draws it as a chip with that person's name, and a click or tap on the chip opens the person note, not the row. Until the vault's file list arrives, the chip is plain, neither filled nor dashed, and a press on it opens nothing. Over the open list the footer draws [the legend](#the-legend)
and how many timers are going where any are. Over the next list and the
blocker picker it counts the rows in words, so many open and so many blocked,
how many are waiting and how many are to review where any are. With a mouse
the keys this list binds follow on the same line, cut short where the pane is
narrow; `?` lists them all.

### Done this week

The todos done in the last seven days, the window `d` reads, sit last under a
heading, Done this week, folded. A tap or a click on the heading unfolds it, and
a second one folds it again. While it is folded, `j` and `k` skip its rows. Once
it is unfolded they walk into it. A press on one of its rows keeps every row in
place until a second has passed with no press, so `x` then `x` cycles the same
row: done becomes plain words, then an open todo again. A phone draws no box
on these rows.

### The legend

The footer of the open list draws the seven state boxes, each with its count. Open, doing, review,
waiting and blocked count the open rows shown. Done counts the Done this week
rows. Rejected counts the todos rejected in the last seven days. Every filter
applies to the counts.

### Kind chips

After the list switches come four chips: All, #client, #internal and #private. A
chip keeps only the todos of its kind. A todo's kind is its own kind tag, or the
tag of its nearest ancestor when it has none, so a part of an #internal todo is
#internal. The chips narrow the list and the board alike.

### Shared lists

A todo in a note directly inside the share folder, `05 Shared` by default, is in
a shared list. Shared lists are hidden by default, so the shopping and household
lists stay out of the work list. The Shared lists toggle shows them, and hides
them again. It shows only while it would change the list: while they are
shown, or while they hide at least one todo. While they are hidden it reads `Shared lists, N hidden`, with N the
count the other filters would show. Once they show it reads `Shared lists, shown`. Turning it on or off writes nothing to disk.

The toggle is kept per device, in the browser under the key
`kasten.todos.shared`, so a reload keeps it. Where the browser refuses storage,
the lists stay hidden.

Only open todos are listed, and the todos done in the last seven days under
Done this week. Rejected todos are not listed. The session lines
`GET /api/todos` also matches are not todos, so neither is here.

| Key | Does |
| --- | --- |
| Click or tap a group heading | Fold or unfold the group, Done this week included |
| `j` / `k` | Move the cursor down or up, into Done this week only when it is unfolded |
| Enter | Open the note the todo is in |
| `x` | Cycle the todo under the cursor |
| `a` | Add a todo to today's note |
| `s` | Add a part of the todo under the cursor |
| `i` | Edit the row's own line, in place, with the fields it has not got under it |
| `t` | Start a timer on the todo under the cursor, or stop the ones it has running |
| `@` | Send the todo under the cursor to the agent, or take it back |
| `d` | Show what was finished in the last seven days, one list per day |
| `n` | Show one next action per task |
| `v` | Show the next saved view, or all todos again |
| `c` | Turn the list into [the board](/reference/editor-keys/todo-board.md#the-board), and back |
| `O` `P` `V` `X` `B` `W` `R` | Set the row's todo to open, doing, review, done, blocked, waiting or rejected |
| `b` | Pick the todo that blocks the row's todo |
| `m` | Move the row's todo, and every line under it, into its project's note |
| `/` | Narrow the list |
| `q` | Close the pane |
| Escape | Back to the editor |
