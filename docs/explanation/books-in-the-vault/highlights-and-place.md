---
type: Explanation
title: Highlights and place in a file beside a note
description: Why the reader keeps your place in the note's own frontmatter, why a quote is the anchor for a highlight, how a highlight is drawn again, and what the reader does to the URL.
tags: [design, vault, reader, epub, pdf]
status: stable
---

# Highlights and place in a file beside a note

## How it keeps your place

Close a book mid-chapter and opening it again puts you back on the page you
left. The record is one line in the note's own frontmatter:

```markdown
reading: epubcfi(/6/14!/4/2/2/1:0)
```

A pdf has no cfi of its own, so foliate writes a fake one naming the page,
`epubcfi(/6/6)` for the third, and reads it back the same way. One field for
both, and nothing outside the reader looks at either.

That field is the whole of it. Delete the line and you lose a bookmark, which is
what a bookmark is worth; nothing on disk or in Postgres knows where you were.
The client writes it, the way it writes `resource` on a clipped page, and it is
yours from that moment.

The write waits a minute after the last page turn, and it is skipped while the
note is in the pane you are typing into. That buys three costs worth knowing.

**Turning pages eventually writes the note.** A `PUT` stamps `modified` and
records a jj change, so the history says you edited a note when you only read
one. One change per minute of reading rather than one per page, which is the
whole reason for the wait. Writing the field without the stamp means a new
endpoint, and it is the fix if the noise ever annoys.

**Closing the browser tab loses up to a minute of position.** The write waits
for quiet and the tab does not. `beforeunload` cannot wait for a `PUT`, and
`sendBeacon` cannot read a note and then write it, so the honest answer is the
minute. Closing the reader with `q` writes at once, which covers every way of
putting a book down except closing the window on it.

**A save from an editor that loaded the note before the bookmark landed drops
the bookmark.** Every field in the block comes from the text the client sends,
so a buffer holding the note from before carries no `reading:` and the save
takes it out. The cache is moved to the note the vault answered with, so a clean
editor holds the bookmark within a render; a buffer with unsaved text in it is
the case that cannot be reached, and the next page turn writes the line again.

## Why a quote is the anchor

A passage you take out of the book lands in the note as the words themselves,
and the words are the whole record of where it came from. There is no epubcfi
beside them, no prefix and suffix, and no hash of the file.
[Highlight format](/reference/highlight-format.md) states the block.

The obvious design stores a cfi and looks the passage up by it, and it fails the
same way a stored book path fails: it is a fact somebody wrote down, and nothing
keeps it true. A cfi is a path through one file's markup, so it says nothing you
can read, `rg` cannot find it, and a hand edit to the note breaks it silently.
Replace the epub with another edition and every cfi in the vault points into a
file that is not there any more.

A quote has none of that. It survives you editing the note by hand, because
editing it is editing the thing itself. A person reads it. `rg` finds it. It
still means something in a note somebody opens in another editor ten years from
now with no reader at all.

The cost is real and it is accepted: the same sentence twice in a book resolves
to the first one. That is the price of a record made of words, and the fix
everybody reaches for, a second selector beside the quote, buys back a case
nobody has hit while giving up everything above.

The `reading:` line in the frontmatter is a cfi, and that is not a contradiction.
It is kasten's own bookmark rather than a citation: one line per note, written by
the client, read by the client, and worth nothing to anybody reading the note.
Losing it costs a page. Losing a passage costs the passage.

## How a highlight is drawn again

Open a file and the passages you took are drawn on the page, in the app's
mark colour. Nothing was stored to make that work: the pane reads the note's
blocks, searches what is on screen for each quote's words, and draws what
it finds. The words are the anchor here as everywhere else, so a highlight you
edited by hand is still found and a highlight you deleted stops being drawn the
moment the note is saved.

Only what is on screen is drawn on, which is not a choice anybody made: foliate
hands out one section at a time, or the two pages of a spread, and there is
nothing else to draw on. The pass runs when a section arrives and when the note
changes, and neither covers the other.

Searching sounds expensive and is not, because the pass builds one collapsed
string per chapter and calls `indexOf` for every quote against it. Measured in
Chromium against a real 26 section book, with two hundred highlights all
planted in its biggest chapter: 3.0ms to find all two hundred in one walk, and
7.8ms to draw them, so a page turn into the worst chapter anybody has costs
about 11ms. The library's own search does the same job by sliding a grapheme
window and asking a collator at every position, which costs 15.9 seconds for
the same two hundred quotes over the same chapter. That is the measurement that
removes the last argument for storing a cfi.

Two costs come with a record made of words, and both are accepted rather than
fixed. The same sentence twice in a chapter resolves to the first one. A phrase
the book repeats in another chapter is drawn there too, as a highlight you
never took. The fix for either is a second selector beside the quote, which is
the thing this design refuses, so they are written down here instead.

If drawing ever does get slow the answer is to draw less of the book. It
already draws one section, so that means fewer quotes rather than fewer pages.

`gf` on a highlight block goes the other way: it walks the book's sections in
order, builds each one's document, and takes the reader to the first section
holding the quote. Measured on the same book, 76ms to walk all 26 sections and
find nothing. A cfi is built there too, from the range the walk just found, and
thrown away with the jump: it is how foliate is told where to go, not something
the note keeps.

## What the reader does to the URL

`?note=` names the note in the **focused** pane, and opening a book leaves the
focus on the reader, which holds no note. So `<leader>gr` empties `?note=`, and
a reload from there comes back to one empty pane rather than to what you were
reading. A focused terminal already does exactly this. Closing the reader with
`q` puts the note back in the URL as soon as the focus lands on it again.
