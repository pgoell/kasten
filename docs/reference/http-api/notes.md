---
type: Reference
title: "HTTP API: notes"
description: Routes that list, read, save and create notes.
resource: backend/src/kasten_backend/routes/
tags: [api, backend, openapi]
status: stable
---

# HTTP API: notes

The routes that list, read, save and create notes. Every path here is relative to the vault root.

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

## GET /api/files/{path}

Reads one note. `path` is a vault-relative POSIX path, exactly as it appears in
the list above. A slash inside it may be sent raw or percent-encoded.

```json
{ "path": "daily/2026-08-05.md", "content": "# 2026-08-05\n" }
```

`content` is the file's text, the
[frontmatter block](/reference/note-frontmatter.md) included, with every CRLF
read as an LF.

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

A note that holds a CRLF on disk keeps CRLF: the client was served LF, so every
LF in what it sends lands as a CRLF, the restamped `modified:` line included.
The reply and the `base` stay on the LF text the client saw. A note with only
LF on disk is written as sent.

A body may also carry `base`, the hex SHA-256 of the text the client believes
is on disk, with the frontmatter's `modified:` line set aside:

```json
{ "content": "# 2026-08-05\n\nEdited.\n", "base": "9f86d081…" }
```

When the note on disk, its `modified:` line set aside the same way, no longer
hashes to `base`, the write is refused with `409` and `Changed on disk`, and
the note stays as it was. `modified` is set aside because every `PUT` restamps
it, so a client still waiting on its last answer can name the text it sent as
the base of the next. The editor's autosave sends a base, so a quiet write in
the air when somebody else wrote the note no longer lands over their text. A
body without `base` is written whatever is on disk, and the last write wins.

The base may also name the text before the server stamped it: the note on disk
with the `id:`, `created:` and `type:` lines the stamp wrote at the head of the
block set aside, or with the whole block set aside when it holds nothing else
but `modified:`. A page-hide keepalive typed behind a quiet write names the text
that write sent, and the stamp it landed with is no other writer's change. The
body and every block line the stamp did not write must match exactly, or the
answer is `409`.

A stale `base` is not refused when the disk already holds the text being sent,
`modified` again set aside: the answer is `200` with the note as it stands, and
nothing is written. A page-hide keepalive and the quiet write it repeats can
land in either order, and the second one is no conflict.

What a note edited by hand or by `git pull` costs is settled a layer up, over
[the change stream](/reference/http-api/system.md#get-apievents). The browser is told when the vault changes
under it: a note nobody is typing into takes the new text, and a note holding
unsaved edits stops autosaving and says `Changed on disk` rather than writing
over what landed. A client that does not read the stream overwrites the way it
always did, and the history below is what gets the old text back either way.

### What the write records

If the vault is a jj repo, the write is bracketed by two jj commands: a change
is started before it and a snapshot taken after. Changes are one per note, not
one per save, and named `vault: <path>`, so `jj log` reads as the list of notes
you worked on while `jj op log` still holds every individual save.

A body may carry `restored_from`, the short id of the change whose text it
restores, in jj's change-id letters `k` to `z`, or the answer is `422`. The
change is then named `vault: <path> (restored from <id>)`, so the restore gets
a change of its own and the text it replaced stays in the change before it.

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

Each folder made here gets an `index.md` as it is made, listing what it holds:
the folder's name as a `#` heading, then a bullet per thing in it, folders
first with a trailing slash, notes without their `.md`, any other file by its
full name, and hidden files, `index.md` and `log.md` left out. No bullet has a
description, because only a person can write one. A folder that was already
there keeps whatever it had, an index or none, and its index does not gain the
new note.

The outermost folder made is added to the index of the folder above it, as
`* [name](name/)` at the end, but only when that index already reads as a
listing, holding a bullet with a markdown link. An index written as prose, or
with wikilinks alone, is left as it is. The folders an image upload or a
restore from the trash makes get no index.
[Moving a note](/explanation/moving-notes.md#why-a-folder-kasten-makes-gets-an-index)
says why.

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

## GET /api/written

Takes `from` and `to`, both `YYYY-MM-DD`, and answers with a sorted list of
strings. Each string is the day one note counts on. A note counts when its day
falls in the range, widened by one day on each side.

```
GET /api/written?from=2026-10-19&to=2026-10-20
```

```json
["2026-10-19", "2026-10-20", "2026-10-20T23:30:00+00:00"]
```

The list has one string per note, so a day with three notes appears three
times. Each string is the day as written, in one of three forms:

1. a note whose name starts with a date, such as `2026-10-19 Plan.md`, counts on
   that calendar day, `2026-10-19`;
2. a note with no such name counts on its `created` field as written, a day or
   an instant with its offset;
3. a note with neither counts on its file's modification time, as an instant
   in UTC with its offset.

This is the rule that [search's hit date](/reference/http-api/finding.md) uses,
so the overview and search agree on a note's day.

### The extra day either side

The range keeps a value when its first ten characters, the day as written, fall
within `from` less one day and `to` plus one day. An instant such as
`2026-10-19T23:30:00+00:00` is already the next day for a reader in Berlin, so
the day either side is kept. The server does not know the reader's zone. The client
works out the reader's own day and drops what falls outside it.

### Errors

* `400` when `from` is after `to`.
* `422` when a date is not `YYYY-MM-DD` or names no day, `2026-02-30` among them.

### Reading

The route lists the vault's notes, leaves out the archive folder and reads each
remaining note once, in a thread. It takes no `archive`: the archive always
stays out, even with the archive shown in searches. It writes nothing, touches
no database and keeps no index. The overview's Writing and This year cards read
it. The overview asks it again when the file list changes (a note added, removed
or moved), not on each save of a note already there, since one read takes
every note in the vault.

## GET /api/written/notes

Takes `from` and `to` as `/api/written` does and answers with the notes that
count in the range, one object each, sorted by day and then by path. The
notes and days are the ones `/api/written` answers, so the two agree on which
note falls in a week.

```
GET /api/written/notes?from=2026-10-19&to=2026-10-20
```

```json
[
  {
    "path": "02 Projects/FDE/2026-10-19 Kickoff.md",
    "day": "2026-10-19",
    "tags": ["#client", "#p/fde"],
    "project": "02 Projects/FDE"
  }
]
```

Each object holds:

* `path`: the note, relative to the vault root.
* `day`: the day the note counts on, spelled the way `/api/written` spells it.
* `tags`: the note's tags, each with its hash, sorted, as search reads them.
* `project`: the folder the note is filed under. It is the first of the note's
  `#p/x` tags, in the sorted order of `tags`, that names a folder directly under
  `02 Projects`. Without one, it is the project folder the note sits in. Without
  either, it is `null`. A todo's project follows the same rule, as
  [the todos route](/reference/http-api/todos.md) describes.

### Errors

* `400` when `from` is after `to`.
* `422` when a date is not `YYYY-MM-DD` or names no day, `2026-02-30` among them.

### Reading

The reading is the same as `/api/written`: the archive folder is left out, each
note is read once in a thread, and nothing is written, stored or indexed.

## GET /api/model-use

Takes `from` and `to`, both `YYYY-MM-DD` and both in, and answers with the usage
lines of the days in the range. The lines come from the monthly notes the
collector writes under `<config>/Model use/`, read as
[the model use format](/reference/model-use-format.md) describes.

```
GET /api/model-use?from=2026-10-25&to=2026-10-26
```

```json
[
  {
    "day": "2026-10-26",
    "model": "claude-haiku-5-5",
    "project": "kasten",
    "input": 310,
    "output": 9120,
    "cache_write": 88000,
    "cache_read": 1200300,
    "cost": 0.0347,
    "unpriced": 0
  }
]
```

Each object holds:

* `day`: the day of the line, `YYYY-MM-DD`.
* `model`: the model's id, as the session file holds it.
* `project`: the project's name, the rest of the line up to the colon.
* `input`, `output`, `cache_write`, `cache_read`: the token counts of the line.
* `cost`: the cost in US dollars, or `null` when no message of the line had a price.
* `unpriced`: the tokens of the messages that had no price. The cost leaves them
  out, and the number is `0` when every message had a price.

The list is sorted by day, then model, then project. A note without
`generator: kasten-model-use` is not read, and a line that does not parse is
passed over. Unlike `/api/written`, the range adds no day either side: a line
counts on its own day.

### Errors

* `400` when `from` is after `to`.
* `422` when a date is not `YYYY-MM-DD` or names no day, `2026-02-30` among them.

### Reading

The route writes nothing. It touches no database and keeps no index.

