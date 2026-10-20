---
type: Reference
title: Editor keys, saving
description: The keys that write and reread a note, and what the editor does when the vault changes under it.
tags: [editor, keyboard, saving, conflicts, frontend]
status: stable
---

# Saving and reloading

## Saving

| Key | Does | Mode |
| --- | --- | --- |
| `:w` | Write the note | normal |
| Ctrl+S | Write the note | any |
| `:e` | Read the note off the vault again | normal |
| `:e!` | The same, throwing away unsaved text | normal |

`:w` and Ctrl+S are not new to this page. Writing also happens on its own,
about a second after you stop typing. With [vim off](/reference/editor-keys.md#vim-on-or-off) the
palette rows `Write the note` and `Read the note off the vault again` stand in
for `:w`, `:e` and `:e!` everywhere this section names them.

Something outside kasten writing the note is answered while it is open. A note
you are not typing into simply takes the new text, with the cursor where you
left it, once any save of yours still on its way has answered: until then the
screen keeps what you typed, and never shows an older save's text over a newer
one. A note holding unsaved edits keeps them, and the write alone marks
nothing. Every write kasten makes names the vault's text your buffer was typed
on, and the vault refuses one it has moved past, keeping the other writer's
text. So the next write, a second after you stop typing, is refused, and only
then does autosave stop and the status bar wear the warning sign, labelled
`Changed on disk`, and open above itself with what differs: a line only the
vault holds marked `-`, a line only your buffer holds marked `+`, runs of equal
lines folded to a count, and the `modified` stamp left out. Your text stays in
the buffer. If the editor had already taken the other writer's text in,
having nothing newer of yours to keep, your refused text is kept in this
browser's storage instead, and the bar lists the note until you settle it.

The two readings that want you write their name beside the sign rather than
leaving a 16px icon in the corner to be noticed, and hovering either one says
more: `Changed on disk` names both ways out, and a write that failed carries
what the vault answered, `PUT /api/files/index.md failed with 500`, under the
reminder that your text is still here and `:w` sends it again.

Two commands end that state, and they are the two answers to the one question
it asks, which writer wins. `:w` writes your buffer over the vault and keeps
what you typed. `:e!` throws your buffer away and takes what the vault holds.
Until one of them is pressed, nothing you typed reaches the vault and nothing
the other writer left reaches your screen. The one exception is a writer that
puts your buffer's own text in the vault: then nobody's text is lost, the
conflict clears by itself, the bar reads saved, and the next key you type is
written as usual.

Without a prompt to type them at, which is a phone, click or tap the save sign:
`Write my text` is `:w` and `Take the vault's` is `:e!`.

Text that has not reached the vault is not given up. Hiding the page, which is
a reload, a closed tab or a phone sending the app to the background, writes
what is waiting at once rather than after the pause, naming the vault's text it
was typed on like any other write, so it lands over nobody's. A note that reads
`Changed on disk` is not written then; its text is kept instead. Nor is it
written when you leave it for another note, click into another pane or leave
the editor for another screen: kasten keeps your text in this browser's storage
and writes nothing to the vault, so its history gains nothing either. The status
bar reads `Changed on disk: <note>` until you settle it, and opening the note
shows the conflict again, your text in the buffer and what differs from the
vault's newest text above the bar. If the vault has come to hold your text by
then, the conflict is gone and the note opens clean. Moving the note, or a
folder above it, in kasten carries the kept text to the new path, a write
still on its way as you move included, and keeps it beside any text already
kept there. A delete, or a move made outside
kasten, leaves it under the old one: the bar still lists it, and the note
offers it again when it is back at that path, by `<leader>du` or by creating
it there. If a write
fails as you leave a note, or leave the editor for another screen, kasten keeps
that note's text in this browser's storage, and the status bar reads
`Not saved: <note>` until it is written or dropped, whatever you save
elsewhere meanwhile. Opening the note puts the text back in the buffer under
`Could not save`: `:w` writes it, `:e!` drops it for the vault's. A `:e!`
while a save is on its way writes the vault's text back behind that save, so
what you threw away does not come back once the save lands. If something
else wrote the note since, it opens under `Changed on disk` instead. A note can
hold more than one kept text, say when a save fails again after you came back
to it: kasten keeps each one, opening the note puts back the oldest, and the
bar lists the rest until a later opening offers them. `:w` and `:e!` settle
only the text in the buffer. Opening it
writes nothing on its own. If the vault already holds that text, the write
having landed after the page went away, kasten drops it without asking: the
`id`, `created` and `type` lines the vault adds to a note that lacks them do
not count as a difference.

`:e` without the bang is vim's own reread and behaves the way vim's does. It
takes the note off the vault when nothing is waiting to be written, and
declines when something is, or while a save is still on its way, flashing the reading in the status bar the way
every refused key below does. The bang is what says throw it away. Either way the vault is read before anything is discarded, so a `:e!`
whose request fails leaves the buffer and the warning exactly where they were
rather than dropping your only copy on the strength of a read that never
landed.

While `Changed on disk` stands, every way from here to another note asks first
and takes the refusal. A row clicked or opened in the tree, a hit taken out of
the finder or search, a `[[link]]` followed with `gf` or Ctrl+click, the create
prompt on `<leader>cf` or the tree's `c`, and `<leader>q` closing the note all
leave the pane exactly where it is. So do `<leader>rf` and the tree's `r`, but
only when what they would move is the open note itself or a folder it sits
under: a rename anywhere else in the vault goes ahead, because a conflict in
this pane is no reason to refuse to move some other note. `<leader>go` opens
its panel anyway, on the older text, reading the links being no reason to
overwrite. A `gf` at a link to a note that is not there still makes the note;
it just leaves it unopened.

The keys that move the focus decline too, because the autosave follows the
focused pane and would leave this note unsettled on its way to the next: `<leader>o`,
`<leader>h`, `<leader>j`, `<leader>k`, `<leader>l`, the splits `<leader>%` and
`<leader>"`, `<leader>ct`, `<leader>th`, `<leader>tl`, `<leader>1` to
`<leader>0`, and a tab clicked in the strip. The reading in the status bar
flashes each time one of them is refused, so a key that did nothing reads as
refused rather than as broken. Every one of them works again the moment `:w` or
`:e!` settles the note.

One way past is left, and it takes a divided window and a mouse: clicking into
another pane moves the focus without asking. The note you were typing into is
not written: kasten keeps your text and lists the note as
`Changed on disk: <note>` until you open it and settle it. The browser has already moved the
focus by the time the app hears about it, so refusing would mean either pulling
it back, which fights the hand that moved it, or leaving a pane whose border
says focused while the cursor is somewhere else. Every key into that pane
refuses, so this is the one route that still overwrites, and `:w` or `:e!`
first is what avoids it.
