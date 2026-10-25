---
type: Reference
title: Editor keys, RSVP
description: The RSVP reader that shows a note, a page, a pdf or a book one word at a time, its keys, its settings and the place it keeps.
resource: frontend/src/components/rsvp.tsx
tags: [editor, keyboard, reader, rsvp, frontend]
status: stable
---

# Reading word by word

## The RSVP reader

`<leader>rr` reads what the focused pane holds one word, or a few words, at a
time, in one spot over the pane, so the eye does not move along the line. This
is RSVP, rapid serial visual presentation. It reads four kinds of pane:

| Pane | Where the words come from |
| --- | --- |
| A note | The note's markdown as the buffer holds it, so text typed and not yet saved is read too. The front matter, the markup, code blocks, formulas, images and bare addresses are left out. A wikilink reads as its alias, or as its target where it has none. |
| A page (HTML) | The page's own text as the browser lays it out, which the page script hands over. Text the page hides is left out. |
| A pdf | Each page's text, parsed and not drawn. A word broken by a hyphen at a line end is joined again. |
| A book | Every section of an epub, and every page of a pdf opened as a book. |

Any other pane says at the foot of the window that there is nothing to read.

The reader opens paused, on the place the last run in that file stopped at.
Space plays. One letter of each chunk is drawn in the accent colour and stays
in the same column, marked by a tick above and below, while the words change
around it. For one word it sits near the start, a little left of the middle;
for two or three it is the letter nearest the middle of the whole chunk, so the
chunk sits centred on it.

`<leader>rh` opens it from here instead: from the selection when there is one,
else from the cursor in a note, the page at the top of a pdf, or the page on
screen in a book. In a page (HTML) it starts at the selection, and with none
it resumes like `<leader>rr`. Where it starts becomes the saved place.

## Keys

| Key | Does |
| --- | --- |
| `Space` | Play, or pause |
| `h` | Back to the start of the sentence, or to the sentence before when already there |
| `l` | Forward to the next sentence |
| `H` | Back to the start of the paragraph, or to the paragraph before |
| `L` | Forward to the next paragraph |
| `j` | Slower, by 25 words a minute |
| `k` | Faster, by 25 words a minute |
| `r` | In a book: move the book to the word on screen and write it as the note's `reading:` |
| `R` | In a book: move to the word the note's `reading:` points at |
| `Escape` | Close the reader |

The key help (`?`) lists these under `Reading word by word`. While the reader
is open every key goes to it, so no leader key and no key of
the pane under it works. A click on the dark around the panel closes it too.

The bar under the words shows how far through the text you are. A click on it
jumps there, and a drag moves through the text as you go.

A sentence ends at a full stop, a question mark or an exclamation mark, closing
quotes and brackets after it included, but not at `Mr.`, `Dr.`, `e.g.`, `z.B.`
and a few other short forms. A paragraph ends at a blank line in a note, at the
end of a block in a page or a book, and at the end of each page of a pdf, which
says nothing of its own paragraphs.

## Settings

The row of buttons under the bar sets four things. They are kept in the
browser's `localStorage` under `kasten.rsvp`, so each device keeps its own.

| Setting | Default | Range | Does |
| --- | --- | --- | --- |
| wpm | 300 | 100 to 1000, in 25s | Words a minute |
| words | 1 | 1 to 3 | Words shown at once. A chunk never runs past the end of a sentence |
| size | 40 | 20 to 96, in 4s | The size of the words, in px |
| pause | 1 | 0 to 3, in halves | Extra time after a sentence, in words: half of it after a comma, a semicolon, a colon or a dash, twice it at the end of a paragraph |

The top line counts the word you are on, the words in all, and the minutes
left at this speed, the pauses not counted.

## The place

Each file keeps one place, in the database and not in the file, so it follows
you to another device and a pause writes nothing to the vault. A note's place is
kept under the note's path, a page's and a pdf's under their own, and a book's
under the epub or pdf, not under its note.
[HTTP API: RSVP](/reference/http-api/rsvp.md) describes the two routes.

The place is saved when you pause, when you let go of the bar, when you start
from here, and when the reader closes, whether by Escape or because the pane
went. A run that reaches the end pauses on the last words and saves there.

It holds the word's number, the number of words the text had, and the word
with the four after it. When the text has changed since, the reader looks for
those five words and takes the match nearest the saved number, so an edit above
the place moves it by no more than the edit did. Where the five words are gone
it starts at the top.

A book also has its `reading:` place, the one the reader opens at, which RSVP
leaves alone except by `r` and `R`. `r` moves the book to the word on screen and
writes the note's `reading:` at once, rather than a minute later as a page turn
does. `R` reads `reading:` off the note as the vault holds it and moves the
reader there, which then becomes the RSVP place.
