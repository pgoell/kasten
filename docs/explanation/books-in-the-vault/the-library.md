---
type: Explanation
title: The library
description: Why the library reads every row off the notes rather than keeping a list, why its status is worked out before it is chosen, why hiding is a line in the note, and why a shelf is a folder.
tags: [design, vault, reader, epub, library]
status: stable
---

# The library

Before the library, a book was reached through the tree or through
`reading-now.md`, and nothing showed the books side by side. The library pane
does, and four choices under it are worth saying out loud.

## Every row is read off the note

`GET /api/library` keeps no table. It asks rg for the notes that hold the word
`Book`, keeps those whose block says `type: Book`, and reads each row off the
note and the file beside it. A dozen books cost a dozen small reads.

The reason is the vault rule that runs through
[the file beside a note](/explanation/books-in-the-vault.md): a fact written in
two places drifts. A list of books kept apart from the notes would be wrong the
moment somebody moved a note in the shell or typed a field by hand. Reading the
notes each time means the library cannot disagree with them, and a vault read by
`cat` carries everything the pane shows.

## Status is worked out first and chosen second

The reader already writes `reading:`, `progress:` and `read_at:` as pages turn,
so most of a book's status is there without anyone choosing it: a place means
reading, and a `progress` of 0.99 means finished, since the reader rounds and a
last page seldom reports 1.

What the fields cannot say is intent. Nothing in a note says you want to read it
next, or that you stopped on purpose. So `status:` exists for those, and when a
note carries one it wins. A book you dropped at 23 % stays dropped however its
`progress` reads.

## Hiding is a line in the note

A book you never mean to open again, or one filed for somebody else, is noise in
a list you open to choose what to read. kasten has no delete for a file beside a
note, and deleting the note would break the pair, so hiding is the way to take a
book out of view.

It is `hidden: true` in the note, for the same reason status is: it travels with
the note through a move and survives a reinstall, where a list in the browser
would be lost with the browser. Showing a book again writes `hidden: false`
rather than removing the line, because the client's frontmatter writer has no
delete, the same reason [a parked note](/reference/note-frontmatter.md#every-other-field-is-yours)
keeps `sr-suspended: false`.

## A shelf is the folder

The vault already files books into folders, `01 Technical` and `03 Parenting`,
so the library calls a folder a shelf and draws it without its sort number. A
shelf field would be a second place saying where a book belongs, one a folder
move would leave behind. Moving a book to another shelf is a note move, which
carries the epub with it, so the pair never parts.

The picker offers only folders that already hold a book. A new shelf is a new
folder, made in the tree, which is where folders are made.

## Related

* [Editor keys, the library pane](/reference/editor-keys/book-pane.md#the-library-pane): what the pane shows and every key
* [HTTP API: assets and books](/reference/http-api/assets-and-books.md#get-apilibrary): the two routes behind it
