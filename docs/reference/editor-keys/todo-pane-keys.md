---
type: Reference
title: Editor keys, the todo pane keys
description: The todo pane's keys in detail, the edit line, timers, blockers, moves, the add prompt and the saved views.
tags: [editor, keyboard, todos, todo-pane, frontend]
status: stable
---

# The todo list, key by key

Under the line `i` opens are the same fields
[the editor completes](/reference/editor-keys/completing.md#completing-a-todo-field), drawn as buttons rather than
as a list: the row is one line among many, and a panel over it would cover the
work it is about. Tab reaches them in the order they are drawn, Enter takes the
one it is on, and a click does the same. The reading of the line is the
editor's own, so taking `due` here also asks which day, and the keys go back to
the line once a button has written into it.

Leader sequences work here too, so `<leader>gd` opens today's note from inside
the pane. `<leader>x` is not among them, and that is right: there is no buffer
under this cursor, and the bare `x` is the key that acts on a row.

Enter opens the note into this pane, which is what clicking a row in the file
tree already does, and `<leader>gt` brings the list back in one press.

`x` writes the vault rather than a buffer. The note the row names is read again
first. A root todo a write above has shifted is found by its words; a row whose
todo cannot be found cycles nothing, and the notice says so. The note redraws
in whatever pane is showing it. Ticking one done also writes the
[done log](/reference/todo-format/time-and-repeats.md#the-done-log) line into today's daily note,
and it carries the same three rules `<leader>x` carries: the parts go with a
parent, a recurring todo gets its next copy, and the dependents of a todo that
just closed or reopened are rewritten wherever they live.

A press on a row of the open list (`x`, a state key, `t`, `@`, `m`, or the
state button on a phone) changes that row only. The list keeps the order it was
drawn in: a row checked off stays where it was, struck through, and a todo
written elsewhere meanwhile joins the end of its group. The order goes once the
focus leaves the pane, the pane closes or the page reloads, and `d`, `n`, `v`,
`c`, `b`, `i`, `s` and the filter draw the list afresh too. A press redraws the
list once, after its last write, whether every write landed or not; the vault's
word on a note the press wrote asks again only where the note now holds other
text than the press wrote (#947).

`t` starts a session on the row's todo, or closes the ones it has running, and
writes both to the [time log](/reference/todo-format/time-and-repeats.md#the-time-log). A row
whose todo has a session open carries `▶` after its state, and where that
session was opened on an earlier day the mark carries the day, `▶ 08-09`, which
is how a timer nobody stopped reads as unstopped. The row shows what is on disk:
there is no clock ticking on it, and a session lands in `⏱` when it is stopped.
Where a write since the list was drawn moved the row's todo so that `t` cannot
tell which line it is, `t` writes nothing and the notice says
`Nothing moved: that line has changed since it was listed`, as a state key does.

`@` sends the row's todo to [the agent worker](/reference/todo-format/tags-projects-and-views.md#agent-work)
by writing `#agent` on its line, and takes the tag back off an open `[ ]` todo,
by the rules of `<leader>@` in [Todos](/reference/editor-keys/todos.md#todos): a todo in another state keeps
the tag, and client work is refused, each with its sentence in the notice. It
writes the way `m` does, in the note's write queue and naming the text it read,
so a note holding text not yet saved, open to type in or still being saved is
not written, and the notice says why. It works on the list, not on the board.
On a phone the row's `⋯` strip carries `agent`, which does the same.
The palette opened over the todo pane lists it too, as "Send the todo under the
cursor to the agent, or take it back", acting on the row under the cursor; over
a note or any other pane it does not.

`t`, `x`, a state key and a dropped card find a todo's sessions, log line and
dependents by its `🆔`. Where that `🆔` stands on another todo line too, a
pasted copy in the same note or in another, the press writes nothing and the
notice says `Nothing moved: 🆔 <id> is on another todo too: <note> line <n>`,
with `, and 2 more` where it stands on three others. Session, log and `⛔` lines
name the id without carrying it, and do not count.

The cell between the count and the date is the two clocks: `⏱ 1h20m / 2h` with
both, `⏱ 1h20m` with only the worked total, `⏲ 2h` with only an estimate, and
nothing with neither. It is what the line carries rather than a sum the pane
worked out.

`/` moves the focus to the filter line, because `j` and `k` have to go on moving
the cursor. Escape or Enter hands the focus back to the list and leaves the
filter applied. [Filter terms](/reference/todo-format/tags-projects-and-views.md#filter-terms) are what
it takes. Anything that is not a term ranks as text, and here the ranking
decides only which rows stay: the groups keep the order.

`v` walks the [saved views](/reference/todo-format/tags-projects-and-views.md#saved-views), one press to
the next. The terms of the view showing sit in the filter line, where they can be
read and edited, and its name sits in the header beside them. One more press past
the last view empties the line and gives the whole list back. Typing over the
terms makes them a filter you typed and takes the name out of the header: the
header names a view or it names nothing. The first press in a vault with no views
note writes it, holding three defaults, the way the periodic keys make the note
they open, and the header reads `no views` where the note holds no line the pane
can read.

`d` swaps the list for what was finished in the last seven days, grouped by the
day it was finished rather than by when it was due, newest day first. A finished
todo has no due date worth grouping on, and a list reaching back to the
beginning of the vault is not one anybody reads to the end of. Pressing `d`
again brings the open list back.

The seven shifted keys set a state directly, which is the only way to review,
blocked, waiting and rejected from here: a row done is off the list the next time it is drawn, and done is
where the walk goes first. They are the pane's spelling of the `<leader>s` keys
and write exactly what those write.

`b` says that the row's todo waits for another one. The list becomes the
picker: a line under the header reads `⛔ pick what blocks:` and the todo's
words, and the footer shows the four keys that still work (on a phone, a
`cancel` button in their place). `j` and `k` move,
`/` narrows, Enter takes the row under the cursor as the blocker, and Escape
gives the list back with nothing written. The picker lists every open todo,
one whose `🛫` has not arrived among them, since a todo you cannot start yet
can still be what another waits for. It takes neither the todo itself nor a
todo the line names already, and stays open when you try. `b` does nothing on
a finished todo.

Enter writes two lines. The blocker gets a `🆔` where it has none, and the
todo gets `⛔` and that id. An open todo becomes blocked; one that is doing or
waiting keeps its state.

`m` moves the row's todo into its project's note, the `index.md` of the
project `GET /api/todos` names for it, which is the note `p` links to. The todo
goes with every line indented under it, as they stand, to the end of that
note's `## TODOs`, which is made where there is none; a project's folder with
no `index.md` gets one holding the todo. In the todo's place stays a plain
bullet, not a checkbox: its words and a link to the project's note. One todo
per press, so no bulk move happens. [The todo board](/explanation/the-todo-board.md#the-refile-key)
says why.

The project's note is written first and the note the todo left second, each
once and in its note's write queue. Neither is written while it is open to type
in, while a write of it is in the air, or while it holds text a failed save
left, and the notice says which. Where the project's note is not written,
nothing moves. Where the note the todo left changed since it was listed, or its
write fails, that note is not written: the notice says the todo was copied and
asks you to check that note before pressing again. A second `m`
then finishes the move without a second copy only where the todo carries a
`🆔` and the project's note holds its whole block as it stands; otherwise it
copies the todo again, since a duplicate can be deleted and a lost line cannot.
A press right after another on the same note finds its todo by its words where
the first press moved it, when exactly one root todo has those words; a part
whose line moved reads as changed. A todo with no project
moves nowhere, and the notice names `p` and a `#p/x` tag; a todo already in its
project's note stays. The way back is the
[history pane](/reference/editor-keys/panes-and-tabs.md#the-history-pane)'s restore on each of the two notes: `u` in an
editor does not reach a write made through the vault.
[Dependencies](/reference/todo-format/state-changes.md#dependencies) has the rule.

A row that waits says for what: `⛔` and the blocker's words, or `⛔ 2` where
it waits for more than one, with every blocker in the hover title. A blocker
already closed is not counted, and a `⛔` naming an id no note holds shows the
id. Where two todos carry the id a `⛔` names, the blocker counts and shows the
id while one of them is open, since which of the two the `⛔` meant cannot be told; with both closed it holds nothing. A row something waits for carries `→` and how many, with their words in
the hover title. Both are read off the lines the vault holds, and nothing is
stored for them.

`n` swaps the list for one row per top level todo, each naming the one thing
you could start on it, which is the GTD question asked directly. That is the
first open leaf under the todo, depth first, and `#next` on any part under it
wins over that order. A todo with no parts is its own next action, so a flat
list of unrelated todos reads here as it does out of this mode. Where the action
is not the todo itself, the row draws the todo's words muted in front of the
action's. Enter opens the action's own line, not the top level todo's. A todo
whose every part is done, rejected or waiting on a `🛫` has no row. Pressing `n`
again brings the full list back, and `d` and `n` swap the same list rather than
stacking.

`a` opens the add prompt over the pane. Type one line of
[shorthand](/reference/todo-format/the-line.md#the-add-prompts-shorthand), read the line
it will write under the input, and Enter puts it under `## TODOs` in today's
daily note, making that note where the vault has none. Escape closes and writes
nothing, and Enter on an empty input does nothing.

Under the preview are the terms that line has not used, drawn as the pane draws
them under an edit and reached the same way, by Tab or by a click. A press
writes the term, `due:` or `every:` or `!high`, and the ones that take a value
then offer it, so a todo due Friday and repeating every other Friday can be
written without typing a colon. Enter on one of them takes it rather than writing the todo.

`s` opens that same prompt on the row under the cursor, and what it takes lands
as a part of that todo: in the note the todo lives in, one step further in, after
the parts it already has. The header reads `part` rather than `todo` and names
the todo it is going under, those being the whole of the difference between the
two presses. The shorthand is the same, so a part arrives with its date and its
priority already on it, and the count on the parent's row moves the moment it
lands.

The note is read again first and the parent's line checked against the row, the
way an edit checks it: the part is placed off that line, so a row the vault has
moved past writes nothing rather than hanging it under whatever now sits there.

`i` turns the row under the cursor into the line it was read from, markdown and
emoji as the note holds them, and Enter writes back exactly what you leave in
it. No overlay and no shorthand: the line is the whole record, so an edit is the
line itself, and that is what reaches what nothing else here can, the state and
the indent that makes a todo a part of another. The words, the dates and the
priority are all in reach too. What the row
draws is a reading of that line, which is why the whole row gives way to it
rather than the words alone.

The key is vim's: `i` starts typing where the cursor is, here as in a buffer.
While the line is open the list's keys are its: `x` is a letter in there, not a
cycle. Escape puts the row back and writes nothing, Enter writes and puts it
back, and an input left empty writes nothing either, deleting a todo not being
what this key is. A new line kasten writes in one order; a line edited here
keeps whatever order you leave it in, and a press that changes its state moves
none of it.

The note is read again first and the old line checked against the row, so an
edit onto a row that has gone stale writes nothing rather than replacing
whatever now sits at that line. Nothing follows the edit: a `## Done` line or a
session line naming a todo you have just reworded goes on saying what it said,
those being the record of what happened rather than a copy of the task.

The pane is not in the URL. Terminal panes are not either, and the arrangement
of panes is already lost on a reload, so a reload comes back to an empty pane
and `<leader>gt` is one press.

The list is read again on every write the vault reports over `/api/events`, so a
todo written by an agent or over ssh appears without a reload. A folder move or
a deleted note reads it again too, as either can change a todo's project.
