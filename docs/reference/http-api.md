---
type: Reference
title: HTTP API
description: Every endpoint the backend serves, with its response shape.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API

The backend serves ten endpoints. Five read, four write, and one streams. The
interactive schema is at `/docs` while the backend runs, and the
machine-readable one at `/openapi.json`.

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
and directories are skipped, which keeps `.git` and editor dotfiles out, and a
hidden directory is skipped without being walked into, so the jj repo beside the
notes costs nothing. A vault directory that does not exist reads as an empty
one, so a fresh checkout still serves.

A directory is walked and never listed, whatever its name ends in. Reading one
is a `404`, so a folder called `notes.md` would otherwise be a row in the tree
that answered nothing when you opened it.

The walk costs 15.9ms at 10,000 notes in 842 folders. See [the load
side](/reference/ranking-performance.md) for what that used to be and what a
cold open spends the rest of its time on.

## GET /api/terminals

Names every herdr session a terminal pane could attach to, sorted. Takes
nothing and answers with a JSON array of strings.

```json
["agent-kasten", "notes"]
```

This is the one endpoint that reads nothing of the vault. The shell container
keeps one directory per named session under its own home, and this lists that
directory through a read-only mount of the same volume. So the backend runs no
herdr, holds no socket, and cannot start, stop or read into a session; the
worst it can do is name one.

It says what exists rather than what is running, because a directory is all it
looks at. That costs nothing in practice: `herdr --session <name>` attaches to
a stopped session and starts a missing one alike, so the two are the same
request from the browser's side.

An absent directory is not an error and answers `[]`. The mount is optional and
the shell container need not be up for the notebook to work, so the terminal
prompt falls back to a bare input that takes a name typed by hand.

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

## GET /api/events

Reports every change to the vault as server-sent events, one `data:` line per
change. The response stays open until the client goes away.

```
retry: 30000

data: {"path": "daily/2026-08-05.md", "change": "written", "digest": "3fda1d2d4bdf392f4939d3d3d02a091bf16144d45b4cf691ae4c2f7662f14674"}
```

Each event names a path, what happened to it, and a digest of what is on disk
now. There are three kinds:

* `written`: the note is on disk, and `digest` is the sha256 of its bytes.
* `removed`: the note is gone, and `digest` is `null`.
* `listing`: the shape of the vault moved. `path` is empty, `digest` is `null`,
  and the client rereads `GET /api/files`.

`listing` is how a folder move arrives. `PATCH /api/folders/{path}` is a single
rename, so the kernel names the directory and stops: no note under it fires at
all, and without this the client would keep drawing rows for notes that had
moved. One per batch whatever moved, because there is one file list to reread.

There is no kind for a note that is new. A write renames a temp file over the
note, Linux reports that as a move into place, and a note kasten has held for
weeks would announce itself as new on every save. Whether a note is new is a
question about the file list the client already holds, so the client answers it
there.

Nothing under a dot-directory is ever reported, which is the rule
`GET /api/files` lists by. That is what keeps the vault's own jj repo off the
stream: every write the backend makes touches `.jj`, and a save that reported
its own bookkeeping would say more about the repo than about the note.

The stream carries no note text, only the path, the kind and the digest. A
client that wants the new content reads the note the way it always does. The
digest is what lets it tell its own write coming back from someone else's:
kasten's writes are reported like any other, and nothing here tries to know
which was which.

Two lines are not events. A `retry:` field goes out first, telling the browser
to wait 30 seconds before opening the stream again, and a comment line goes out
every 30 seconds so that a quiet connection does not read as a dead one to the
proxies in front of it. `EventSource` swallows both before any handler sees
them.

Changes are gathered over a 100ms window, so an agent rewriting forty notes
costs a handful of messages rather than forty. A vault directory that does not
exist reads as one nothing ever happens in, so a fresh checkout still serves.

The stream must not be compressed on the way out. A proxy that gzips it buffers
the whole response, and the client then holds a connection that never delivers
a byte and never errors either.
[deploy/README.md](../../deploy/README.md) gives the Caddy fix.

## GET /api/files/{path}

Reads one note. `path` is a vault-relative POSIX path, exactly as it appears in
the list above. A slash inside it may be sent raw or percent-encoded.

```json
{ "path": "daily/2026-08-05.md", "content": "# 2026-08-05\n" }
```

`content` is the file's text, unchanged, the
[frontmatter block](/reference/note-frontmatter.md) included.

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

The text is stamped on the way through: the note's `modified` date is set to
now, and a note without a
[frontmatter block](/reference/note-frontmatter.md) gains one. Nothing below the
block is touched, because the vault is the source of truth. What comes back is
what landed on disk rather than what arrived, and it is the only copy to
believe: the client's own is a save behind from the moment it sends it.

Only a note that is already there can be written. Everything the read refuses
is refused here for the same reasons, and a note that does not exist is a `404`
as well: a path with no file behind it is not created. Making one is the `POST`
below.

The write goes to a hidden temp file beside the target and is then renamed over
it. The rename is atomic, so a crash halfway through leaves the old note whole
rather than half a new one.

The write detects no conflict of its own. One user, and a `PUT` whose base has
moved is not refused, so at this layer the last write still wins.

What a note edited by hand or by `git pull` costs is settled a layer up, over
[the change stream](#get-apievents). The browser is told when the vault changes
under it: a note nobody is typing into takes the new text, and a note holding
unsaved edits stops autosaving and says `Changed on disk` rather than writing
over what landed. A client that does not read the stream overwrites the way it
always did, and the history below is what gets the old text back either way.

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

Starts a new note. The URL carries the path. The body is optional and carries
the note's text, in the shape `PUT` takes:

```json
{ "content": "\n# 2026-08-09 Sunday\n" }
```

The reply is the note the vault wrote:

```json
{
  "path": "reading/borges.md",
  "content": "---\nid: 019fd761-258e-75da-b109-7bb369317960\ncreated: 2026-08-06T14:01:35+00:00\nmodified: 2026-08-06T14:01:35+00:00\n---\n"
}
```

The status is `201` and the shape is the one `GET` returns, so the client can
open what it just made.

The note always holds its [frontmatter block](/reference/note-frontmatter.md),
so it has an id from the moment it exists. Sent text goes under that block and
is stamped on the way through the way a save's text is, so a body carrying a
block of its own keeps the fields in it.

Send no body and the note is the block and nothing else. That is what a note
made from the prompt or by following a `[[link]]` gets: the file name is the
note's title in a vault with wikilinks, so a `# Borges` heading would say it
twice, and anything else would be a word in the vault the user did not type.

The body exists for the client that already knows the text. The five periodic
keys do, and without it they had to save straight over the note they had just
made. That second write is a second event on `/api/events` a moment after the
note opens, and typing into the note before it arrives makes the reader's own
keystrokes look like another writer: the editor stops autosaving and reads
`Changed on disk`, cleared with `:w`.

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

### What a move does to the links

Every `[[link]]` in the vault that named the note is rewritten to name it at its
new path. A link keeps the spelling it had: one that spelled the path out gets
the new path, and one that named the note gets the new name. So a move between
folders leaves `[[borges]]` alone, because a bare name follows the note on its
own, and a change of name rewrites it. The note being moved is read like any
other, which carries its links to itself along with it.

The rule a target is read by is the editor's, so what a rename follows is what
`gf` opens: a target with a slash is a path, a bare name is looked for anywhere
in the vault, and the note at the vault root wins a tie. A link the vault
already answers with another note is therefore left alone. The rule is written
out twice, in `backend/src/kasten_backend/links.py` and in
`frontend/src/lib/wikilink.ts`, which is what the editor resolving a link
without asking the server costs.

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

At 10,000 notes a move costs 29ms, against 315ms for the walk over every note it
replaced. 9ms of that is the directory listing, which resolving a bare name
needs and which `GET /api/files` pays on every page load anyway. A folder's move
costs 45ms, the difference being the notes it carries and their links to each
other.

Unlike search, an rg that cannot read the whole vault is an error here rather
than an empty answer, and the move fails with nothing written. A search that
came up short shows fewer rows; a rewrite that comes up short leaves a link
pointing at nothing.

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

Links follow, the way [a note's move](#what-a-move-does-to-the-links) makes them
follow, and by the same rules read over every note the folder carries at once. A
link that spelled the old folder out gets the new one, and a bare `[[borges]]`
is left alone, the note's name being unchanged.

The folder is matched as a whole path segment, so moving `reading/` takes
`reading/borges.md` and leaves `readings.md` where it is. The subtree's own
links are rewritten with the rest: a `[[reading/kafka]]` inside
`reading/borges.md` becomes `[[archive/kafka]]` when the folder lands at
`archive/`.

That same segment is the rg query that picks the notes to read, and here it
misses nothing rather than merely matching too much. The only link a folder move
changes is one that spelled the path out, and one that spelled it out holds the
old folder's path in full.

A move that lands is recorded the way a save is, named `vault: <new path>/`.
The trailing slash is what tells it from the change a note's move leaves, which
would otherwise read the same. jj matches the content across each note, so the
change reads as the renames it is rather than one subtree deleted and another
added.

## Related

* [Regenerate the API types](/how-to/regenerate-the-api-types.md) - push a change here through to the frontend
* [Configuration](/reference/configuration.md) - which directory `/api/files` reads
