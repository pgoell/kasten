---
type: Explanation
title: Tags, colour and embeds in live preview
description: Why a tag has no mark to hide, why each inline construct takes its own colour, and why an embed is the same rendering read only, nested inside the note.
tags: [design, editor, frontend]
status: stable
---

# Tags, colour and embeds in live preview

## A tag has no mark to hide

`#kasten` is the one construct here where the syntax is the content. Every other
mark stands in front of something: the hashes of a heading, the asterisks around
bold, the brackets of a link. A tag's hash is part of the word, so there is
nothing to take off, and the tag reads the same in normal mode and in insert
mode. It is coloured and left where it is, the way an overdue date is.

Markdown has no tag, so the parser is given one, a small inline extension
alongside the one that reads `==highlighted==`. A regex over the text would have
been shorter and wrong: it would colour the `#` in `#!/bin/sh` inside a fenced
block, in `https://example.com/#anchor`, and in `issue#12`. An inline parser is
never asked about a range another parser has already taken, so a code span, a
fence and a URL are safe without a rule saying so, and the pattern itself only
has to refuse a hash that follows a word character or is not followed by a
letter.

The tag is drawn as a pill, and it loses the pill in a table's source. Padding
widens the text by a few pixels, and a table's columns are lined up there by
counting characters, so a pill in one cell would push the wall to its right out
of line with every wall above it. In the drawn table the pill is back, the grid
lining the columns up rather than the spaces.

## Colour tells the inline constructs apart

Once the marks are hidden, the only thing left saying that a word is bold is
that it is bold, and on a screen of prose weight and slope are easy to miss and
easy to confuse with each other. The [design tokens](/reference/design-tokens.md)
keep colour for accents, links, highlights and tags, so only those take a hue
and the rest are told apart by weight, slope, face and ground:

| construct | how it reads |
| --- | --- |
| bold | heavier, in the ink colour |
| italic | slanted, in the ink colour |
| tag | the accent, on the accent's wash |
| link and wikilink | the link colour, underlined |
| inline code | monospaced, a softer ink on the inset ground |
| highlight | the mark wash under the ink colour |
| strikethrough | struck through, in the muted colour |

A link and a tag are the two that take the accent colour: both lead somewhere
else, a link to its note and a tag to the notes that share it.

## An embed is a note, read only

`![[note]]` draws another note where the line was, and `![[note#heading]]` one
section of it. [Embed format](/reference/embed-format.md) states every form and
what each draws; this section says why it is built the way it is.

**The box is the same rendering, nested.** The embed mounts a second editor
inside the first, read only, with this live preview in it. A note drawn by
anything else, a markdown library turned to HTML say, would bold, link and tag
by rules of its own, and the same note would read one way in its pane and
another inside the box. One renderer keeps the two the same, and every
construct this page covers works in an embed with no code added for it. The
frontmatter block is left out because it is the note's record of itself and not
what you embed a note to read.

**It is a widget that hides its source, as a picture is.** The box stands in for
the `![[...]]` the way an image stands in for its `![](...)`, so it follows the
same reveal rule: the line comes back as source in insert or visual mode with
the cursor on it, or with vim off whenever the cursor is there, and the
cursor-walking filter keeps the cursor out of the hidden brackets the rest of
the time. Editing in place was left out. Text typed into the box would belong
to another note, with its own save and its own conflicts, and opening that note
is one gesture away.

**A pdf is drawn by pdf.js, not by the browser.** `![[plan.pdf]]` draws the
pages onto canvases in a box that scrolls. An `<iframe>` would have been less
code, but a phone browser draws no pdf in a frame: Android Chrome shows a
button that downloads it. pdf.js is the copy the book reader already ships, and
it draws only the pages scrolled into view, so a long pdf costs the pages you
read. `![[plan.pdf#page=3]]` sets the box's own scroll so page 3 is at its top,
and so page 3 is the one drawn. It does not use `scrollIntoView`, which
scrolls every box around the page as well and would jump the note you are
editing. The browser keeps a scroll in pixels, so when the box changes width,
or is hidden and shown, the box scrolls back to the page that was at its top.

**A depth cap, not a cycle check.** A note that embeds itself, or two notes that
embed each other, would draw without end. Tracking the paths on the way down
would stop the loop, but not a long honest chain, each level of which mounts
another editor and reads another note. A cap at three stops both, and needs only
a number passed down rather than a list. Past it the embed draws a stub.

**The click needs Ctrl or a tap, as a wikilink's does.** A plain click on a line
is how the cursor gets there, and the cursor on the line is how the source
comes back. If a plain click opened the note, the `![[...]]` could only be
reached with the keys. So the gesture is the one a wikilink already answers to:
Ctrl+click or Cmd+click with a mouse, a tap with a finger.

**The embed listens to its note.** The decorations are rebuilt when the
document being edited changes, and the embedded note is not that document. An
agent's write, an edit in another pane or a save changes it without touching
this one, so a box built once with the decorations would go stale and stay
that way. Instead each box watches its note and redraws itself when the note
changes, whatever changed it.

**An edit keeps the box.** CodeMirror gives the parse after each edit 20ms. On
a loaded machine it can run out, and a drawing built from the tree as it then
stands would stop where the tree does: every embed past that point would lose
its box, its nested view and its watch, and draw again from nothing when the
parse lands. So past that point the old drawing stays, moved through the edit,
until the parse lands and the decorations are rebuilt. Only what the edit
touched, and the lines a cursor sits on, show their source in the meantime.

The finder's preview pane is the exception. It is told nothing about how to
read the vault, so it shows `![[...]]` as source rather than calling every
target missing.
