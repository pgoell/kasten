---
type: Reference
title: Reading a note
description: What the top bar holds, the three-column grid the note pane lays out with its numbers, the header block at the top of a note, Read and Edit, the frontmatter behind Properties, the outline, the container query's breaks, the local graph in the right margin and its sheet, and the Today screen an empty pane shows.
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
below 768 px of window width. There the search field opens the note finder
instead, and a + button makes a new note; a screen reader still hears "New note".

## The note pane

The pane is a container named `k-reader`, so its breaks follow its own width
and not the window's. The note's text is the editor's scroller, and three
columns sit over it:

| Column | Width | What it holds |
| --- | --- | --- |
| Left margin | 190 px | The outline: the note's headings, with the one in view marked |
| Middle | 680 px at most | The header, then the text |
| Right margin | 256 px | The local graph, then Links, Backlinks and Unlinked mentions |

The grid is `1fr minmax(0,680px) 1fr` with a 48 px gap (`--k-space-48`). The
text is in the middle column, so its left edge and its width do not move when
a margin goes or comes back. Both margins are sticky and stay in view while the
note scrolls.

The text is Newsreader (`--k-serif`) at 19 px (`--k-text-read`) with 1.6
leading, which is 30.4 px a line.

## The header

The block at the top of the text, which scrolls with the note:

- the path, in mono, and after it a Graph button while the right margin is
  hidden (see [the local graph](#the-graph-button-and-the-sheet));
- the title, in serif at 36 px;
- a meta line in sans at 13 px, or 15 px on a phone: the type, the edited date,
  the word count, and the tags as pills in the accent wash;
- a Properties button, and beside it the relations as plain lines, "About ..."
  and "Part of ...".

Read and Edit sit at the top right of the header, as a small switch, 15 px on a
phone.

A yearly or weekly note also carries its review under the title, drawn in Read
and in Edit and never written into the file. The review sits above the note's
own text. [Read the year and week review](/how-to/read-the-year-and-week-review.md)
says what each section shows.

## Read and Edit

Read is live preview on and Edit is the markdown source. The switch is the
live preview toggle, `<leader>p`, drawn as two buttons. It changes what is
drawn and never what is saved, and every pane shows the same state.

In Read the frontmatter is folded behind Properties. A cursor that goes into
it, by `gg` or `k` from the first line, shows the YAML, as live preview shows
the markup of the line under the cursor. The closing `---` stays a line of its
own, drawn empty, so an edit from the body that reaches it (Backspace at the
start of the first line, `dk`) shows the YAML at once and `u` puts it back. In
Edit the block is always drawn as YAML. A new note still opens its cursor on
the first line below the block.

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

The tab strip under the top bar is in
[Panes and tabs](/reference/editor-keys/panes-and-tabs.md) (#780). The phone
layout is in [kasten on a phone](/explanation/kasten-on-a-phone.md) (#793).

## The local graph

The right margin opens with a small graph of the note's neighbourhood. The
note sits in the middle and the notes it links to or that link to it sit on a
ring around it. The switch above the graph reads Direct or Two steps; Two steps
adds a second ring of the notes one link further out, each near the note it
hangs from.

Each dot takes the colour of its note's first tag, from the ten tag colours
`--tg-1` to `--tg-10` the accent palette sets, so a tag keeps its colour on
every note and in every palette. A note with no tag is grey (`--tg-none`), and a
note a link names that nobody has written is a hollow ring. The note in the
middle wears a ring in the accent colour.

A hover over a dot names its note. A click opens the note in the pane. A click
on a hollow ring makes the note the way following its link would; a tap asks
first. The graph does not zoom, pan or drag: it is a picture of where the note
stands, and the graph pane is the one to explore in.

Under the graph three lists, each with its count:

- Links: the notes this one links to.
- Backlinks: the notes that link to this one. A click opens the note at the
  line that links here.
- Unlinked mentions: lines in other notes that name this note in plain text,
  the same list the backlinks panel shows. A click opens the note at that line.

A list with nothing in it says "No links.", "No backlinks." or "No unlinked
mentions.", and so does a list whose read fails.

### The Graph button and the sheet

Below 1320 px of pane width the margin goes, and a Graph button sits after the
path at the top of the note. It opens the same graph and lists in a sheet 540
px wide over the right side of the note, which slides in from the right.
`<leader>gl` opens it too. `Escape` or a click outside it closes it, and the
cursor goes back to the note in the mode it was in. A click on a note in the
sheet closes it and opens that note. A pane that grows past 1320 px with the
sheet open closes the sheet, since the margin shows the same.

On a phone the Graph button and `<leader>gl` open the graph and lists in the
bottom sheet, which comes up from the foot of the screen and goes back down it.

Nothing of the graph is asked or drawn while it is off screen: a pane whose
margin is hidden and whose sheet is closed asks no graph and no mentions, and
draws no canvas, even after a save. The margin's graph is asked again after a
save while it shows, so a new link appears.

In a pane where the margin shows, `<leader>gl` opens the graph pane beside the
note, the larger graph to zoom and drag
([the graph pane](/reference/editor-keys/panes-and-tabs.md#the-graph-pane)).

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
line and no error, but for the review's daily limits: when those cannot be read,
Due says the cards could not be counted, in a row that opens the review.
