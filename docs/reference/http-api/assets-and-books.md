---
type: Reference
title: "HTTP API: assets and books"
description: Routes for images, sounds and books, and the chunked uploads that carry a file too big for one request.
resource: backend/src/kasten_backend/routes/
tags: [api, backend, openapi]
status: stable
---

# HTTP API: assets and books

The routes for images, sounds and books, and the uploads that carry a file too big for one request.

## GET /api/vault-assets

Lists every image, sound and book in the vault as a relative POSIX path, sorted.

```json
["00 Inbox/plan.pdf", "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png"]
```

The same walk `/api/images` makes, filtered on every suffix an upload takes:
`.epub`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.mp3`, `.m4a`,
`.ogg` and `.wav`, in any case. `/api/images` leaves the sounds out, so `![](`
completes pictures only. The editor reads it to draw `[[plan.pdf]]` as live when the vault holds the file,
and as dead when it does not.

Not `/api/assets`, whose `GET` with a path serves one file. A listing at the
same URL would make it mean two things.

## GET /api/images

Lists every image in the vault as a relative POSIX path, sorted.

```json
["99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png"]
```

The same walk `/api/files` makes, filtered on the image suffixes instead of
`.md`: `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`, in any case, so
`PHOTO.PNG` is listed. A note's `.md` is matched exactly, so `NOTES.MD` is not a
note. Hidden files and directories are skipped the same way, and a vault that
does not exist reads as an empty one.

Its own listing rather than rows in `/api/files`, which the tree, the finder,
search and the link rewrite all read: an image is not a note and has no business
in any of those. The editor reads this one to complete the path inside a `![](`,
which is the only thing in the app that asks.

## GET /api/assets/{path}

Reads one book, image or sound out of the vault and answers with the bytes.
`path` is a vault-relative POSIX path ending in one of eleven suffixes, in any case, so
`Plan.PDF` is served as a pdf. A slash inside it may be sent raw or
percent-encoded.

| Suffix | Answered with |
| --- | --- |
| `.epub` | `application/epub+zip` |
| `.pdf` | `application/pdf` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.mp3` | `audio/mpeg` |
| `.m4a` | `audio/mp4` |
| `.ogg` | `audio/ogg` |
| `.wav` | `audio/x-wav` |

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

Puts one book, image or sound into the vault at `path`, and never over one
already there. `path` follows the same rules the read above follows, the eleven
suffixes included.

The body is the file itself, raw. Not multipart: one file and no fields, so
nothing has to parse a boundary at either end. No response body comes back,
only the status, because the client already knows the path it sent to.

With `?upload=<id>` and no body, the file is the one sent in pieces through
[`POST /api/uploads`](#post-apiuploads). It goes through the same checks a body
does, and the upload is deleted whether it lands or is refused.

The endpoint takes any legal path and decides nothing about where a book or an
image belongs. On the default layout, `<leader>cb` sends
`00 Inbox/02 Books/<the file's own name>.epub` and writes the note beside it
afterwards; a pasted image goes to
`99 Misc/02 Assets/01 Images/<today>-<eight hex digits>.png`. Both are choices
made in the client and not rules of this endpoint.

| Status | Means |
| --- | --- |
| `201` | The file is at that path |
| `400` | `The vault will not take that path`, or `That file is not what its name says` |
| `404` | `No such upload`, with `upload` |
| `409` | `Something is already there`, or with `upload`, `That upload is not finished` |
| `413` | `That file is over the 1 GiB limit` |

There is no overwrite. A path already holding a file is a `409`, and what is on
disk is untouched; the way to replace it is the shell pane, or for an image the
delete below and a second upload.
That refusal is decided by the filesystem rather than by a check in front of
the transfer: the bytes land in a hidden temp file beside the target and are
hard linked into place, so a path is taken by whichever request gets the link,
not by whichever asked first.

The cap is 1GiB for every kind, counted off the bytes as they arrive rather
than read off `content-length`. One cap because the cap is about what a request
may cost and not about what a format usually weighs. In production Cloudflare
sits in front of everything and refuses a body over 100MB, so the client sends
a file bigger than one piece through `POST /api/uploads` and finishes it here.

The bytes must start the way the suffix says they will: `PK\x03\x04` for a
`.epub`, which is what a zip starts with, `%PDF-` for a `.pdf`, and the matching
magic for each of the five image formats. A sound has more than one way to
start: an `.mp3` opens with `ID3` or an MPEG frame header, an `.m4a` with `ftyp`
behind the four bytes of its box size, an `.ogg` with `OggS`. `.webp` and `.wav`
are checked on their `RIFF` alone, four bytes they share with each other and
with avi, a short check per suffix being worth more here than the exactness.
**This is a usability check and not a security one.** The shell pane
drops a file straight into the vault without coming near this endpoint, so
nothing downstream can rely on it having run. It earns its place because there
is no delete: a PDF renamed `.epub` and sent by mistake would squat on the
sidecar path until you open a terminal.

Every refusal leaves the path as it found it. Where the path was free it stays
free, with no temp beside it, and the next upload to it succeeds. That holds for
a client that hangs up mid-body too. Where the path was taken, what was already
there is untouched.

Nothing here writes history. Books are ignored by jj, so a change bracketing
this would be empty, and [The file beside a note](/explanation/books-in-the-vault.md)
covers why. Images are not ignored: they are part of what a note says, and the
next save's snapshot sweeps in any untracked file under a megabyte, which most
screenshots are.

## POST /api/uploads

Opens an upload, for a file too big for one request: Cloudflare refuses a body
over 100MB and drops a request it has not answered within 100 seconds. The body
names what the file will weigh once joined, and the answer is the id to send
its pieces to.

```json
{"size": 108685245}
```

```json
{"id": "9f2c4e..."}
```

The backend opens an empty temp file named after the id in
[`KASTEN_UPLOAD_PATH`](/reference/configuration.md#kasten_upload_path), outside
the vault. The file is finished by the route that uses it, naming the id in
place of a body: `POST /api/anki?upload=<id>` or
`POST /api/assets/{path}?upload=<id>`.

An upload idle for an hour is deleted, by a sweep the backend runs every ten
minutes and by each call here, so a file nobody finished is gone within about
seventy minutes. Idle counts from its last piece, or from a refused or failed
`POST /api/anki?upload=` finish that kept it. A kept upload gives up its room to a new one that would not fit beside it. One whose temp file something
else deleted, or the backend cannot read, counts as gone too, and its id
answers 404. What has arrived is held in the backend's memory, and a restart
forgets it and empties the folder.

The uploads open at once may declare 4GiB between them, counted after the
sweep, which bounds the disk the temps can take.

| Status | Means |
| --- | --- |
| `201` | The upload is open |
| `400` | `An upload needs a size of at least one byte` |
| `413` | `That file is over the 1 GiB limit` |
| `507` | `Too much is already uploading: 4 GiB at once` |

## PUT /api/uploads/{upload}/{n}

Writes piece `n` of an upload, counted from 0, from the raw body. The client
picks the size of a piece.

A piece must come in turn: `n` is the number of pieces received so far. The
piece before it may come again, which replaces it, so a client whose answer got
lost sends the same piece again. A piece that runs past the declared size, or
whose body breaks off, is cut back out of the file, so the same `n` sent again
lands whole. Two pieces sent to one upload at once are written one after the
other, never into each other.

| Status | Means |
| --- | --- |
| `204` | The piece is written |
| `404` | `No such upload`: never opened, finished, or swept after an hour idle |
| `409` | `Piece 3 is out of turn: the next is piece 2` |
| `413` | `That piece runs past the size the upload declared` |
| `422` | `n` is not a number from 0 up |

## DELETE /api/assets/{path}

Takes one image or sound out of the vault and holds it in the trash, answering
with the entry it became.

```json
{
  "entry": "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png@2026-08-12T16-18-41.995729",
  "path": "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png",
  "deleted": "2026-08-12T16:18:41.995729Z"
}
```

The note delete's route read for an image, down to the entry: the trash names an
entry after where it came from, so an image sits in there beside the notes, and
[the restore](/reference/http-api/trash-and-history.md#patch-apitrashentry) puts it back with no rule of its own. The
folder the image emptied goes with it, the way a note's delete takes the one it
emptied.

Images alone. A book is a `404` like any other path this does not serve,
whichever of the two suffixes it ends in: a book travels with the note beside it, and which of the pair a delete should take
is a decision nothing here has made. The file tree, which is what this route
serves, lists images and no books.

| Status | Means |
| --- | --- |
| `200` | The image is in the trash, and the body says where it came from |
| `404` | No image at that path, a book, a `.md` and a directory included |

The notes referencing the image are left alone, for the reason a delete leaves
`[[link]]`s alone: rewriting them to say the picture is gone would be the one
edit a restore could not take back. The editor draws a reference to a file that
is not there as a picture that will not load.

## GET /api/books/{path}

Reads the book filed beside one note and answers with the bytes. `path` is the
**note's** path, `20 Literature/DDIA.md`, and never the book's.

The pair is a convention rather than a record, a book being its note's path with
the suffix swapped, so the vault is the only thing that can resolve it. A client
working from the note alone would have to ask for one suffix, read the `404` and
ask for the next, which is a request per format and a guess about the order they
should be tried in. Here it is one question.

`.epub` first and `.pdf` second, so a note with both beside it is answered with
the epub, which is the one that reflows. Which of the two came back is in a
header rather than in the body, the body being the book:

| Header | Carries |
| --- | --- |
| `X-Book-Path` | The vault-relative path of the file that came back, percent-encoded |

The encoding is not optional to reverse. A header goes down the wire as latin-1,
so `Grundzüge.pdf` arrives as `Grundz%C3%BCge.pdf` and the client is what puts
the name back together, `decodeURIComponent` being the whole of it.

| Status | Means |
| --- | --- |
| `200` | The bytes, with `X-Book-Path` naming which of the pair they are |
| `404` | `No book beside that note` |

The `404` covers a note with neither format beside it, a note that is not there
at all, and every path the vault refuses: one that climbs out with `..`, an
absolute one, a symlink pointing outside, a hidden segment. Nothing here asks
whether the note exists, because the book is what was asked for and a stem with
no book beside it answers the same either way.

[The file beside a note](/explanation/books-in-the-vault.md) is why the path is not
stored anywhere.

