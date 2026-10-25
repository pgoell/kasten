---
type: Reference
title: Editor keys
description: Every keyboard binding kasten adds, the mode each one applies in, and what a touch screen reaches without one.
resource: frontend/src/lib/key-bindings.ts
tags: [editor, keyboard, vim, touch, frontend]
status: stable
---

# Editor keys

The editor runs vim, unless the device is a touch screen or you turned vim off.
Everything in the pages below is what kasten adds on top of vim; every vim binding not
listed here still does what vim does. [Vim on or off](#vim-on-or-off) says what
the editor does without it.

Three files in `frontend/src/lib` hold these bindings as tables: the leader in
`leader-keys.ts`, the keys that act inside the buffer in `buffer-keys.ts`, and
the terminal, tree and pane keys in `key-bindings.ts`. Both the registrations
and the which-key panel and key help are built from them. A test fails if a table names a
command the app does not provide.

## Pages

* [Touch screens](/reference/editor-keys/touch.md): what a finger draws and reaches, the toolbar, focus, closing panels and each pane's touch answers.
* [The leader key](/reference/editor-keys/leader.md): every leader key by column, the command palette, the `/` menu and the screens you type into.
* [Panes, tabs and views](/reference/editor-keys/panes-and-tabs.md): splits, tabs, zoom, the history pane, the graph pane and the pdf pane.
* [The vault in the tree](/reference/editor-keys/file-tree.md): the file tree's keys, its drawer on a phone, and moving rows by drag.
* [Terminals and chat](/reference/editor-keys/terminal.md): the terminal pane and its keys, and the chat pane with Claude Code.
* [Books in the reader](/reference/editor-keys/book-pane.md): the book pane, its contents list and the highlights taken into a note.
* [Videos in the player](/reference/editor-keys/video-pane.md): the video pane, its chapters, the video view and its takes, its player keys, and the transcript written into a note.
* [Links and people](/reference/editor-keys/links.md): the person card, wikilinks and the link panels.
* [Completion lists](/reference/editor-keys/completing.md): the lists offered for a link, a tag and a todo field.
* [Editing text](/reference/editor-keys/editing.md): formatting, copying, tables, backticks and indenting.
* [Images](/reference/editor-keys/images.md): pasting, drawing and toggling images.
* [Saving and reloading](/reference/editor-keys/saving.md): writing and rereading a note, and the changed-on-disk states.
* [Getting notes into the vault](/reference/editor-keys/capture.md): web pages, markdown files, thoughts into today's dump, and taking a note out.
* [Finding and dating notes](/reference/editor-keys/finding.md): the note prompt, the note finder, the note search and the periodic notes.
* [Todos in the editor](/reference/editor-keys/todos.md): cycling and stamping a todo, and the todo overlay.
* [The review pane](/reference/editor-keys/review-pane.md): the keys for a flashcard sitting, folds, parking and undo.
* [The todo list](/reference/editor-keys/todo-pane.md): the todo pane, its rows and groups, and its key table.
* [The todo list, key by key](/reference/editor-keys/todo-pane-keys.md): edit, timers, blockers, moves, the add prompt and saved views.
* [The todo board](/reference/editor-keys/todo-board.md): the board's columns, lanes, keys and drag.

## The log pane

`<leader>gf` puts the food log in the focused pane, in place of whatever it
held. The pane opens on today, and the keys below move it from day to day. The
toolbar's `log` button does the same.

| Key | Does |
| --- | --- |
| `j` | Move to the next entry |
| `k` | Move to the previous entry |
| `h` | Show the day before |
| `l` | Show the day after |
| `t` | Show today |
| `e` | Edit the entry under the cursor |
| `Enter` | Edit the entry under the cursor |
| `d` | Delete the entry under the cursor |
| `u` | Put back the entry last deleted |
| `o` | Open the note at the entry's line |
| `a` | Focus the amount field to log |
| `f` | Open the food search in the sheet; `Escape` closes it and gives the pane the keys back |
| `7` | Show trends over 7 days |
| `3` | Show trends over 30 days |
| `9` | Show trends over 90 days |
| `?` | Show the keys |
| `q` | Close the pane |
| `Escape` | Leave the edit without writing |

## The finance pane

`<leader>gk` puts the finance pane in the focused pane, in place of whatever it
held. For now it shows the bookings still to sort, oldest first.
[Sort finance transactions](/how-to/sort-finance-transactions.md) walks
through it.

Each category takes a key, in the order the categories are listed by name:
`1` to `9` and `0`, then `b` to `z` without `j`, `k` and `q`. The key shows on
the category's button. A category past the last key is reached by its button.

| Key | Does |
| --- | --- |
| `j` | Move to the next booking |
| `k` | Move to the previous booking |
| `1` | Sort the booking into the first category; each button shows its key |
| `a` | The next category key sorts the booking's payee, always |
| `?` | Show the keys |
| `q` | Close the pane |
| `Escape` | Stop the always, or go back to the editor |

## The overview

`<leader>ga` puts the overview in the focused pane, in place of whatever it
held; so does the `Overview` button on the home screen.
[Read the overview](/how-to/read-the-overview.md) says what each card counts.

| Key | Does |
| --- | --- |
| `h`, `ArrowLeft` | Move to the card on the left |
| `l`, `ArrowRight` | Move to the card on the right |
| `k`, `ArrowUp` | Move to the card above |
| `j`, `ArrowDown` | Move to the card below |
| `Enter` | Open the pane behind the card |

## Vim on or off

Where the primary pointer is a finger, the editor starts without vim. Where it
is a mouse, the editor starts with vim.
[kasten on a phone](/explanation/kasten-on-a-phone.md#vim-is-off-under-a-finger)
says why.

`Toggle vim keys` in [the command palette](/reference/editor-keys/leader.md#the-command-palette) changes that by
hand. The browser stores the choice in `localStorage` under `kasten.vim`, as
`on` or `off`, and from then on the choice wins over the pointer. Every open
pane follows at once, and the text, the cursor and the undo history stay. Every
other tab holding kasten follows at the same moment, not at its next keystroke.
A browser that blocks site data cannot store the choice: the editor then goes
by the pointer, and a toggle holds until the page is closed.

The panes, splits and tabs this browser has open sit beside it, under
`kasten.workspace.1` for a mouse and `kasten.workspace.coarse.1` for a finger,
and each note's cursor and scroll under `kasten.positions.1`.
[The workspace](/explanation/the-workspace.md) says why.

Without vim the editor is a plain one. Every line can be typed into, live
preview shows the source of the line the cursor is on and of the mark the
cursor is in, and the line numbers count from the top.

Every key in the pages below that vim resolves stops working: the leader, `gf`,
Enter on a link, the ex prompt and the yank to the clipboard. Ctrl+S, Tab,
Ctrl+click, the `/` menu, the completions and the four
[formatting](/reference/editor-keys/editing.md#formatting) chords stay, the chords working wherever the cursor
is, there being no mode to ask about. The palette runs the rest by name:

| Lost key | Palette row |
| --- | --- |
| `<leader>` and a letter | the row with the same label |
| `<leader>1` to `<leader>0` | `Go to tab 1` to `Go to tab 10` |
| `:w` | `Write the note` |
| `:e` | `Read the note off the vault again` |
| `:e!` | `Read the note off the vault again, throwing away unsaved text` |
| `gf`, Enter | `Open what the wikilink or highlight under the cursor names` |
| `:copy md`, `:copy slack`, `:copy teams` | `Copy as markdown`, `Copy for Slack`, `Copy for Teams` |

The three copy rows take the selection, or the whole note where nothing is
selected. `:copy` with a line range typed by hand has no row.

Ctrl+Shift+P opens the palette from a note with or without vim. The key is Ctrl
on a Mac too, as it is in [a terminal](/reference/editor-keys/terminal.md#terminal). Firefox on Windows and Linux
keeps that chord for a private window and does not hand it to the page, so it
opens nothing there. Without vim, and on a device with no keyboard, the other
ways in are the `run` button of [the toolbar](/reference/editor-keys/touch.md#the-toolbar), and typing `/` at
the start of a line or after a space and choosing `Run a command by name`.
