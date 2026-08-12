---
type: Reference
title: Highlight format
description: The block a passage taken out of a book is written as, the quote rule and its character classes, the chapter line and its fallback, the anchor, and the rule that reads a highlight back.
resource: frontend/src/lib/highlight.ts
tags: [vault, reader, epub, format, frontend]
status: stable
---

# Highlight format

A highlight is three lines of a note. The lines are the whole record: nothing
about a highlight is held anywhere else, so a vault read by Obsidian, by another
editor or by `cat` carries every part of one.

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

One block is a run of lines opening with `>`, then a blank line, then a line
ending in the anchor.

Strip a leading `>`, and one space after it where there is one, from each line
of the run. A line left empty is the break between two paragraphs. Because the
quote rule left every paragraph on one line with single spaces in it, the
strings this recovers are the strings that were written, character for
character. There is no case to guess at: a paragraph holds no newline, so no
quoted line begins with `>` by accident, and no paragraph is empty.

## What the round trip does not recover

The book's own whitespace. A soft line break inside a paragraph becomes one
space, a run of spaces becomes one space, and a paragraph break stays a
paragraph break. The loss happens once, when the highlight is written, and it is
the same normalising foliate's search does to the book before matching.
