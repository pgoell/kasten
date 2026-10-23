---
type: Reference
title: Editor keys, the book pane
description: The book reader pane, its keys, its contents list and the highlights it takes into the note.
tags: [editor, keyboard, book, reader, frontend]
status: stable
---

# Books in the reader

## The book pane

`<leader>gr` opens the book that sits beside the open note and puts it in a new
pane to the right, with the note still on screen. The book is the note's path
with the suffix swapped, and the suffix is `.epub` or `.pdf`, so
`20 Literature/DDIA.md` is read beside `20 Literature/DDIA.epub` or
`20 Literature/DDIA.pdf` and nothing anywhere records that pair. Which of the
two is there is the vault's to answer, in
[GET /api/books/{path}](/reference/http-api/assets-and-books.md#get-apibookspath), and a note
that somehow has one of each beside it is read as the epub.
[The file beside a note](/explanation/books-in-the-vault.md) says why.

A note with nothing beside it draws a panel rather than an empty reader:
`Nothing to read beside 20 Literature/DDIA.md`, and under it `.epub or .pdf of
the same name goes here`. It names the note and both suffixes because there is
no one path to name: the pair is a convention, and which of the two you meant is
not something the reader can know. A file the reader cannot open draws the same
panel.

`<leader>gc` opens the book you are reading now, from any pane with a leader,
and with no note open. It reads `reading-now.md` in the config folder, `99 Misc/01 Config` unless
[`KASTEN_CONFIG_PATH`](/reference/configuration.md#the-vaults-folders) names
another, and follows the first `[[wikilink]]` in it to a book's note. The book
fills the focused pane in place of what it held, as the book finder's Enter
does, with unsaved text saved first, at the note's `reading:` place and without
the note. A `.pdf` beside the note counts, as for `<leader>gr`. You write that
file by hand, and kasten never creates it or sets the book. It is read afresh
on each press, after unsaved text in the focused pane is saved, so editing the
link changes the book the next press opens. A missing file, a file with no
link, a link that names no note, and a note with nothing beside it are
each refused in one sentence at the foot of the window, such as
`99 Misc/01 Config/reading-now.md is not there`, and the next press clears it.
With vim off, and on a phone, the palette row `Read the current book` runs it.

`<leader>cb` is how a book gets into the vault without a terminal. It opens the
browser's file picker, and the file you choose lands under its own name, with a
note of the same name beside it. An epub lands in `02 Books/` and a pdf in
`02 Documents/` under the inbox, `00 Inbox` unless
[`KASTEN_INBOX_PATH`](/reference/configuration.md#the-vaults-folders) names
another, the folders differing because the files do: an epub
is a book and nothing else, while a pdf is as often a paper, a report or a deck.
That note opens in the focused pane, which is the only thing on screen saying
the upload worked. `<leader>gr` then reads it.

The key needs no note open and never renames the file after one: the book
brings its own note, and the pair is yours to move somewhere permanent once you
know where it belongs. A folder move carries both halves at once.

A refusal, a book of that name already there above all, puts one sentence at
the foot of the window, and the next press of the key clears it. A file whose
suffix is neither of the two is turned down there as well, before anything goes
out. There is no way back out from the app: nothing here deletes a book.

Opening a book again puts you back on the page you stopped at. The place is one
line in the note's own block, `reading:`, written a minute after the last page
turn and whenever you close the reader.
[How it keeps your place](/explanation/books-in-the-vault/highlights-and-place.md#how-it-keeps-your-place)
says what that line costs.

The keys below are the only ones the pane answers, apart from Space and `?`.
Space opens [the which-key panel](/reference/editor-keys/leader.md) at the foot of
the pane, so it does not turn the page, and the leader works here as it does in
the other panes. `?` opens key help.

| Key | Does |
| --- | --- |
| `h` | Turn back a page, or a screen of the text in a flowing epub |
| `l` | Turn forward a page, or a screen of the text in a flowing epub |
| `j` | Scroll the text down three lines, or turn the page of a pdf or a pre-paginated epub |
| `k` | Scroll the text up three lines, or turn the page back |
| `Escape` | Put the selection away and give the keys back to kasten |
| `t` | Open the contents |
| `y` | Take the selected passage into the note |
| `w` | Download the book as a file |
| `q` | Take the book out of the pane |
| `Ctrl+Shift+H` `J` `K` `L` `O` | Walk the panes, as in a terminal |
| `Ctrl+Shift+Q` | Take the book out of the pane |

An `h` or `l` pressed while the book is still opening turns the page once the
first page has landed, and so does a tap near the left or the right edge. Only
the last of these counts. Held down, either key turns a page about every tenth of
a second however fast the key repeats.

`w` hands the file that is actually there to the browser under its own name, so
`20 Literature/DDIA.epub` arrives in your downloads as `DDIA.epub` and
`20 Literature/Attention.pdf` as `Attention.pdf`. It is vim's own key for
writing what you are looking at out to a file, said bare here for the reason `q`
is.

The bare keys answer an unmodified press only, so `Ctrl+H` is left to the
browser's history window. The chords are the terminal's own, read from
`TERMINAL` and `TERMINAL_CHORD` in `frontend/src/lib/key-bindings.ts`, so
retuning one retunes both panes.

They work after a click into a paragraph, which is worth stating because it is
the case the pane is built around: the book renders inside an iframe, an event
does not cross a document boundary, and a handler on the pane alone would stop
answering the moment you clicked the text. The pane puts the same handler on
every chapter document the renderer reports.

`t` draws the book's contents over the page, and only over the pane, so the
note beside it stays on screen. While the list is open `j` and `k` walk the
chapters, Enter opens the one under the cursor, and Escape puts the list away
with the book still on the page you were on. With the list closed `j` and `k`
scroll the text. The cursor opens on the chapter you are in, so walking back to
chapter one is `k` held down rather than a hunt. The list is the publisher's
own, so a nested chapter is drawn indented, and a part heading the book gave no
link to is a row Enter does nothing on. A pdf's list is its own outline, walked
and nested the same way. A book whose publisher wrote no contents, or a pdf
whose author wrote none, says so instead of drawing an empty box. A click or a
tap on the dimmed page around the list puts it away as Escape does.

On a touch screen a swipe turns the page of a flowing epub, and a tap in the
left or the right quarter of any page turns it the way a swipe from that side
would, back and forward in a left-to-right book and the reverse in a
right-to-left one, which is the one way to turn a pdf's or a fixed-layout
epub's page by finger. A tap on a
link, or one made while a passage is selected, turns nothing. The foot of the
pane carries a `Contents` button for `t` and, while a passage is selected, a
`Take` button for `y`.

Selecting a passage draws a button over it, and clicking that button and
pressing `y` are the same thing: the passage lands under `## Highlights` in the
note beside the book, as a blockquote, a blank line, then the chapter it was
selected in and an anchor. A selection holding a figure takes the picture too:
the file goes into the vault's images folder and an `![](path)` line above the
quote points at it, so a drag over a plate and its caption keeps both. A drag
over the plate alone is a figure with no quote under it. The selection is the whole of what a highlight is
found by later, so there is nothing else in the note to keep in step and
deleting a highlight is deleting the lines.
[Highlight format](/reference/highlight-format.md) states the block. A pre-paginated epub
gets neither the button nor the key: a spread shows two pages at once, and
foliate scales both of its frames with a CSS transform, so no rectangle taken
out of one says where the words are on screen. A pdf goes through that same
renderer and refuses nothing, being scaled inside its own document instead, so a
rectangle in the frame is a rectangle on the page.

A passage taken out of a pdf lands in the note one line per line of the pdf. The
quote is cut where the selection breaks, and a pdf breaks its lines where the
page does, so a paragraph running six lines across the page is six lines in the
note. An epub gives one line per paragraph. Nothing rejoins either, the words
being what the highlight is found by later and both being read back the same
way.

Where an epub names the chapter, a pdf names the outline entry the page sits
under, and `Page N` where the pdf carries no outline at all.

Opening a book draws the note's highlights on the page, in the app's mark
colour at the strength the token gives it, for every passage the chapter on
screen holds. Paging into another
chapter draws its own as it arrives. Delete a highlight in the editor and save,
and it stops being drawn without you touching the reader; edit a quote's
wording so the book no longer holds it, and nothing is drawn for it and nothing
complains. A pdf page is drawn on too, though foliate hands out no overlay for
one: the pane hangs its own inside the text layer pdf.js drew. A pre-paginated
epub gets nothing, there being no such layer to hang one in.

The write goes out whether or not the note is the pane you are typing in. It is
a press, so you asked for it, and a buffer with unsaved text in it says
`Changed on disk` once its next write is refused, and settles with `:w` or
`:e!`, which is what ticking a todo
in the pane already does.

The text is set in the app's own serif, Newsreader, at 19 px with 1.6 leading,
in the app's ink on the app's ground, in both themes and every palette. Code
keeps the app's mono, and a selection takes the highlight colour. These win
over the book's own colours and fonts, so a book written for a white page reads
on the dark one. A switch of theme or palette restyles the text where you
are and keeps your place. A flowing epub reads in one column at the reading
measure, 680 px, so a wide pane keeps the rest empty.

The line at the bottom of the pane says how far through the whole book you are,
to the nearest percent. It counts every chapter rather than the one you are in,
and it says nothing at all where the book gives no honest number to count.

A click inside the book also tells the route that this pane has the focus.
Nothing else would: a paragraph cannot hold focus, so a click in there fires no
focus event on any ancestor, and without the report `q` would close some other
pane's note.

A book pane is not in the URL. `?note=` names the note in the focused pane, and
a reader holds none, so opening one empties `?note=` and a reload comes back to
an empty pane. Closing the reader puts the note back in the URL as soon as the
focus reaches it.

Moving the folder that holds the pair carries the reader with it. Renaming the
note alone does not, because the file stays where it was, and the reader then
says its note is gone.
