---
type: Reference
title: Highlight format
description: The block a passage taken out of a book is written as, the quote rule and its character classes, the figure line, the chapter line and its fallback, the anchor, and the rule that reads a highlight back.
resource: frontend/src/lib/highlight.ts
tags: [vault, reader, epub, format, frontend]
status: stable
---

# Highlight format

A highlight is three lines of a note, four where it carries a figure. The lines
are the whole record: nothing about a highlight is held anywhere else, so a vault
read by Obsidian, by another editor or by `cat` carries every part of one.

```markdown
## Highlights

> Systems that tolerate faults are called fault-tolerant.

Storage and Retrieval ^hl-a3f9c1
```

A blockquote, a blank line, then one line naming the chapter and carrying the
anchor. There is no HTML comment holding JSON and no other hidden line: kasten's
editor shows raw markdown and has no rendered view to hide one behind, so a
load-bearing line you cannot read would be one hand edit from broken.

Deleting a highlight is selecting three lines and pressing `d`. That is the
feature rather than a gap in it.

## Where the block goes

Under a `## Highlights` heading, at the end of that section, and the section is
made at the end of the note where there is none. Highlights stack in the order
they were taken, one blank line apart.

The heading is matched as a whole line, so `## Highlights ` with a trailing
space is a different heading and a second section is made under it.

## The quote

`selection.toString()` from the book, in four steps:

1. Cut the text into paragraphs on every run of newlines, `/[\r\n]+/`.
2. Collapse every run of whitespace in a paragraph to one space, `/\s+/g`, and
   trim the ends. Drop the paragraphs left empty.
3. Write each paragraph as its own line, `> ` and the paragraph.
4. Join those lines with a line holding one `>` and nothing else.

So two paragraphs come out as:

```markdown
> Systems that tolerate faults are called fault-tolerant.
>
> A system that is reliable does what the user expects.
```

A lone `>` and not a blank line, because a blank line ends a blockquote and
would leave the second paragraph as prose sitting under the first.

Whitespace means JavaScript's `\s`, non-breaking space included. That is the
class foliate's own search normalises the book with before matching
(`search.js:81`), which is what lets a paragraph written here be found in the
book again.

A paragraph that itself opens with `>` is written `> > x`. Nothing strips a
caret the book's own words carried.

## The figure

A selection holding a picture writes one more line, above the quote, and the
picture itself goes in the vault:

```markdown
## Highlights

![](99%20Misc/02%20Assets/01%20Images/2026-08-17-ab12cd34.png)

> Figure 4-3. A B-tree with three levels.

Storage and Retrieval ^hl-a3f9c1
```

Above the quote because a book's caption sits under its figure, and the quote is
usually that caption. A plain markdown image and not an embed: that is what the
editor draws, and it is the same line a pasted screenshot writes.

The file lands in `99 Misc/02 Assets/01 Images` under the name a paste gives one,
today's date and eight hex digits, and the suffix comes off the media type the
epub declared. One folder for every picture in the vault, so a figure and a
screenshot are the same kind of thing to everything downstream. The path is
`encodeURI`d, a space in `99 Misc` otherwise ending the destination.

The bytes are the book's own. foliate rewrites every resource in a chapter to a
`blob:` URL, so the reader fetches the file the epub shipped rather than
re-encoding what fits on the page.

**A selection with no words in it is a figure on its own**, which is what a drag
over a plate gives: the image line is then the whole block, and the chapter line
follows it. Nothing reads such a block back, the rule below wanting a quote, so
it is a picture in a note and no more than that.

The upload goes first and the block is written when it lands. A vault that
refuses the file, an `.svg` plate being the case that happens, leaves the note
as it was and says so in the status bar rather than writing a reference to
nothing. The formats the vault takes are png, jpeg, gif and webp, listed in
`ASSET_MAGIC` in `backend/src/kasten_backend/vault.py`.

## The chapter line

`{chapter} ^{id}`, one space between them.

The chapter is the label of the contents entry the selection was made in, with
its whitespace collapsed and its ends trimmed the way the quote's is. Where the
book gives no label, which is every book whose publisher wrote no contents, it
is `Section {n}`, counting the spine from one.

Two sources and not three. The chapter file's own `<title>` is refused: a great
many books put the book's title in every file, so that fallback would write the
same wrong words on every highlight in the book, and nothing could tell that
apart from a book whose chapters really are named that.

Nothing reads the chapter back. It is there for the person reading the note.

## The anchor

`^hl-` and six hex characters from `crypto.getRandomValues`, which is `newId`
in `todo.ts` with the highlight's own prefix.

kasten does not resolve block anchors, so `[[note#^hl-a3f9c1]]` reaches nothing
today. The anchor is written because it costs one line and Obsidian reads it.

**The anchor is not how a highlight is found again.** The quoted text is. There
is no epubcfi, no prefix and suffix, and no hash of the file, because a quote
survives you editing the note by hand, a person can read it and `rg` finds it.
The cost is written down and accepted: the same sentence twice in a book
resolves to the first one.

The `reading:` field in the note's frontmatter is an epubcfi, and that is a
different job. It is kasten's own bookmark rather than a citation, and nothing
has to read it by hand. [Books in the vault](/explanation/books-in-the-vault.md)
says why a quote is the anchor.

## Reading a highlight back

One block is three parts, in order: a run of one or more lines each opening
with `>`, then one line that is blank, then one line ending in `^hl-` and six
lowercase hexadecimal characters. Trailing whitespace on the anchor line is
ignored, and a line of spaces counts as blank.

**The anchor line is the whole test.** The `## Highlights` heading is never
looked for, so a block moved elsewhere in the note is still a highlight, and a
plain blockquote with no anchor under it is not one. That is what keeps Enter
on a quoted paragraph doing what vim does with a bare `<CR>` rather than
opening a book. An id retyped in capitals or a character short does not parse,
which is the same answer as a block edited past recognition: it stops being a
highlight and nothing pretends otherwise.

Strip a leading `>`, and one space after it where there is one, from each line
of the run, and trim what is left. A line left empty is the break between two
paragraphs. Because the quote rule left every paragraph on one line with single
spaces in it, the strings this recovers are the strings that were written,
character for character. There is no case to guess at: a paragraph holds no
newline, so no quoted line begins with `>` by accident, and no paragraph is
empty.

Two of the reader's steps are more than that inverse, and both exist because
the format promises a hand edit survives. A quote somebody wrapped onto two
lines joins back into one paragraph, the way markdown reads two lines as one.
A space somebody doubled inside a line collapses, through the same rule the
quote was written with. Both are the identity on anything the writer wrote.

A run edited down to a lone `>` leaves no paragraph at all, and that is not a
highlight either: an empty quote is a question the book should never be asked.
A figure taken on its own is the same case for the same reason.

An image line sits outside the run, `![](` not being `>`, so it neither joins the
quote nor breaks the block above it.

## What the round trip does not recover

The book's own whitespace. A soft line break inside a paragraph becomes one
space, a run of spaces becomes one space, and a paragraph break stays a
paragraph break. The loss happens once, when the highlight is written, and it is
the same normalising foliate's search does to the book before matching.
