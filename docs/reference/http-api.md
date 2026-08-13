---
type: Reference
title: HTTP API
description: Every endpoint the backend serves, with its response shape.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API

The backend serves seventeen endpoints. Nine read, seven write, and one streams.
The interactive schema is at `/docs` while the backend runs, and the
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

## GET /api/images

Lists every image in the vault as a relative POSIX path, sorted.

```json
["99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png"]
```

The same walk `/api/files` makes, filtered on the image suffixes instead of
`.md`: `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`, lowercase. Hidden files and
directories are skipped the same way, and a vault that does not exist reads as
an empty one.

Its own listing rather than rows in `/api/files`, which the tree, the finder,
search and the link rewrite all read: an image is not a note and has no business
in any of those. The editor reads this one to complete the path inside a `![](`,
which is the only thing in the app that asks.

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

## GET /api/fetch

Reads one web page off the internet and hands it back unchanged. Takes one
query parameter, `url`, and answers with the markup and the address the page
finally came from.

```json
{ "url": "https://example.com/2025/post", "html": "<!doctype html>…" }
```

The other endpoint that touches nothing of the vault, and the only one that
goes outside the machine. It writes nothing: turning the markup into a note is
[defuddle](https://github.com/kepano/defuddle) running in the browser, and the
note is made through `POST /api/files/{path}` like any other.

The extraction has to be there and the fetch has to be here. defuddle reads a
DOM and the browser is where the DOM is; a second extractor in Python would
read the same pages differently. The browser, meanwhile, will ask another
origin for a page and then refuse to let a script read the answer, so the
request goes out from the server.

`url` must be `http` or `https`. That check is the trust boundary and it runs
before anything is opened: `file:///etc/passwd` would otherwise read the
container's disk and hand it to the browser. Anything else is a `400`.

The address that comes back is the one after redirects, because a page's
relative links are relative to that and the client resolves them.

Three refusals beside the scheme, and each says which it is, because the reader
is looking at the address they pasted and is the one who can fix it:

* `415` when the answer is not HTML, which is what a link to a PDF gets
* `502` with the number when the page answered `400` or worse
* `502` when the page is bigger than 8 MB, counted as the bytes arrive rather
  than believed off `content-length`, or when it did not answer inside twenty
  seconds

A page that answers `404` is a `502` here rather than a `404`, which would say
this endpoint is missing rather than that the page is.

The request goes out under a browser's user agent string. A great many sites
answer an unfamiliar agent with a challenge page, and this is one page asked
for by hand, by somebody who could have opened it in a tab.

## GET /api/search

Finds every line in the vault holding `q`, ignoring case. Takes `q` and an
optional `archive`, and answers with at most 2,000 matches.

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

`archive` defaults to false, which walks past the folder
[KASTEN_ARCHIVE_PATH](/reference/configuration.md#kasten_archive_path) names.
This matters more than it looks next to the cap below: an archive that grows
without bound would eventually push live notes out of the answer rather than
merely lengthening it. `archive=true` walks it.

The cap of 2,000 is about what crosses the wire, not what the machine can do:
`rg` reads the whole vault in about the same time whatever the cap. Because the
client ranks everything it is handed and cuts afterwards, the rows on screen
are the best of the match set rather than the head of it, and 2,000 is the
whole match set for anything but the most common word in a vault.

## GET /api/cards

Finds every line in the vault that could be part of a flashcard. Takes an
optional `archive` and answers with at most 100,000 matches, in the shape
`GET /api/search` returns.

```json
[{ "path": "03 Flashcards/aws.md", "line": 5, "text": "What does S3 stand for?::Simple Storage Service" }]
```

One `rg` pass, carrying the same flags search carries. Nothing is indexed and
Postgres is not consulted, for the reason search does not consult it.

It matches four shapes:

* a line holding `::`, or a line that is exactly `?`, which are
  [the two ways a card is written](/reference/flashcard-format.md#the-two-ways-to-write-a-card)
* a line holding `<!--SR:!`, which is a card's schedule
* a line holding `#flashcards` or `#review`, which is what makes a note a deck
* a line opening `sr-due:`, which is the due date of a note that is itself the card

Nothing here parses a card. The endpoint hands the lines over whole, because the
browser has to parse the format anyway to draw one and two parsers in two
languages drift. Which note is a deck, which line is a question and which card
is due are all read on the client.

The `::` branch is deliberately loose and matches `std::vector` too. That costs
a line in this answer and never a card on screen: the deck tag decides which
notes are asked at all, so a note nobody tagged contributes nothing however many
colons are in it. Tightening the pattern here would mean reading every note that
matched.

The cap is 100,000 rather than search's 2,000, for the reason `GET /api/todos`
carries that number: a backstop against one generated file, not a limit on how
many cards a person can own. An imported Anki deck is a real four-figure case.

`archive` walks the archive folder too, and is off by default. That is the whole
of [filing a deck away](/reference/flashcard-format.md#filing-one-away): moving
the note into the archive takes it out of the review and changes nothing else.

A vault directory that does not exist reads as an empty one.

## POST /api/anki

Turns an Anki export into one markdown note per deck. Takes the `.apkg` bytes as
the raw request body, the way `POST /api/assets/{path}` takes a book, and
answers 201 with what was written.

```json
{ "notes": ["03 Flashcards/AWS.md"], "cards": 412, "dropped_media": 17 }
```

The export is read with `zipfile`, `sqlite3` and `compression.zstd`, all of them
in the standard library on Python 3.14, so importing a deck adds no dependency.
Both the current collection format and the older one are read.

Field 0 of each note is the question and field 1 the answer. A note with fewer
than two fields is skipped, HTML in a field is flattened to one line, and a
nested deck becomes a nested folder under
[KASTEN_FLASHCARDS_PATH](/reference/configuration.md#kasten_flashcards_path).

`dropped_media` counts the cards that referred to an image or a sound. The media
map in a current export is zstd-compressed protobuf, which the standard library
cannot read without the schema, so those references are stripped and the number
is reported rather than the loss being silent.

### What an import refuses

* A body that is not a zip, or a zip holding no collection, answers 400.
* A deck name that would climb out of the flashcards folder answers 400.
* A deck whose note already exists answers 409, and **nothing is written at
  all**, not even the decks in the same export that would have been fine. Every
  path is resolved and every collision found before the first write, because the
  note it would land on may hold schedules you spent a month building.
* A body over 100MB answers 413.

[Import an Anki deck](/how-to/import-an-anki-deck.md) is the runbook.

## GET /api/todos

Finds every line in the vault that could be a todo. Takes an optional
`archive` and answers with at most 100,000 matches, in the shape
`GET /api/search` returns.

```json
[{ "path": "projects/kasten.md", "line": 12, "text": "- [/] wire up the pane 📅 2026-08-14 ⏫" }]
```

One `rg` pass, carrying the same flags search carries, so this and
`GET /api/files` cannot disagree about which notes the vault holds. Nothing is
indexed and Postgres is not consulted, for the reason search does not consult
it: the files are the source of truth.

It matches two shapes and nothing else:

* a checkbox list item at any indent, in any of
  [the five states](/reference/todo-format.md#the-five-states): `- [ ]`,
  `- [/]`, `- [x]`, `- [X]`, `- [b]` or `- [-]`
* a running session line, `- 14:03- …`, with no end time on it

`[X]` is matched because another editor writes it that way. `[` is not one of
the state characters, which is what keeps `- [[borges]]` out, and the `- `
anchor is what keeps `1. [ ] ordered` out. The done log's `- ✅` line does not
match either, which is
[the whole reason it is not a checkbox](/reference/todo-format.md#the-done-log).

A closed session line, `- 09:12-10:32 …`, is deliberately not matched. The pane's
`t` writes both spellings into the
[time log](/reference/todo-format.md#the-time-log), and a running one comes back
in the same pass as the todos because the view wants to know what is going. A
closed one says nothing the task line does not already carry, the total being on
it, and the closed ones are the half of that log that piles up. A stop reads them
through `GET /api/search` on the todo's id instead, which is one narrow pass at
the press rather than a growing answer on every fetch.

Nothing here parses a todo. The endpoint finds the lines that could be one and
hands them over whole, because the editor has to parse a line anyway and two
parsers in two languages drift. Whether one of them is open, overdue or a
subtask of the line above it is read on the client, off the same module the
editor draws a todo with. That is also how the client tells a session line from
a todo, which is why one endpoint can answer both.

The cap is 100,000 rather than search's 2,000, and the two numbers are doing
different jobs. Search guards a query that can match anything in the vault. This
one is a backstop against a single generated file with a million list items in
it, and nothing else: reaching it truncates the answer silently, which is why it
sits where nothing written by hand reaches it.

`rg` matches a line rather than a parse tree, so a `- [ ]` inside a fenced code
block in a note about markdown comes back as a hit. The client cannot tell from
the line alone either, and it costs a wrong row in the todo pane. Dropping it
would mean reading every note that matched.

A vault directory that does not exist reads as an empty one, so a fresh
checkout still serves.

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
[Two environments](/explanation/environments.md#constraints-the-box-imposes)
gives the Caddy fix.

## GET /api/assets/{path}

Reads one book or image out of the vault and answers with the bytes. `path` is a
vault-relative POSIX path ending in one of six suffixes, and a slash inside it
may be sent raw or percent-encoded.

| Suffix | Answered with |
| --- | --- |
| `.epub` | `application/epub+zip` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |

The reply is the file, and the content type comes off the suffix. Nothing here
opens what it sends: this resolves a path, checks the suffix and streams a file,
so a `.epub` holding anything at all is served unchanged and the reader in the
browser is what decides whether it is a book. `Range` comes free with the file
response and nothing uses it, the client asking for the whole file once.

Anything that is not a readable file of one of those suffixes inside the vault
is a `404`, on the same rules the note read follows: a path that climbs out with
`..` or an absolute one, a symlink pointing outside, a hidden segment, a `.md`
path, a directory whose name ends in `.epub`, and a file that is not there. A
suffix the table does not hold is a `404` too, `.svg` among them: an SVG is
markup a browser runs, and the way to keep one out of a page is to keep it out
of the vault.

## POST /api/assets/{path}

Puts one book or image into the vault at `path`, and never over one already
there. `path` follows the same rules the read above follows, the six suffixes
included.

The body is the file itself, raw. Not multipart: one file and no fields, so
nothing has to parse a boundary at either end. No response body comes back,
only the status, because the client already knows the path it sent to.

The endpoint takes any legal path and decides nothing about where a book or an
image belongs. `<leader>cb` sends `00 Inbox/02 Books/<the file's own name>.epub`
and writes the note beside it afterwards; a pasted image goes to
`99 Misc/02 Assets/01 Images/<today>-<eight hex digits>.png`. Both are choices
made in the client and not rules of this endpoint.

| Status | Means |
| --- | --- |
| `201` | The file is at that path |
| `400` | `The vault will not take that path`, or `That file is not what its name says` |
| `409` | `Something is already there` |
| `413` | `That book is too big` |

There is no overwrite. A path already holding a file is a `409`, and what is on
disk is untouched; the way to replace it is the shell pane, or for an image the
delete below and a second upload.
That refusal is decided by the filesystem rather than by a check in front of
the transfer: the bytes land in a hidden temp file beside the target and are
hard linked into place, so a path is taken by whichever request gets the link,
not by whichever asked first.

The cap is 100MiB for either kind, counted off the bytes as they arrive rather
than read off `content-length`. One cap because the cap is about what a request
may cost and not about what a format usually weighs. In production Cloudflare
sits in front of everything with a body limit of its own near that number, so a
real oversize upload is usually refused by Cloudflare's own page before kasten
sees it. The `413` is a backstop for dev, for the LAN and for a client that did
not check its file first.

The bytes must start the way the suffix says they will: `PK\x03\x04` for a
`.epub`, which is what a zip starts with, and the matching magic for each of the
five image formats. `.webp` is checked on its `RIFF` alone, four bytes it shares
with wav and avi, one prefix per suffix being worth more here than the
exactness. **This is a usability check and not a security one.** The shell pane
drops a file straight into the vault without coming near this endpoint, so
nothing downstream can rely on it having run. It earns its place because there
is no delete: a PDF renamed `.epub` and sent by mistake would squat on the
sidecar path until you open a terminal.

Every refusal leaves the path as it found it. Where the path was free it stays
free, with no temp beside it, and the next upload to it succeeds. That holds for
a client that hangs up mid-body too. Where the path was taken, what was already
there is untouched.

Nothing here writes history. Books are ignored by jj, so a change bracketing
this would be empty, and [Books in the vault](/explanation/books-in-the-vault.md)
covers why. Images are not ignored: they are part of what a note says, and the
next save's snapshot sweeps in any untracked file under a megabyte, which most
screenshots are.

## DELETE /api/assets/{path}

Takes one image out of the vault and holds it in the trash, answering with the
entry it became.

```json
{
  "entry": "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png@2026-08-12T16-18-41.995729",
  "path": "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png",
  "deleted": "2026-08-12T16:18:41.995729Z"
}
```

The note delete's route read for an image, down to the entry: the trash names an
entry after where it came from, so an image sits in there beside the notes, and
[the restore](#patch-apitrashentry) puts it back with no rule of its own. The
folder the image emptied goes with it, the way a note's delete takes the one it
emptied.

Images alone. A `.epub` is a `404` like any other path this does not serve: a
book travels with the note beside it, and which of the pair a delete should take
is a decision nothing here has made. The file tree, which is what this route
serves, lists images and no books.

| Status | Means |
| --- | --- |
| `200` | The image is in the trash, and the body says where it came from |
| `404` | No image at that path, a `.epub`, a `.md` and a directory included |

The notes referencing the image are left alone, for the reason a delete leaves
`[[link]]`s alone: rewriting them to say the picture is gone would be the one
edit a restore could not take back. The editor draws a reference to a file that
is not there as a picture that will not load.

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

The book beside the note goes with it, `20 Literature/DDIA.epub` following
`20 Literature/DDIA.md`, because the pair is a convention rather than a record
and a note that moved alone would stop having a book. It stays where it is when
the new path already has a book of its own: the note still moves, and nothing
here overwrites a book. The reply says nothing either way, a client swapping
the suffix for itself.

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
already answers with another note is therefore left alone. Where nothing answers
the two part: the editor puts the note it is about to make in `00 Inbox`, and a
rename leaves the name where it stands, there being no note to follow. The rule is written
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

## DELETE /api/files/{path}

Takes one note out of the vault and holds it in the trash.

```json
{
  "entry": "00 Inbox/borges.md@2026-08-11T14-03-02.481337",
  "path": "00 Inbox/borges.md",
  "deleted": "2026-08-11T14:03:02Z"
}
```

`entry` is where the note now sits under `.trash`, and it is the name
[the restore](#patch-apitrashentry) takes. `path` is where it lived, which is
where a restore puts it back. `deleted` is the moment in the entry's own name.

A `DELETE` that keeps the note is not a contradiction. What these routes answer
about is what the vault holds, and the note stops being one of them the moment
it moves: nothing lists it, nothing searches it, and no path in a URL reaches
it, because every route refuses a hidden folder. Why it waits there rather than
going is [Deleting a note](/explanation/deleting-a-note.md).

The trash mirrors the vault. A note keeps its path and its leaf takes the moment
it went, so the name is the whole record: where it came from, when, and no way
to collide with a note deleted from the same path later.

The folders the note came out of go with it, exactly as
[a move](#what-a-move-leaves-behind) takes them.

Links pointing at the note are left alone. A `[[link]]` names a note rather than
a place, the editor already draws one nothing answers to as missing, and
rewriting the vault to say a note is gone would be the one edit a restore could
not take back.

### What a delete refuses

* `404` when there is no note at the path in the URL. Everything `GET` and `PUT`
  refuse is refused here too, so a note you cannot open is a note you cannot
  delete.

A delete that lands is recorded the way a save is, named
`vault: .trash/<entry>`. The entry rather than the note, so a delete never
amends the change holding the edit before it and the text you last typed stays
reachable. jj matches the content across the move and records it as a rename.

## DELETE /api/folders/{path}

Takes one folder out of the vault, and every note under it with it.

```json
{
  "entry": "reading@2026-08-11T14-03-02.481337",
  "path": "reading",
  "deleted": "2026-08-11T14:03:02Z"
}
```

One entry, not one per note. The folder goes in one rename and comes back in
one, so what you get back is the folder you deleted rather than a list of notes
to put back yourself.

Its own route rather than the one above, for the reason
[the folder move](#patch-apifolderspath) has one.

### What a folder delete refuses

* `404` when there is no folder at the path in the URL. A note at that path is a
  `404` too, so the one way to delete a note stays the route above, and so is
  the vault root.

## GET /api/trash

Everything the trash is holding, newest first.

```json
[
  {
    "entry": "00 Inbox/borges.md@2026-08-11T14-03-02.481337",
    "path": "00 Inbox/borges.md",
    "deleted": "2026-08-11T14:03:02Z"
  }
]
```

Read off the names in `.trash` rather than out of a list somebody has to keep in
step with it. The name of an entry is the record, so a note moved out of the
trash by hand stops being on this list by the same act.

Newest first because the entry anyone wants back is usually the last one they
deleted, and `<leader>du` takes the first row without asking.

## PATCH /api/trash/{entry}

Puts one entry back where it was deleted from.

```json
{ "path": "00 Inbox/borges.md" }
```

`PATCH` and no body, for the reason [a move](#patch-apifilespath) is a `PATCH`:
this changes where something lives, and where it should live is already written
in the entry's own name.

The folders on the way back are made, the way a create makes them, because the
delete took the empty ones with it.

### What a restore refuses

* `404` when the trash has no such entry. A path that climbs out of the trash is
  a `404` too, the entry going through the same rule a note's path does.
* `409` when something has taken the path since. The entry is left in the trash.
* `400` when the vault will not take the path at all, which by then means
  something is standing where one of its folders has to go.

A restore that lands is recorded the way a save is, named `vault: <path>`.

## Related

* [Deleting a note](/explanation/deleting-a-note.md) - why a delete keeps the note
* [Regenerate the API types](/how-to/regenerate-the-api-types.md) - push a change here through to the frontend
* [Configuration](/reference/configuration.md) - which directory `/api/files` reads
