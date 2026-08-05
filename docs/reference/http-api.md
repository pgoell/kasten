---
type: Reference
title: HTTP API
description: Every endpoint the backend serves, with its response shape.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API

The backend serves five endpoints. Three read, two write. The interactive
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

## Related

* [Regenerate the API types](/how-to/regenerate-the-api-types.md) - push a change here through to the frontend
* [Configuration](/reference/configuration.md) - which directory `/api/files` reads
