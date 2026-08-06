---
type: Reference
title: HTTP API
description: Every endpoint the backend serves, with its response shape.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API

The backend serves seven endpoints. Three read, four write. The interactive
schema is at `/docs` while the backend runs, and the machine-readable one at
`/openapi.json`.

## GET /api/health

Reports that the process is up. It deliberately does not touch the database, so
it stays a liveness check and does not become a readiness check by accident.

```json
{ "status": "ok" }
```

## GET /api/files

Lists every note in the vault as a relative POSIX path, sorted.

```json
["daily/2026-08-05.md", "index.md", "projects/kasten.md"]
```

The list is flat and the server keeps it that way. Folders are not modelled
anywhere in the backend; the frontend folds the paths into a tree. Hidden files
and directories are skipped, which keeps `.git` and editor dotfiles out. A
vault directory that does not exist reads as an empty one, so a fresh checkout
still serves.

## GET /api/search

Finds every line in the vault holding `q`, ignoring case. Takes one query
parameter, `q`, and answers with at most 2,000 matches.

```json
[{ "path": "projects/kasten.md", "line": 4, "text": "Postgres holds a derived index." }]
```

Nothing is indexed and Postgres is not consulted. `rg` reads the notes on every
query, which over a 10,000 note vault costs about 17ms and cannot go stale,
because the files it reads are the source of truth themselves.

The match is literal. `q` is not a regex, so `index.` finds the end of a
sentence rather than any five letters followed by one more, and a half-typed
`[[like` is a query instead of an error. It is not a fuzzy match either: a
query read as a subsequence finds most of a vault whatever you type, which is
measurably useless over prose. Ranking the answer is the client's job, and
[The note search](/reference/editor-keys.md#the-note-search) is where that
happens.

Search sees exactly what `GET /api/files` lists, and this is the property to
keep. Markdown only, hidden files and directories skipped, and a `.gitignore`
inside the vault deliberately ignored, because git being told to overlook a
file says nothing about whether the note exists. A vault directory that does
not exist reads as an empty one.

A blank or whitespace-only `q` answers with nothing rather than everything. An
empty literal matches every line there is, which would make the query nobody
has finished typing the most expensive one the vault can answer.

The cap of 2,000 is about what crosses the wire, not what the machine can do:
`rg` reads the whole vault in about the same time whatever the cap. Because the
client ranks everything it is handed and cuts afterwards, the rows on screen
are the best of the match set rather than the head of it, and 2,000 is the
whole match set for anything but the most common word in a vault.

## GET /api/files/{path}

Reads one note. `path` is a vault-relative POSIX path, exactly as it appears in
the list above. A slash inside it may be sent raw or percent-encoded.

```json
{ "path": "daily/2026-08-05.md", "content": "# 2026-08-05\n" }
```

`content` is the file's text, unchanged.

Anything that is not a readable markdown file inside the vault is a `404`:

* a note that is not there
* a path that climbs out of the vault with `..`, or an absolute path
* a symlink whose target sits outside the vault
* a file that is not `.md`, a directory, or a hidden file

Every refusal reads the same, because telling a typo apart from an attempt to
climb out is worth nothing to the one user and something to everyone else.

## PUT /api/files/{path}

Writes one note back to the vault. The body carries the new text, the URL
carries the path:

```json
{ "content": "# 2026-08-05\n\nEdited.\n" }
```

The reply is the same shape `GET` returns, so the client can see what landed:

```json
{ "path": "daily/2026-08-05.md", "content": "# 2026-08-05\n\nEdited.\n" }
```

`content` is written unchanged. Nothing is stripped, added or normalised,
because the vault is the source of truth.

Only a note that is already there can be written. Everything the read refuses
is refused here for the same reasons, and a note that does not exist is a `404`
as well: a path with no file behind it is not created. Making one is the `POST`
below.

The write goes to a hidden temp file beside the target and is then renamed over
it. The rename is atomic, so a crash halfway through leaves the old note whole
rather than half a new one.

There is no conflict detection. One user, and the last write wins. A note
edited by hand or by `git pull` while it is open in the browser is overwritten
by the browser. What makes that safe to live with is the history below.

### What the write records

If the vault is a jj repo, the write is bracketed by two jj commands: a change
is started before it and a snapshot taken after. Changes are one per note, not
one per save, and named `vault: <path>`, so `jj log` reads as the list of notes
you worked on while `jj op log` still holds every individual save.

A vault that is not a jj repo is written to just the same and no history is
kept. jj failing, or missing from the box, never fails a save: the note matters
more than the record of it. See
[Recover an earlier version of a note](/how-to/recover-an-earlier-version.md).

## POST /api/files/{path}

Starts a new note. There is no body: the URL carries the path, and a new note
has nothing else to say.

```json
{ "path": "reading/borges.md", "content": "" }
```

The status is `201` and the shape is the one `GET` returns, so the client can
open what it just made.

The note is empty. The file name is the note's title in a vault with
wikilinks, so a `# Borges` heading would say it twice, and empty is the only
text that puts no word in the vault the user did not type.

`path` in the reply is the vault's spelling, not the URL's, which is the one
place this differs from `PUT`. `ideas/./kasten.md` comes back as
`ideas/kasten.md`. The client navigates to what it gets back, and two spellings
of one note must not end up in the address bar.

The folders on the way are made, the vault directory included, so a note names
its folders into being and a fresh checkout takes its first note with no
`mkdir` first.

### What a create refuses

It answers `409` or `400` where the read and the write answer `404` to
everything:

* `409` when a note is already at that path. Its text is left alone.
* `400` when the vault will not take the path at all: a climb out with `..`, an
  absolute path, a symlink whose target sits outside the vault or one that
  loops back on itself, a suffix that is not `.md`, a hidden name, an embedded
  null byte, an ancestor that is a file rather than a folder, or a path segment
  over 255 bytes.

The user is about to retype the path and has to know which of the two it was.
The two answers separate "a note is already there" from "the vault will not
have that path" and no more: every entry in the `400` list reads the same, so a
typo still cannot be told from an attempt to climb out. All the `409` adds is
that one note exists, which `GET /api/files` hands the same reader anyway.

Both refusals return before anything is written, so a create that bounced
leaves no folder and no jj change behind.

A create that lands is recorded the way a save is, a change started before it
and a snapshot after, so a new note arrives as its own `vault: <path>` change.
A vault that is not a jj repo takes the note just the same and keeps no
history.

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

The folders on the way to the new path are made, the way a create makes them.

### What a move leaves behind

Nothing, where it can. The folders the note came out of are removed as far up
as they are empty, stopping at the vault root and at the first folder that
still holds anything, a hidden file included. Folders exist here only as the
prefix of a note, so a folder the move emptied is one nothing would ever show
again.

### What a move refuses

* `404` when there is no note at the path in the URL. Everything `GET` and
  `PUT` refuse is refused here too, so a note you cannot open is a note you
  cannot move.
* `409` when a note is already at the new path. Both notes are left alone.
* `400` when the vault will not take the new path at all. The list is the one
  [a create refuses](#what-a-create-refuses).

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
them.

### What a folder move refuses

* `404` when there is no folder at the path in the URL. A note at that path is a
  `404` too: `PATCH /api/files/{path}` is the one way to move a note, and
  answering here would be a second way with none of the note's rules. So is the
  vault root, which is not a folder the vault will move.
* `409` when anything is already at the new path, a folder or a note. Merging
  two folders is a different operation, with a different way of failing partway
  through, and this is not it.
* `400` when the vault will not take the new path at all. The list is the one
  [a create refuses](#what-a-create-refuses), minus the `.md` suffix, which a
  folder does not carry. A new path inside the folder being moved is a `400`
  as well: a folder cannot hold itself.

Every refusal returns before anything is written, so a move that bounced leaves
no folder, no half-moved subtree and no jj change behind.

A move that lands is recorded the way a save is, named `vault: <new path>/`.
The trailing slash is what tells it from the change a note's move leaves, which
would otherwise read the same. jj matches the content across each note, so the
change reads as the renames it is rather than one subtree deleted and another
added.

## Related

* [Regenerate the API types](/how-to/regenerate-the-api-types.md) - push a change here through to the frontend
* [Configuration](/reference/configuration.md) - which directory `/api/files` reads
