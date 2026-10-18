---
type: How-to Guide
title: Use kasten on a phone
description: Open the file tree, find a note, run a command, turn vim on, move between panes, tick a todo, settle a note that changed on disk, type in a terminal and close a panel, all by touch.
tags: [phone, touch, toolbar, vim, todo, terminal]
status: stable
---

# Use kasten on a phone

You have kasten open in a phone's browser, or installed from
[Install kasten on your phone](/how-to/install-on-your-phone.md), and you want
to do by touch what the keys do at a desk. A row of buttons runs along the
bottom edge: `files`, `find`, `search`, `run`, `today`, `todos` and `chat`. Every
recipe below starts there.

[Editor keys](/reference/editor-keys.md#what-counts-as-a-phone) says which
devices draw the row. Where there is none, use `Ctrl+Shift+P` on a keyboard, or
type `/` at the start of a line, where a recipe says `run`.

## Open a note from the file tree

1. Tap `files`. The tree slides in over the page.
2. Tap a folder to unfold it.
3. Tap a note. The note opens and the tree closes.

To close the tree without opening anything, tap the page beside it.

## Find a note, or a line in one

1. Tap `find` for a note by name, or `search` for a line of text.
2. Type a few letters.
3. Tap a row.

The note opens. Tap its text to start typing.

## Run a command

1. Tap `run`.
2. Type a few letters of the command's name.
3. Tap the row.

To get the rows that write into a note (headings, lists, the formatting marks,
the todo states), tap into the note first, then tap `run`. The keyboard stays
up.

Commands worth knowing by name:

| To | Type |
| --- | --- |
| Make a note | `Create a note` |
| Rename or move the open note | `Rename the note` |
| Delete the open note | `Delete the note` |
| Split the window | `Split the pane left and right` |
| Close what is on screen | `Close the note, then the pane, then the tab` |
| See every key and command | `Show the keys` |

## Turn vim on

1. Tap `run`.
2. Type `vim`.
3. Tap `Toggle vim keys`.

Every open note follows at once. The browser keeps the choice, so do this one
time per browser. The same row turns vim off again.

## Move between the panes of a split

A phone draws one pane of a split at a time. The status bar says which, as
`pane 1/2`.

1. Tap `pane`. The next pane takes the screen.
2. Tap `pane` again to go on, round to the first.

The `pane` button shows only while the tab holds more than one pane.

## Tick a todo

1. Tap `todos`.
2. Tap the symbol in front of the todo. The symbol changes to the state the
   todo would move to, with a `?`.
3. Tap the symbol again within four seconds.

To set a state directly, tap `⋯` at the end of the row, then `open`, `doing`,
`review`, `done`, `blocked`, `waiting` or `rejected`. That takes one tap.

To say a todo waits for another one, tap `⋯` at the end of its row, then
`blocked by`, then the row of the todo that blocks it. `cancel` above the list
takes it back.

To add a todo, tap `+` in the header.

To tick a todo in the note you are writing, tap into its line, tap `run`, and
choose `Cycle the todo on this line`.

## Settle a note that changed on disk

The status bar says `Changed on disk` when something else wrote the note while
it held text you had not saved. Nothing is written until you choose.

1. Read what differs, which opens above the bar by itself: a `-` line is only
   in the vault's text, a `+` line only in yours. If you closed it, tap
   `Changed on disk` to open it again.
2. Tap `Write my text` to write your text over the vault's, or
   `Take the vault's` to throw your text away.

To keep parts of both, edit your text into the version you want, then tap
`Changed on disk` and `Write my text`.

`Changed on disk: <note>` means you left a note while it stood conflicted.
kasten wrote nothing and keeps your text on this phone. Open the note: the
conflict is back, with what differs.

`Could not save` opens the same way and offers `Write my text` and
`Drop my text`.

`Not saved: <note>` means the write of a note you left failed. kasten keeps
its text, on this phone, until it is written or dropped. Tap the label to see
which notes, then open the note: your text is back on screen under
`Could not save`.

## Type in a terminal

1. Tap `run` and choose `Open a terminal`.
2. Type a session name, or tap one from the list.
3. Tap the terminal, then type.

A row of keys sits under the terminal: `Esc`, `Tab`, `Ctrl`, the four arrows,
`|`, `/` and `-`.

To send `Ctrl+C`, tap `Ctrl`, then type `c`. `Ctrl` holds for one key. Tap it
again to let go without sending anything.

## Close a panel

Tap the dimmed page outside it. That closes the palette, the finder, the
search, the keys panel and a prompt you have not typed into.

A prompt you have typed into stays open on a tap outside. Send it with the
keyboard's Enter, or clear the input and then tap outside.

## Related

* [Editor keys](/reference/editor-keys.md#touch): every button, the command it calls, and what is still keys only
* [kasten on a phone](/explanation/kasten-on-a-phone.md): why it works this way
* [Capture from your phone](/how-to/capture-from-your-phone.md): the capture page, for a thought on the go
* [Write a practice exam](/how-to/write-a-practice-exam.md#sit-it-by-touch): sit an exam by touch
