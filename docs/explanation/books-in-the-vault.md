---
type: Explanation
title: Books in the vault
description: Why a book is the note's path with the suffix swapped, and why the vault's history never takes a copy of one.
tags: [design, vault, reader, epub, jj]
status: stable
---

# Books in the vault

You can read a book and you can write a note about it. Doing both in one window
is what the reader is for: `<leader>gr` opens the book beside the note, and `h`
and `l` turn the page.

The whole arrangement rests on one rule, and the rest falls out of it.

> A book is its note's path with the suffix swapped.
> `20 Literature/DDIA.md` is read beside `20 Literature/DDIA.epub`.

## Why nothing stores the path

The obvious design puts the book's path in the note's frontmatter, `book:
20 Literature/DDIA.epub`, and looks it up. kasten does not, and the reason is
the vault rule: a field in a file has to be kept in step with the disk, and
nothing keeps it there.

Move the folder holding the pair and a stored path is wrong until somebody
edits it. Rename the note and it is wrong the other way. The convention has no
such problem, because it is not a fact anybody wrote down: swap the suffix and
ask the vault. Two files with the same stem in the same folder are a pair for
as long as they sit there, and they stop being one the moment they do not.

It costs one thing, and the reader says so out loud rather than hiding it. A
rename of the note alone leaves the epub behind, and the reader then draws
`No book at 20 Literature/DDIA.epub` instead of reading on as though nothing
had happened. Moving the folder carries both, which is what a folder move is
for.

## Why the tree, the finder and search never mention it

Nothing in kasten lists an epub, and that is not a filter anybody added. Every
reader of the vault already asks for `.md`: the listing skips anything else,
the finder ranks what the listing gave it, and search runs rg over notes. The
book is served by one endpoint, `GET /api/assets/{path}`, and reached by one
key, and no other part of the app knows it is there.

So the vault reads as a directory of notes, which is what it is. The books sit
beside them the way a scanned receipt sits in a folder of letters.

## Why jj never takes a copy

jj tracks any untracked file under a megabyte, and every note save runs a
snapshot. Without a word from us, the first save after you drop a 30MB book in
the vault would write that book into the history, and it would stay there.

So the backend writes `vault/.gitignore` at startup, holding two lines:

```
*.epub
.*.tmp
```

The first keeps books out. The second keeps out the temp file a write lands in
before it is renamed over the note, which matters more than it looks: a save
during a long upload would otherwise snapshot half a book.

Three things worth knowing about that file:

**Ignoring is not untracking.** A book already in the history stays in it.
`jj file untrack '*.epub'` inside the vault is the way out, and the history
still holds the copies it took before then.

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

## What the reader does to the URL

`?note=` names the note in the **focused** pane, and opening a book leaves the
focus on the reader, which holds no note. So `<leader>gr` empties `?note=`, and
a reload from there comes back to one empty pane rather than to what you were
reading. A focused terminal already does exactly this. Closing the reader with
`q` puts the note back in the URL as soon as the focus lands on it again.

## What happens when a book changes behind the app

The bytes are read once, when the pane opens. Replace the file in the vault and
the open reader goes on showing the old text until you close it and press
`<leader>gr` again. The event stream reports notes, and a book is not one.

## Why a book's own HTML cannot run code

An epub is a zip of HTML, and foliate renders each chapter from a same-origin
`blob:` URL, because selection and navigation need same origin. A `<script>` in
a chapter would therefore run as kasten.

The defence is the Content Security Policy the app serves itself. A document
loaded from a blob URL inherits the policy of the page that made the URL, so
kasten's policy governs the book's markup, and `script-src 'self'` refuses all
three ways a chapter can carry a script: inline has no nonce, a `src` naming a
file inside the archive is rewritten to a blob URL, and a `src` naming
somewhere else is left as written.

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
