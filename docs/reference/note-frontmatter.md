---
type: Reference
title: Note frontmatter
description: The YAML block every note carries, which fields kasten manages, and when they are written.
resource: backend/src/kasten_backend/frontmatter.py
tags: [vault, backend, frontmatter]
status: stable
---

# Note frontmatter

Every note kasten writes opens with a YAML block between two `---` fences:

```markdown
---
id: 019fd761-2599-71ba-b6d0-7b0d8e0a7367
created: 2026-08-06T14:01:35+00:00
type: Note
modified: 2026-08-06T14:01:35+00:00
---
# borges
```

The block is part of the file, like the rest of the note. It is not held
anywhere else, so a vault read by Obsidian, by an editor or by `cat` carries the
same four fields.

## The fields kasten manages

| Field | What it holds | When it changes |
| --- | --- | --- |
| `id` | A UUID version 7 | Never. Given once, at the note's first write |
| `created` | When the note was first written, ISO 8601 in UTC | Never |
| `type` | The kind of thing the note is, `Note` unless a writer said otherwise | Written once, on the note's first write, and never overwritten |
| `modified` | When the note was last written, ISO 8601 in UTC | Every `PUT`, to the second |

Version 7 because it sorts by the moment it was made, so a list of ids reads in
the order the notes arrived. It is what a future ontology hangs off: a path
changes every time a note is renamed or moved, and an id does not.

`type` is the one field Open Knowledge Format asks for, and
[OKF in the vault](/explanation/okf-in-the-vault.md) says what that buys.
`Note` is the honest answer for a note typed into an empty buffer, and a writer
that knows better says so itself in the text it hands over. Nothing ever
overwrites a type already there, whoever wrote it, so one you typed by hand
outlives every save after it.

UTC, because the vault outlives the timezone of the machine that wrote it. To
the second, because a note saved twice a second apart is one note.

## The two reserved filenames

`index.md` and `log.md` get no block at all. OKF gives both a shape of its own,
one being a listing of the bundle and the other its history, and neither is a
concept document. Kasten writes nothing into either, at any level of the vault,
so `folder/index.md` is exempt the way the root's is. What that means in
practice:

* A file named that way never gets an `id`. It is named by its path and by
  nothing else, and there is no field in it to lose.
* Text written to one comes back byte for byte. The one field a reserved file
  may carry is `okf_version`, and a save leaves it exactly where it was.
* A note renamed off one of those names is stamped at its new path, block and
  all, because it is a note again under any other name.
* A note renamed *onto* one keeps the block it had. The bundle stops conforming
  until the file is converted by hand, body and all, and it has to be a person:
  deleting the block would delete an id and a creation date the note owns, and
  the body has to become a listing or a log either way.

## Every other field is yours

Anything else in the block is copied through a save unread, in the order it was
written, nested lists and mappings included. kasten neither adds nor removes it.
Deleting one of your own fields is an edit like any other and it stays deleted.

Three things kasten writes land in this half of the block.
[An imported web page](/reference/editor-keys.md#importing-a-web-page) arrives
carrying `resource`, the address the page was read from, and `author` and
`published` where the page named them. They are written once, by the client, in
the text it hands to `POST`, and they are yours from that moment: a save copies
them through and deleting one keeps it deleted. Pages clipped before this wrote
the address as `source`. Nothing rewrites them, and nothing reads either field,
so an old clipping keeps `source` until you change it by hand.

The second is `reading:`, which
[the book pane](/reference/editor-keys.md#the-book-pane) writes into a
literature note as you turn pages. It holds an epubcfi naming the page you
stopped on, and the reader passes it back to foliate when the book opens again.
The client writes this one too, into the text it hands to `PUT`, so the same
rule holds: deleting the line loses a bookmark and nothing else, and
[Books in the vault](/explanation/books-in-the-vault.md#how-it-keeps-your-place)
says what that costs.

The third is `sr-due`, `sr-interval` and `sr-ease`, which
[a note marked for review](/reference/flashcard-format.md#a-whole-note-for-review)
carries. They hold when the note comes back, the days between this reading and
that, and how fast the gap grows. The client writes these too, and the same rule
holds: `sr-due` typed by hand is enough to schedule a note, and deleting all
three takes the note out of the review and nothing else.

The block is not parsed as YAML. Four keys are found by reading lines, and
everything else is text that gets copied, which is what keeps a save from
reordering keys, requoting strings or dropping comments.

## What a note says it is

`type` says what kind of thing a note is. Every note kasten writes for you
carries it in the block it arrives with, and nothing rewrites the field
afterwards.

| What wrote the note | `type` |
| --- | --- |
| A periodic note, at any of the five grains | `Periodic Note` |
| [A clipped web page](/reference/editor-keys.md#importing-a-web-page) | `Source` |
| The saved todo views note | `Reference` |
| `How-To-TODO.md` and `How-To-Exam.md`, the two format guides | `Reference` |
| A note with a book beside it | `Book` |

One type for all five periodic notes rather than five. `01 Periodic/00 Daily/`
already says which grain the note is, and `Daily Note` beside that folder is the
same fact written twice. The block is the first thing in the template, ahead of
the heading, because a block that does not open the file is prose and the note
would carry no type at all.

The book note is the one nothing writes at the moment the note is made. An
upload goes to the sidecar path of the note you are already in, and a book
dropped into the vault from a terminal pane passes through no upload, so
`type: Book` rides the write that keeps your place instead. It lands on the
first page you turn to rather than on the upload: a book you open and never page
through leaves its note untyped until you do, and a write refused because you
are typing in that note comes round again on the next page.

It goes in over `Note` or over nothing, and over nothing else. A note you typed
`Source` or `Concept` into keeps what you typed, through every page turn after.

## When the block is written

* [`POST /api/files/{path}`](/reference/http-api.md#post-apifilespath) starts a
  note holding its block and nothing else, so a note has an id from the moment
  it exists rather than from its first save.
* [`PUT /api/files/{path}`](/reference/http-api.md#put-apifilespath) stamps the
  text on the way through. A note written before kasten, or by hand, gains a
  block on its first save.
* A move writes no block, with one exception. `PATCH` changes where a note
  lives, not what is in it, so `modified` is the date of the last edit rather
  than of the last rename. The exception is a note renamed off a reserved name,
  which is stamped where it lands.

`id`, `created` and `type` are read back off the note on disk when the text
being written carries none of them. A client that does not know the block is
there, and a user who deletes it in the editor, both send the note back without
one, and minting a second id would leave the note nameable two ways.

## What it costs

`GET /api/search` reads the notes as they are on disk, so a query matching a
field name or a date matches the block in every note that has one. Searching for
`created` finds the whole vault.

The editor draws the block as YAML and opens the cursor on the first line below
it, so a new note is typed into rather than into its own dates.
