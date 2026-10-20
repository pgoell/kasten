---
type: Explanation
title: Files and storage beside a note
description: Why the path of a file is never stored, why the two doors a file comes in by put it in different folders, why jj never takes a copy, and why a file's own markup cannot run code.
tags: [design, vault, reader, epub, pdf, jj]
status: stable
---

# Files and storage beside a note

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
company. The paths are on the default layout;
[`KASTEN_INBOX_PATH`](/reference/configuration.md#the-vaults-folders) moves
`00 Inbox`.

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
