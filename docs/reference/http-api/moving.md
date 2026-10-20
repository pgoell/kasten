---
type: Reference
title: "HTTP API: moving"
description: Routes that give a note or a folder a new path, and preview what the move rewrites.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: moving

The routes that give a note or a folder a new path, and the preview that says what the move will rewrite.

## PATCH /api/files/{path}

Gives a note a new path. The URL says where it lives now, the body where it
should live from here on.

```json
{ "path": "reading/2026/borges.md" }
```

The reply is the note at its new path, in the shape `GET` returns.

```json
{ "path": "reading/2026/borges.md", "content": "# Borges\n" }
```

The book beside the note goes with it, `20 Literature/DDIA.epub` following
`20 Literature/DDIA.md`, because the pair is a convention rather than a record
and a note that moved alone would stop having a book. Both formats travel, and
each is weighed on its own: one stays where it is when the new path already
holds a book of that name, the note moving anyway, because nothing here
overwrites a book. The reply says nothing either way, the client asking
[the books route](/reference/http-api/assets-and-books.md#get-apibookspath) about the path it moved the note to.

One route, not two: renaming a note and moving it between folders are the same
thing, a change to the path. `PATCH` rather than `/rename` because the path is
the note's identity, so `POST` starts a note, `PUT` replaces its text, and this
changes where it lives.

`path` in the reply is the vault's spelling of the body's, the way `POST`
answers. The client navigates to it.

`content` is read off disk after the move rather than carried over from the
client. The move does not need the read; the answer does. Both the URL and the
client's cache key change here, and filling the new one from disk is what stops
a note edited outside kasten arriving stale on the other side.

The folders on the way to the new path are made, the way a create makes them,
each with [its listing](/reference/http-api/notes.md#post-apifilespath).

### What a move does to the links

Every `[[link]]` in the vault that named the note is rewritten to name it at its
new path. A link keeps the spelling it had: one that spelled the path out gets
the new path, and one that named the note gets the new name. So a move between
folders leaves `[[borges]]` alone, because a bare name follows the note on its
own, and a change of name rewrites it. The note being moved is read like any
other, which carries its links to itself along with it.

The books that travel with the note are moved files too, and a link to one
follows the same way: `[[inbox/borges.pdf]]` becomes `[[reading/borges.pdf]]`,
and on a rename a bare `[[borges.pdf]]` becomes `[[kafka.pdf]]`. A markdown
link to it follows as well, `[the book](inbox/borges.pdf)` becoming
`[the book](reading/borges.pdf)`. A book held
back because its landing is taken keeps its links, since it is still where they
point.

A link inside code is left as written, because there it is an example of the
syntax and not a link. Code is a fenced block as a CommonMark parser reads it,
so a fence inside a blockquote or a list item counts, and a fence nobody closed
runs to the end of the quote, the item or the note that holds it; and an inline span, a run of backticks closed by a run of the same
length on the same line. A backtick after a backslash or inside a `[[link]]`
opens no span. Where the text could be read either way it counts as text, so a
real link is never left behind. A block indented by four spaces is not read as
code. Markdown links in code are left alone the same
way.

The rule a target is read by is the editor's, so what a rename follows is what
`gf` opens: a target with a slash is a path, a bare name is looked for anywhere
in the vault, and the note at the vault root wins a tie. A link the vault
already answers with another note is therefore left alone. Where nothing answers
the two part: the editor puts the note it is about to make in the inbox, and a
rename leaves the name where it stands, there being no note to follow. The rule is written
out twice, in `backend/src/kasten_backend/links.py` and in
`frontend/src/lib/wikilink.ts`, which is what the editor resolving a link
without asking the server costs. `backend/tests/link_paths.json` holds the cases
both test suites read, so the two copies cannot drift apart unnoticed.

The rewrite runs before the note is moved, because a bare name only names the
note while the note is still where the links were written to find it, and inside
the same jj change, so the rewritten links are part of the move rather than an
edit that happened to follow it.

Which notes get read is rg's answer, not the whole vault. Every link to a note
carries the note's name, a bare `[[borges]]` being the name and a path
`[[reading/borges]]` ending in it, so the name is a query no link to it can
escape. rg names the notes holding it and only those are read and reparsed. It
matches far more than it rewrites, every mention in prose included, which costs
nothing: the parse decides.

Relative markdown links follow too, in every note and not only the one moving.
A plain `[text](href)` is read from the folder of the file holding it, so two
things break one: its target moving, and the file holding it moving to another
folder. Either one rewrites it. A link between two files that moved together is
left alone, which is what keeps a moved folder's own `index.md` working. An
embed, `![alt](href)`, is read from the vault root, the way the editor draws
it, so only its target moving rewrites it, and a move of the note holding it
leaves it as written.

A plain link that changes is written the short way from the folder of the file
holding it, an embed as its new vault path, both keeping a trailing slash and a leading `./` where it had them, and
keeping a `#fragment` or `?query`. `%`, a space, `(`, `)`, `#` and `?` are
escaped as `%25`, `%20`, `%28`, `%29`, `%23` and `%3F`, and nothing else, so
`plan #2.pdf` is not cut at its `#` and an accented name reads as
itself in the raw file. A link that still lands where it did keeps its
spelling. Skipped: an href with a scheme, `https:` or `mailto:`, one starting
with `/`, `#` or `{`, and one that climbs out of the vault.

The name narrows the read for these too. A markdown link to a note holds its
name, raw, with its spaces escaped, or escaped the way the editor's encodeURI
writes it, so `Über` as `%C3%9Cber`, and rg is asked for all three, ignoring
case, so `%c3%9c` is found as well. The note moving
is read whatever it holds, because its own links break by its moving.

At 10,000 notes a move costs 29ms, against 315ms for the walk over every note it
replaced. 9ms of that is the directory listing, which resolving a bare name
needs and which `GET /api/files` pays on every page load anyway. A folder's move
costs 45ms, the difference being the notes it carries and their links to each
other.

Unlike search, an rg that cannot read the whole vault is an error here rather
than an empty answer, and the move fails with nothing written. A search that
came up short shows fewer rows; a rewrite that comes up short leaves a link
pointing at nothing.

### What a move does to the indexes

When the note moves to another folder and the old folder's `index.md` has an
entry for it, the entry goes with it. An entry is a bullet line holding a
markdown link to the note. The line is cut from the old index, description and
all, its link respelled from the new folder, and added at the end of the new
folder's `index.md`. A new folder with no index gets one made as
[a create makes it](/reference/http-api/notes.md#post-apifilespath), and the plain line that listing wrote
for the note is replaced by the one carried, so the note is listed once.

An old index that never listed the note adds nothing anywhere: an index is
curated, and an entry nobody wrote is not one to invent at the other end. A
note that stays in its folder, and an `index.md` or `log.md` that moves, carry
nothing. [Moving a note](/explanation/moving-notes.md#why-an-entry-moves-only-when-it-was-listed)
says why.

### What a move leaves behind

Nothing, where it can. The folders the note came out of are removed as far up
as they are empty, stopping at the vault root and at the first folder that
still holds anything, a hidden file included. Folders exist here only as the
prefix of a note, so a folder the move emptied is one nothing would ever show
again.

A folder holding its `index.md` and nothing else counts as empty, and the index
goes with it. Its text is in jj, in the change before the move. The entry for
each folder removed this way is taken out of the index of the folder above it,
where there is one.

### What a move refuses

* `404` when there is no note at the path in the URL. Everything `GET` and
  `PUT` refuse is refused here too, so a note you cannot open is a note you
  cannot move.
* `409` when a note is already at the new path. Both notes are left alone.
* `400` when the vault will not take the new path at all. The list is the one
  [a create refuses](/reference/http-api/notes.md#what-a-create-refuses).

The `409` and the `400` are named for the reason the create names them: the
user is about to retype the path.

Every refusal returns before anything is written, so a move that bounced leaves
no folder, no half-moved note and no jj change behind.

A move that lands is recorded the way a save is, a change started before it and
a snapshot after, named `vault: <new path>`. jj matches the content across the
move and records it as a rename rather than a delete and an add, so the note
stays reachable at the path it left.

## PATCH /api/folders/{path}

Gives a folder a new path, and every note under it a new path with it. The URL
says where it lives now, the body where it should live from here on.

```json
{ "path": "reading/2026" }
```

The reply is the folder, and only the folder:

```json
{ "path": "reading/2026" }
```

No content comes back. A folder is the prefix of the notes under it and holds
nothing of its own, so there is nothing else to answer with. The notes moved but
did not change, and the client works out where each one went by swapping the old
prefix for the new.

Its own route rather than the one above, because a folder is not a note.
`/api/files/inbox` cannot mean the folder on a `PATCH` and nothing at all on a
`GET`.

One rename does it, not a walk over the notes. A folder is a directory on disk,
so renaming it renames everything under it at once and there is no half-moved
subtree to find a way back from.

`path` in the reply is the vault's spelling of the body's, the way `POST`
answers.

The folders on the way to the new path are made, and the ones the move emptied
are taken away, both exactly as [a note's move](#what-a-move-leaves-behind) does
them. The folder's entry in its old parent's `index.md` moves to the new
parent's, by [the rule a note's entry](#what-a-move-does-to-the-indexes) moves
by. The folder's own `index.md` travels inside it. When its first line is
`# <old name>`, the heading becomes `# <new name>`; a heading written any other
way stays as it was.

### What a folder move refuses

* `404` when there is no folder at the path in the URL. A note at that path is a
  `404` too: `PATCH /api/files/{path}` is the one way to move a note, and
  answering here would be a second way with none of the note's rules. So is the
  vault root, which is not a folder the vault will move.
* `409` when anything is already at the new path, a folder or a note. Merging
  two folders is a different operation, with a different way of failing partway
  through, and this is not it.
* `400` when the vault will not take the new path at all. The list is the one
  [a create refuses](/reference/http-api/notes.md#what-a-create-refuses), minus the `.md` suffix, which a
  folder does not carry. A new path inside the folder being moved is a `400`
  as well: a folder cannot hold itself.

Every refusal returns before anything is written, so a move that bounced leaves
no folder, no half-moved subtree and no jj change behind.

Links follow, the way [a note's move](#what-a-move-does-to-the-links) makes them
follow, and by the same rules read over every note the folder carries at once. A
link that spelled the old folder out gets the new one, and a bare `[[borges]]`
is left alone, the note's name being unchanged. A page of HTML, an image and a
book in the folder move with it, and `[[reading/report.html]]`,
`![[reading/plan.pdf]]` and `[[reading/plan.pdf|Plan]]` follow the same way.

The folder is matched as a whole path segment, so moving `reading/` takes
`reading/borges.md` and leaves `readings.md` where it is. The subtree's own
links are rewritten with the rest: a `[[reading/kafka]]` inside
`reading/borges.md` becomes `[[archive/kafka]]` when the folder lands at
`archive/`.

Markdown links follow by [the note's rules](#what-a-move-does-to-the-links):
a link from outside into the folder is rewritten, a link from inside the folder
to outside it is rewritten, and a link between two files inside it is left
alone.

The folder's name is the rg query that picks the notes to read, raw, with its
spaces escaped, and escaped by encodeURI, so a link the editor wrote to
`Bücher/x.png` as `B%C3%BCcher/x.png` follows the folder too. A path into the folder runs through its name, so a link
that spelled the path out, wikilink or markdown, holds it. The notes inside the
folder are read whatever they hold.

A move that lands is recorded the way a save is, named `vault: <new path>/`.
The trailing slash is what tells it from the change a note's move leaves, which
would otherwise read the same. jj matches the content across each note, so the
change reads as the renames it is rather than one subtree deleted and another
added.

## GET /api/move-preview

Says which files a move would rewrite, and writes nothing. Both paths go in the
query:

```
GET /api/move-preview?source=reading/borges.md&target=reading/2026/borges.md
```

```json
{ "rewrites": ["reading/2026/index.md", "reading/index.md", "today.md"] }
```

`rewrites` is every file whose links the move would change, by the path it has
today, sorted. That is every note holding a link [the move](#what-a-move-does-to-the-links)
rewrites, plus the new folder's `index.md` when
[an entry will be carried](#what-a-move-does-to-the-indexes) there, which may
not exist yet. It leaves out the smaller writes that follow the move: a listing
for a folder the move makes, the line naming that folder in the index above it,
and a folder's index heading taking its new name.

`source` is a note or a folder, whichever the vault holds there, and the answer
is the one `PATCH /api/files/{path}` or `PATCH /api/folders/{path}` would act
on. A `GET` beside the two rather than a flag on them, because it changes
nothing and answers with something neither of them does. The file tree asks it
before a drop, so [the confirm](/reference/editor-keys/file-tree.md#the-file-tree) can
list how far the move reaches.

It works out the plan the move itself writes, from the same function, so the
list and the move cannot disagree.

### What a preview refuses

* `404` when nothing is at `source`.
* `400` when the vault will not take `target`, by
  [the create's list](/reference/http-api/notes.md#what-a-create-refuses), or when a folder would land
  inside itself.

A target already taken is not refused here. The move will say so, and the
question here is only about links.

