---
type: Explanation
title: The file beside a note
description: Why the thing you read is the note's path with the suffix swapped, why the suffix is one of two, and why the vault's history never takes a copy of either.
tags: [design, vault, reader, epub, pdf, jj]
status: stable
---

# The file beside a note

You can read something and you can write a note about it. Doing both in one
window is what the reader is for: `<leader>gr` opens the file beside the note,
and `h` and `l` turn the page.

The whole arrangement rests on one rule, and the rest falls out of it.

> What you read is its note's path with the suffix swapped.
> `20 Literature/DDIA.md` is read beside `20 Literature/DDIA.epub`.

There are two suffixes. `.epub` is a book, and `.pdf` is as often a paper, a
report or a deck, which is why the two are filed apart and typed apart and why
this page says "the file" where it used to say "the book". Everything else here
is true of both, and where it is not the page says so.

## Why nothing stores the path

The obvious design puts the file's path in the note's frontmatter, `book:
20 Literature/DDIA.epub`, and looks it up. kasten does not, and the reason is
the vault rule: a field in a file has to be kept in step with the disk, and
nothing keeps it there.

Move the folder holding the pair and a stored path is wrong until somebody
edits it. Rename the note and it is wrong the other way. The convention has no
such problem, because it is not a fact anybody wrote down: swap the suffix and
ask the vault. Two files with the same stem in the same folder are a pair for
as long as they sit there, and they stop being one the moment they do not.

Two suffixes make that argument stronger rather than weaker, and they move one
thing. The client cannot swap the suffix itself any more, because it would have
to guess which of the two to try first and spend a `404` finding out. So the
question goes to the vault whole: `GET /api/books/20 Literature/DDIA.md` hands
back whichever file is there and a header naming which one it was.
`.epub` wins where a note somehow has both beside it, being the one that
reflows. [The HTTP API](/reference/http-api.md) states the route.

So the vault is what keeps the pair together, and both of its move operations
do. A folder move renames the directory, which carries everything inside it.
A note's move carries the file beside it, one rename after the other, so
filing `00 Inbox/02 Books/DDIA.md` away under `20 Literature/` takes the epub
with it and the reader follows. A note with one of each beside it carries both,
each weighed on its own.

There is one case where the file stays put: the note's new home already has a
file of that name. The note moves anyway and the pair is broken, which the
reader says out loud, drawing `Nothing to read beside 20 Literature/DDIA.md`
rather than reading on as though nothing had happened. It names the note and not
a path it wanted, because with two suffixes there is no one path it wanted.

The alternative was refusing the whole move, which leaves you with a note you
cannot move at all, and overwriting is the one thing nothing here does to a
file: there is no delete and no history to get one back from.

## Why the tree, the finder and search never mention it

Nothing in kasten lists an epub or a pdf, and that is not a filter anybody
added. Every reader of the vault already asks for `.md`: the listing skips
anything else, the finder ranks what the listing gave it, and search runs rg
over notes. What you read is served by two endpoints and reached by one key, and
no other part of the app knows it is there.

The one place that had to be told is the image listing, which the editor
completes a `![](` against. It walks every asset suffix the vault takes and
subtracts the ones the reader opens, so adding a format to the table takes it
out of that list in the same line. Without that a paper would be offered as a
picture to paste into a note.

So the vault reads as a directory of notes, which is what it is. The files sit
beside them the way a scanned receipt sits in a folder of letters.

## The two doors a file comes in by

`<leader>cb` picks a file, puts it in the inbox under its own name, writes the
note of the same name beside it and opens that note. That is the door the app
owns, and it is the one that works from the keyboard with no terminal open.

The suffix picks the folder, and this is the one place the two formats part
company:

| Picked | Filed in | Typed |
| --- | --- | --- |
| `.epub` | `00 Inbox/02 Books/` | `Book` |
| `.pdf` | `00 Inbox/02 Documents/` | `Source` |

An epub is a book and nothing else. A pdf is as often a paper, a report or a
deck, and filing one under `02 Books` as a `type: Book` would be a word that is
not true, written by a machine into a vault somebody else reads.
`Source` is [the ontology](/reference/note-frontmatter.md)'s own name for
something written elsewhere, which covers all of them. Anything that is neither
suffix is refused with a sentence rather than filed: the name used to have
`.epub` appended whatever it arrived as, so picking `Ulysses.pdf` wrote
`Ulysses.pdf.epub` and the upload then refused it for bytes that disagreed with
a name nobody had chosen.

The first cut of that key did something else again: it uploaded to the sidecar
path of whatever note was in the focused pane, so the file took that note's
name. Picking `Talk Like TED.epub` while reading a note about something else
filed a book under the wrong title, beside a note that had nothing to do with
it, in an app with no delete. The name a file arrives with is the only name
anybody has for it, and an upload has no business spending it. So the file keeps
its name and brings its own note, and filing the pair is a separate decision you
make later, by moving a folder.

The other door is the shell pane, or anything else with the vault mounted: `cp`
a file into place and the reader finds it, because the pair is a convention
rather than a record. The endpoint behind `<leader>cb` is not a gate in front
of the vault, and nothing downstream may assume a file came through it. Its
check on the first bytes, `PK\x03\x04` for a zip and `%PDF-` for a pdf, is there
so a file renamed to the wrong suffix is caught while somebody is still looking
at the screen, not because a file that skipped it would be dangerous. The reader
does not rely on it either: foliate picks a format off the bytes rather than off
the name, so an epub called `.pdf` still opens as an epub.

**An upload cannot be undone from the app.** `DELETE /api/assets/{path}` refuses
both suffixes, and jj holds no copy to go back to, so a file put at a
sidecar path stays there until somebody removes it from a terminal. The refusal
is not squeamishness: the file travels with the note beside it, and which of the
pair a delete should take is a decision nobody has made. An image, which belongs
to no note, goes into the trash on a keypress. That is why the upload refuses
a path already holding a file rather than replacing it: an overwrite would be
gone for good. The refusal is the filesystem's, not a check racing the
transfer. The bytes land in a hidden temp file beside the target and are hard
linked into place, and the link either creates the path or fails.

The same asymmetry runs through the rest of this page. The app reads a file,
writes one, and does nothing else to it. Moving, renaming and deleting are the
shell's, which is where the vault is a directory rather than a notebook.

## Why jj never takes a copy

jj tracks any untracked file under a megabyte, and every note save runs a
snapshot. Without a word from us, the first save after you drop a 30MB book in
the vault would write that book into the history, and it would stay there. A
paper is often well under that megabyte, so for a pdf this is not the rare case
it is for a book: it is most of them.

So the backend writes `vault/.gitignore` at startup, holding three lines:

```
*.epub
*.pdf
.*.tmp
```

The first two keep what you read out. The last keeps out the temp file a write
lands in before it is renamed over the note, which matters more than it looks: a
save during a long upload would otherwise snapshot half a file.

Three things worth knowing about that file:

**Ignoring is not untracking.** A file already in the history stays in it.
`jj file untrack '*.epub' '*.pdf'` inside the vault is the way out, and the
history still holds the copies it took before then.

**It is written whether or not the vault is a repo.** A `.gitignore` in a
directory nobody has run `jj git init` in costs one hidden file and protects
the vault somebody initialises next week. The branch to avoid it, and the test
for that branch, cost more than the file.

**Neither line covers `.gitignore` itself**, so the next change jj records will
fold it in. That is one line in the history of some unrelated note, once. The
file is invisible to kasten, every path resolver here refusing a dot segment,
so writing it wakes no client and shows up nowhere in the app.

None of this hides a note from search. `search.py` runs rg with `--no-ignore`,
so the ignore file governs jj and nothing else.

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
accent colour. Nothing was stored to make that work: the pane reads the note's
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

## What a pdf costs

Everything above is true of a pdf, and none of it was free. foliate renders one
through a second renderer, the one it keeps for books whose pages are pictures,
and that renderer hands out a page and nothing else: no overlay to draw on, no
index saying which page you are looking at, and no way to build a page's
document without drawing it. Three of the four things the reader does had to be
built over the top of it.

**The overlay is hung by hand.** foliate's own `Overlayer` is a standalone
class, so the pane makes one per page and hangs it inside pdf.js's text layer,
which sits over the page and shares its coordinate space. It is scaled by the
inverse of the transform pdf.js puts on the page, because pdf.js lays a page out
at the screen's device pixel ratio and scales the whole document back down, so
on a retina screen one layout pixel is half a client pixel while the rectangles
a selection answers with are client pixels. That is the sort of thing that works
on the machine it was written on and nowhere else, so it is read off the
computed transform rather than assumed.

**A resized pane doubles the page's words, and the pane undoes it.** foliate
re-renders a page whenever its box changes, and pdf.js appends its text layer to
whatever the container already holds rather than replacing it. Measured in
Chromium: two spans become four and the page reads twice. Left alone, every
highlight would anchor to the copy the words had already left, `indexOf` taking
the first of the two. The pane throws away every generation but the newest,
using the marker foliate itself appends when a render finishes.

**`gf` reads the pages without drawing them.** A pdf's sections carry no
document to search, so the seek opens the same bytes a second time through
pdf.js and asks each page for its text content, which parses the page and draws
nothing. It is opened with the same character maps and fonts the page on screen
was, or a document whose fonts need them, which is most CJK, would answer with
text that is not what you can see. It costs a second reading of the whole file
where the epub arm costs a section at a time, and it is spent on a keypress
rather than on anything you are watching.

**Closing the pane frees the worker, which the library does not.** foliate's
`close` frees its renderer and stops, and nothing in it ever calls the book's
own `destroy`, which for a pdf is the document and the worker parsing it. An
epub cost nothing by that, holding a zip reader already closed. A pdf costs a
worker per file, so the pane frees the book itself on the way out, and it does
it in the same place it closes the renderer: a pane shut while the file is still
opening has no book to free at that moment and is handed one a second later,
which is the case a second call site would have missed.

One cost is not paid, and is written down here instead of fixed. A passage taken
out of a pdf lands in the note one line per line of the pdf, because that is
where a pdf breaks its lines and a pdf puts no space between one line and the
next. Joining them would read better and would stop the passage being found
again, the words on the page having no space there either. The words are the
anchor, so the words win.

## What the reader does to the URL

`?note=` names the note in the **focused** pane, and opening a book leaves the
focus on the reader, which holds no note. So `<leader>gr` empties `?note=`, and
a reload from there comes back to one empty pane rather than to what you were
reading. A focused terminal already does exactly this. Closing the reader with
`q` puts the note back in the URL as soon as the focus lands on it again.

## What happens when a file changes behind the app

The bytes are read once, when the pane opens. Replace the file in the vault and
the open reader goes on showing the old text until you close it and press
`<leader>gr` again. The event stream reports notes, and what you read is not one.

## Why a file's own markup cannot run code

An epub is a zip of HTML, and foliate renders each chapter from a same-origin
`blob:` URL, because selection and navigation need same origin. A `<script>` in
a chapter would therefore run as kasten. A pdf reaches the same page by a
different road: pdf.js draws the page to a canvas and writes a text layer over
it, into a document made from a blob URL the same way, so the policy below
governs both.

The defence is the Content Security Policy the app serves itself. A document
loaded from a blob URL inherits the policy of the page that made the URL, so
kasten's policy governs that markup, and `script-src 'self'` refuses all
three ways a chapter can carry a script: inline has no nonce, a `src` naming a
file inside the archive is rewritten to a blob URL, and a `src` naming
somewhere else is left as written.

A pdf carries javascript of its own, in form actions and in document level
scripts, and none of it runs: pdf.js only executes those when it is handed a
scripting manager, and foliate never builds one. The policy is not what stops
that one, and the page says so rather than claiming a defence it is not making.
The policy needed no widening for a pdf at all. Its worker is same origin, so
`default-src 'self'` covers it; the two stylesheets and the character maps are
plain same-origin fetches under `connect-src 'self'`; the page's own iframe is a
blob URL under `frame-src blob:`; and pdf.js is asked not to use `eval`, which
is what `'unsafe-eval'` would otherwise have had to permit.

Not the iframe sandbox, which would have been the belt to that policy's braces.
foliate creates both of its iframes itself, hard-codes
`sandbox="allow-same-origin allow-scripts"` on them and hides them behind closed
shadow roots, so nothing outside the library can reach one to change the
attribute. Taking it away means owning a fork of a library kasten pinned to a
SHA precisely so it would not have to read it. The sandbox was never the
defence in any case: a blocked script is blocked whether or not the frame could
have run one.

The directives live in one place, `frontend/src/lib/csp.ts`, because nginx and
the dev server both serve them and `nginx.conf` cannot import from TypeScript.
A test reads both copies and fails when they disagree. Development differs in
exactly one directive: Vite injects its react-refresh preamble as an inline
script, so dev serves `script-src 'self' 'nonce-<nonce>'` with a nonce minted
at each server start. Minted rather than written down, because a book can carry
a `nonce="…"` of its own and a guessable one is worse than none.

## Where pdf.js comes from

foliate vendors its own build of pdf.js, and the parts of it a page needs at
runtime, a web worker, two stylesheets, the character maps a CJK document wants
and the fourteen fonts a pdf may name without embedding, are files rather than
imports. foliate reaches them with a URL built out of `import.meta.url`, which
Vite rewrites into a glob over a pattern it then refuses, so out of the box the
dev server dies on the module and the build resolves every one of those URLs to
the string `undefined`. Nothing says so: the page just never draws.

So `vite.config.ts` replaces that one line with a fixed base, `/pdfjs/`, and
stages the five names into `public/` where the dev server serves a directory
untouched and the build already copies one. The copy is not laziness about a
`/@fs/` path straight at `node_modules`: everything served that way goes through
the transform pipeline, which turns a `.css` into a javascript module, and
foliate fetches those two stylesheets as text. An unstyled text layer lays every
span at the left edge, so the page still draws and every selection takes the
wrong words, which is the worst way for it to fail.

Production adds one line to `nginx.conf` for the same reason. nginx's own
`mime.types` has no row for `.mjs`, so the worker would go out as
`application/octet-stream` and Chrome refuses a module worker whose type is not
javascript. That failure is invisible in development, which is why it is written
down here.
