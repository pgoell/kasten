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
modified: 2026-08-06T14:01:35+00:00
---
# borges
```

The block is part of the file, like the rest of the note. It is not held
anywhere else, so a vault read by Obsidian, by an editor or by `cat` carries the
same three fields.

## The fields kasten manages

| Field | What it holds | When it changes |
| --- | --- | --- |
| `id` | A UUID version 7 | Never. Given once, at the note's first write |
| `created` | When the note was first written, ISO 8601 in UTC | Never |
| `modified` | When the note was last written, ISO 8601 in UTC | Every `PUT`, to the second |

Version 7 because it sorts by the moment it was made, so a list of ids reads in
the order the notes arrived. It is what a future ontology hangs off: a path
changes every time a note is renamed or moved, and an id does not.

UTC, because the vault outlives the timezone of the machine that wrote it. To
the second, because a note saved twice a second apart is one note.

## Every other field is yours

Anything else in the block is copied through a save unread, in the order it was
written, nested lists and mappings included. kasten neither adds nor removes it.
Deleting one of your own fields is an edit like any other and it stays deleted.

The block is not parsed as YAML. Three keys are found by reading lines, and
everything else is text that gets copied, which is what keeps a save from
reordering keys, requoting strings or dropping comments.

## When the block is written

* [`POST /api/files/{path}`](/reference/http-api.md#post-apifilespath) starts a
  note holding its block and nothing else, so a note has an id from the moment
  it exists rather than from its first save.
* [`PUT /api/files/{path}`](/reference/http-api.md#put-apifilespath) stamps the
  text on the way through. A note written before kasten, or by hand, gains a
  block on its first save.
* A move writes no block. `PATCH` changes where a note lives, not what is in it,
  so `modified` is the date of the last edit rather than of the last rename.

`id` and `created` are read back off the note on disk when the text being
written carries neither. A client that does not know the block is there, and a
user who deletes it in the editor, both send the note back without one, and
minting a second id would leave the note nameable two ways.

## What it costs

`GET /api/search` reads the notes as they are on disk, so a query matching a
field name or a date matches the block in every note that has one. Searching for
`created` finds the whole vault.

The editor draws the block as YAML and opens the cursor on the first line below
it, so a new note is typed into rather than into its own dates.
