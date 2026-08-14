---
type: Explanation
title: Live preview and the vim mode
description: Why the editor renders markdown in normal mode and shows you the source in insert mode.
tags: [design, editor, frontend, vim]
status: stable
---

# Live preview and the vim mode

The editor renders markdown where you type it. A heading is large and has no
hashes in front of it, bold text is bold and carries no asterisks. Press `i` and
the line under the cursor turns back into the markdown you wrote.

Three decisions in that behaviour are worth the explanation, because each was
picked over an option that looks more obvious.

## The mode decides, not the cursor

Obsidian reveals the line the cursor sits on, whatever you are doing. kasten
reveals on the vim mode instead:

| mode | what you see |
| --- | --- |
| normal | rendered |
| replace | rendered |
| insert | the cursor's line, and the construct it is in, as raw markdown |
| visual | the cursor's line, and the construct it is in, as raw markdown |

The mode says whether anything reveals. What reveals then depends on the
construct. A heading, a bullet, a todo's box and a blockquote's bar are the
line: their mark sits at the head of it, so the line is the thing that comes
back. The inline constructs, bold and italic and strikethrough and inline code
and a highlight, a link and a wikilink, come back one at a time, and only the
one the cursor is inside. A line of prose can carry a dozen of them, and
unmasking all twelve to edit one word puts asterisks and tildes across the line
you are reading while you write it.

The reason is that the two modes already mean something, and it is the same
something. Normal mode is for reading and moving around, insert mode is for
writing. Rendering follows that split rather than cutting across it, so the
editor has two states instead of three, and you already know which one you are
in from the mode you chose.

Visual mode reveals for a narrower reason. You are about to act on a stretch of
text, and the highlight would otherwise cover ranges you cannot see, so `y`
would copy asterisks that were never on the screen.

A mode the code does not recognise renders. If vim grows a submode nobody here
thought about, it hides its marks rather than leaking them.

A table is the exception to the whole of this section: it flips on the cursor
being in it and on no mode at all, and it flips as a block rather than a line.
[The three blocks](#the-three-blocks) says why it had to.

One construct is a mark the rendering has to leave alone. `- [/] task` parses
its box as a link, brackets and all, and the bullet already hides that box and
draws a symbol in its place. Two renderings of the same three characters can
only disagree, so the link rendering stands down where a todo's box begins.

## The cursor never rests on a character you cannot see

Hiding text creates a problem that colouring it does not. The hashes in `## Notes`
are still in the file at offsets 0, 1 and 2. Press `0` in normal mode and, left
alone, the cursor lands on offset 0 and `x` deletes a hash nobody can see.

CodeMirror has a facet for this, `EditorView.atomicRanges`, and the vim package
does not use it. The string does not appear once in either the adapter or the
7000 line core, and its `moveH` moves the cursor by adding to an offset. So
kasten walks the cursor out of hidden text itself, in a transaction filter, using
the same shape as CodeMirror's own `skipAtomicRanges` with one rule tightened.
CodeMirror lets the cursor rest on either edge of an atomic range because both
edges paint in the same place. That is fine for moving and wrong for editing, so
here only the far edge is a landing spot.

The filter is also why the decorations live in a `StateField` rather than the
`ViewPlugin` that CodeMirror's documentation reaches for first. A transaction
filter runs at state level and can only read state. Decorations in a view plugin
would be invisible to it, and the filter would have nothing to consult.

## A drawn marker leaves with the text it stands in for

Blockquotes and list items both hide their mark and draw a replacement in CSS,
and the two part company as soon as a line is revealed.

A blockquote draws a bar down the left edge. It stands in for nothing, so it can
stay while the `>` is back on screen, and the line keeps its shape as you type.

A bullet draws a dot where the `-` used to be. Leave that dot in place while the
line is revealed and the line carries two bullets, one real and one drawn. So
the whole decoration goes and the revealed line renders as plain text.

A horizontal rule goes the same way as the bullet. `---` on a line of its own is
hidden and a line is painted across the row instead, and both the painting and
the hiding stop while you are editing it. `---` directly under a paragraph is a
setext heading rather than a rule, and the parser has already told the two
apart, so nothing here has to.

The indent works the same way. The spaces that nest a list item are hidden along
with the dash, which leaves nothing in the text carrying the nesting, so the
padding is computed from how many lists the item sits inside. An ordered list is
left alone throughout: its number is content rather than decoration, and hiding
`1.` would lose which item it was.

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
easy to confuse with each other. So each inline construct takes a colour of the
One Dark palette, and no two share one:

| construct | how it reads |
| --- | --- |
| bold | heavier, and lifted off the body colour |
| italic | slanted, in orange |
| tag | purple, on a wash of itself |
| link and wikilink | blue, underlined |
| inline code | green, monospaced, on the panel colour |
| highlight | a yellow wash under the body colour |
| strikethrough | struck through, in the muted colour |

Bold is the one that takes no hue. It is the same words said louder rather than
a different kind of word, so it brightens instead.

## The mode arrives one microtask late

Vim keeps its mode on `cm.state.vim.mode`, a mutable property hanging off the
view, so state-level code cannot see it. A small view plugin turns each
`vim-mode-change` event into a `StateEffect`, and it waits for a microtask
before dispatching one.

That wait is load bearing. Leaving visual mode announces the change from inside
vim's own dispatch, because `exitVisualMode` moves the cursor before it says
anything. Answering an event raised in there by dispatching again re-enters the
update, CodeMirror responds by killing the plugin that did it, and the plugin it
kills is vim's own: the editor is left with no vim at all and no way back to
normal mode. The vim package defers out of its own event handlers the same way.

The cost is that the reveal lands a microtask after the keystroke rather than in
the same tick. Microtasks run before the browser paints, so nothing flickers,
but a test that presses `i` and reads the text on the next line will read it too
early. The tests wait.

## What that costs

Two consequences follow, and neither is worth code to work around at the size a
note reaches.

**The whole document is decorated on every change**, not just the part on the
screen, because a state field cannot know what the viewport is. A note would have
to grow far past anything you would want to read in one page before this is
felt.

**A counted motion can land short.** `3l` asks vim to move three characters, vim
counts them in the raw text, and the filter then walks the result out of any
hidden run. Three characters of markdown are not always three characters of
prose, so the cursor sometimes stops earlier than the count suggests.

## The gutter counts from the cursor

The line numbers are vim's `number relativenumber`: the line the cursor sits on
carries its own number and every other line carries its distance from it. That
is the number the keys want. `10j`, `d5k` and `>3j` all take a count, and
reading it off the gutter beats counting rows.

CodeMirror's `lineNumbers` takes the formatter, so the whole change is one, but
it redraws only when something else tells the gutter to. That something is
`highlightActiveLineGutter`, which moves its marker when the cursor changes
line, which is exactly when these numbers change. Both come from `basicSetup`,
so dropping the highlight would freeze the counting.

## The three blocks

Everything above is one rule read three ways: find the mark, hide it, style
what it wrapped. Three blocks answer to something else, and each for its own
reason.

An image is drawn, and it is the one widget here that loads something. That is
what it cost to render: [GET /api/assets/{path}](/reference/http-api.md) already
served books, so a picture only needed a suffix added to it, and the widget asks
for the line to be measured again when the bytes land, the height of an image
being unknown until then. A path pointing anywhere but the vault stays as its
source, the page's own policy allowing images from this origin alone.

A fenced code block needs none of that. Every line of it takes a line
decoration, which paints the block's surface and sets it in the monospaced
face, and the highlighting inside comes from whichever parser the language
named. The backticks and the language go the way every other mark does, the
surface saying where the block starts and ends better than they did, and the
code between them is left alone: it is not prose that marks would clutter.

The two fence lines are hidden whole, each with the line break that keeps it off
the code, so the block ends on a line of code rather than on a blank row. That
is the one place here where a hidden run crosses a line break, and CodeMirror
draws the pair it joins as one line wearing the upper one's class, which is why
the bottom of the surface hangs on the last line of code and, in a block of a
single line, on the opening fence.

The cursor anywhere in the block hands the fences back, and not the cursor's
line the way the rest of the rendering works. A hidden fence line is a line the
cursor cannot reach, so a rule waiting for it to arrive there would never fire.
A block with no code between its fences keeps them for the same reason: hiding
both would leave no line on the screen to put the cursor back on, and the two
hidden runs would meet inside the one line break they share. That is the state a
third backtick writes, so it is the state you are looking at while you type the
first line of code into it.

A table is drawn as a table. One widget stands in for every line of it, a real
`<table>` with a head row, borders and each column's text on the side its dashes
ask for, and the pipes are off the screen entirely. Put the cursor in it and the
whole block comes back as source, in the monospaced face, with every mark in the
cells on screen.

Two things there are the table's own rule and nothing else's. The block flips
whole rather than a line at a time, because half a table drawn and half of it in
pipes is neither. And the cursor decides rather than the mode, which is the
opposite of everything above. `j` and `k` move by what is on the screen, and to
CodeMirror a block widget is one thing rather than the five lines it stands for,
so both keys step clean over a table and neither can put the cursor in one.
Waiting for insert mode would leave a table nothing could open. What does reach
in moves by document position: `w`, a search, a line jump, and a click on the
table, which is why the widget takes mouse events rather than swallowing them.

While it is showing its source nothing in a cell is hidden: a `[[link]]` whose
brackets came off the screen would be four characters narrower than the column
it was padded to, and every wall to its right would step left. So the source
shows `**bold**` and `[[link]]`, in the bold and the link colour, and the
columns hold. The padding itself is not live preview's: `<leader>=` and the tab
keys write it into the note, which [Tables](/reference/editor-keys.md#tables)
covers.

The cells are cut for the widget out of the syntax tree rather than out of the
text, so a cell wears the same colours a paragraph does and a tag in one gets
its pill back, the alignment being the grid's job now rather than the character
count's. The columns are counted off the walls and not off the cells: an empty
cell is no node at all, so `| a |  | c |` read by its cells is two columns and
read by its walls is the three it says. A table indented into a list item is
left as source, a block widget having to cover whole lines.

A pane with no cursor in it never shows the source. The finder, search and the
review pane all mount this rendering read only, and their selection sits at
offset zero because nothing has moved it, so a note or a flashcard that opens
with a table would otherwise be a pane full of pipes. The read-only facet is
what tells the two apart, `EditorView.editable` being a view-level thing this
code cannot see.
