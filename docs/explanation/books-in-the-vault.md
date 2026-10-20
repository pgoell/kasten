---
type: Explanation
title: The file beside a note
description: Why the thing you read is the note's path with the suffix swapped, why the suffix is one of two, and why the vault's history never takes a copy of either.
tags: [design, vault, reader, epub, pdf, jj]
status: stable
---

# The file beside a note

You can read something and you can write a note about it. Doing both in one
window is what the reader is for: `<leader>gr` opens the file beside the note,
and `h` and `l` turn the page.

The whole arrangement rests on one rule, and the rest falls out of it.

> What you read is its note's path with the suffix swapped.
> `20 Literature/DDIA.md` is read beside `20 Literature/DDIA.epub`.

There are two suffixes. `.epub` is a book, and `.pdf` is as often a paper, a
report or a deck, which is why the two are filed apart and typed apart and why
this page says "the file" where it used to say "the book". Everything else here
is true of both, and where it is not the page says so.

Each part has a page of its own:

* [Files and storage beside a note](/explanation/books-in-the-vault/files-and-storage.md): why the path is never stored, the two doors a file comes in by, why jj never takes a copy, what a changed file does, and why a file's markup cannot run code
* [Highlights and place in a file beside a note](/explanation/books-in-the-vault/highlights-and-place.md): how the reader keeps your place, why a quote is the anchor, how a highlight is drawn again, and what the reader does to the URL
* [Reading a pdf beside a note](/explanation/books-in-the-vault/pdf.md): what a pdf costs over an epub, and where the vendored pdf.js comes from

