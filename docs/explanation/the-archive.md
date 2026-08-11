---
type: Explanation
title: The archive
description: Why finished work goes in a folder rather than a field, why one key rather than a filter on every list, and why the listing is the one thing the toggle never touches.
resource: frontend/src/lib/archive.ts
tags: [vault, archive, search]
status: stable
---

# The archive

A vault fills up. Notes on a project you shipped, a certification you passed and
a job you did not take are all still true, still worth keeping and still worth
finding when you go looking for them on purpose. What they stop being is what
you are looking for by accident.

That is the whole problem the archive solves, and it is worth being precise
about it, because the obvious solutions are all worse.

## It is a folder

`98 Archive` is an ordinary directory in the vault. Not a frontmatter field, not
a tag, not a row in Postgres. Moving a note into it is `<leader>rf` and a new
path, the same key that moves a note anywhere else, and nothing in kasten runs
when it happens.

This follows from [the one rule](/explanation/vault-and-derived-index.md). A
field would want a writer, a reader and a migration; a folder is already there,
and Obsidian, `mv` and a file browser all know how to put a note in one. Drop
the schema and rebuild the index and the archive is exactly where you left it,
because it was never in the schema.

The number in front is a filing convention, not kasten's. Everything but the
name lives in
[KASTEN_ARCHIVE_PATH](/reference/configuration.md#kasten_archive_path).

## The toggle is a mode, not a filter

Four things go looking for a note: the file tree, the note finder, search and
the todo list. The archive is out of all four, and one key,
`<leader>a`, puts it back into all four.

The alternative was a filter term on each, `-archive` in the search box the way
the todo pane's `/` takes terms. That is four places to remember a spelling,
four places to forget it, and no answer for the tree, which has no input to type
into. A mode is one thing to know and one thing to see, and the status bar says
which one you are in for the reason a modal editor shows the mode: the failure
of a hidden mode is quiet and confusing, a note missing from the finder reading
as a note missing from the vault.

It is not persisted. A reload puts it back to hidden, which is the same bargain
the pane arrangement makes and the safer default of the two.

## Two of the four are the backend's

The tree and the finder filter a listing already in the browser. Search and the
todo list do not: they pass `archive` to the backend, which leaves the folder
out of the `rg` pass itself.

That is not an optimisation. `GET /api/search` answers with at most 2,000
matches, so an archive that grew without bound would eventually push live notes
out of the answer rather than merely padding it. Filtering in the browser would
mean the cap had already been spent on notes about work that finished two years
ago. The scan has to skip them, not the render.

## The listing is never filtered

`GET /api/files` always answers with the whole vault, archive included,
whatever the toggle says. This is the one place the archive is not honoured, and
it is deliberate.

That listing is what resolves a `[[wikilink]]`. Following a link kasten cannot
resolve makes a new note in `00 Inbox`, which is the right answer for a link to
a note nobody has written and precisely the wrong answer for a link to a note
that is sitting in the archive: you would get an empty second copy and no sign
that the first one existed. So `gf` into the archive opens the archived note
whether the toggle is on or off, and only what you go browsing through changes.

The same reasoning covers the link rewrite a move performs. An archived note
holding a link to a note that just moved is still a link to rewrite, so
`notes_holding` skips nothing. Leaving a folder out of a search is a
convenience; leaving it out of a rewrite is a broken link.

## It is not the trash

Two folders hold things you are done with, and they answer different questions.

[The trash](/explanation/deleting-a-note.md) holds notes you deleted. It is
hidden, it is a dot-directory nothing walks into, entries are stamped with the
moment they arrived, and startup drops what has been in there longer than
`KASTEN_TRASH_DAYS`. It is a way back from a mistake.

The archive holds notes you kept. It is visible, it is an ordinary folder,
nothing stamps anything and nothing is ever dropped from it. It is a way of not
tripping over them.

A note goes to the trash because it was wrong. A note goes to the archive
because it was right and it is finished.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md) - why a folder rather than a field
* [Deleting a note](/explanation/deleting-a-note.md) - the other folder
* [Configuration](/reference/configuration.md) - the setting that names it
