---
type: Reference
title: Reading a note
description: What the top bar holds, the three-column grid the note pane lays out with its numbers, the header block at the top of a note, Read and Edit, the frontmatter behind Properties, the outline, the container query's breaks, and the Today screen an empty pane shows.
resource: frontend/src/components/note-pane.tsx
tags: [frontend, design, reader]
status: stable
---

# Reading a note

The layout of a note on the screen: the bar across the top, the three columns
the note sits in, the header at the top of the text, and the Today screen an
empty pane shows. The tokens these numbers come from are in
[Design tokens](/reference/design-tokens.md).

## The top bar

A bar 56 px tall, sticky at the top of the window, with a frosted background.
It holds the wordmark, Vault, Graph and Search, a search field that says how
many notes it covers, and a New note button. Vault, Graph and Search are hidden
below 768 px of window width.

## The note pane

The pane is a container named `k-reader`, so its breaks follow its own width
and not the window's. The note's text is the editor's scroller, and three
columns sit over it:

| Column | Width | What it holds |
| --- | --- | --- |
| Left margin | 190 px | The outline: the note's headings, with the one in view marked |
| Middle | 680 px at most | The header, then the text |
| Right margin | 256 px | Links and backlinks |

The grid is `1fr minmax(0,680px) 1fr` with a 48 px gap (`--k-space-48`). The
text is in the middle column, so its left edge and its width do not move when
a margin goes or comes back. Both margins are sticky and stay in view while the
note scrolls.

The text is Newsreader (`--k-serif`) at 19 px (`--k-text-read`) with 1.6
leading, which is 30.4 px a line.

## The header

The block at the top of the text, which scrolls with the note:

- the path, in mono;
- the title, in serif at 36 px;
- a meta line in sans at 13 px: the type, the edited date, the word count, and
  the tags as pills in the accent wash;
- a Properties button, and beside it the relations as plain lines, "About ..."
  and "Part of ...".

Read and Edit sit at the top right of the header, as a small switch.

## Read and Edit

Read is live preview on and Edit is the markdown source. The switch is the
live preview toggle, `<leader>p`, drawn as two buttons. It changes what is
drawn and never what is saved, and every pane shows the same state.

In Read the frontmatter is folded behind Properties. A cursor that goes into
it, by `gg` or `k` from the first line, shows the YAML, as live preview shows
the markup of the line under the cursor. In Edit the block is always drawn as
YAML. A new note still opens its cursor on the first line below the block.

## The outline

The left margin lists the headings. The heading over the top of the view is
marked with the accent colour and a 2 px accent rule at its left edge. A click
or a tap on a row puts the cursor on that heading and scrolls it to the top.

## The margins and the breaks

The container query on the pane, by its width and not the window's:

| Pane width | What changes |
| --- | --- |
| Under 1320 px | The right margin goes |
| Under 1156 px | The outline goes too |
| Under 776 px | The grid is one column with 16 px side gutters |

A split pane narrows on its own, so each pane drops its margins as its width
asks.

Later issues fill three slots and change nothing above:

- a tab strip under the top bar, #780;
- the local graph at the top of the right margin, and a narrow Graph button
  beside the breadcrumb, #781;
- the phone layout, which replaces the one-column stopgap below 776 px, #793.

## Today in an empty pane

An empty pane shows Today above its empty editor, so every key an empty pane
took still works. The heading is the date, under it three columns:

- Today: today's todos, with their state.
- Recent: the eight notes with the newest `modified:` stamps. The page reads
  them through `GET /api/search`, for this month and last month.
- Due: the review cards waiting, the overdue todos, and the open loops, which
  are the todos that are doing, waiting or blocked.

A column with nothing in it says so in one line: "Nothing for today.",
"Nothing written lately." or "Nothing due." A column whose read fails shows its
line and no error.
