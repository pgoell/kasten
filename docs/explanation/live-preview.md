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
| insert | the cursor's line as raw markdown |
| visual | the cursor's line as raw markdown |

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
named. Nothing in a fence is hidden: the backticks and the language are part of
what the block says, and the code inside is not prose that marks would clutter.

A table is the fence's argument taken one step further. It gets the same
treatment, a line decoration per line and the monospaced face, because its
columns are lined up by counting characters and only a face of one width keeps
them lined up. But a table's cells hold prose, and prose holds marks, so the
walk goes on into them and colours what it finds while hiding none of it: a
`[[link]]` in a cell whose brackets came off the screen would be four
characters narrower than the column it was padded to, and every wall to its
right would step left. So a cell shows `**bold**` and `[[link]]`, in the bold
and the link colour, and the columns hold. The padding itself is not live
preview's: `<leader>=` and the tab keys write it into the note, which
[Tables](/reference/editor-keys.md#tables) covers.

There is still no widget drawing a real table, and that is the trade this makes.
A widget means DOM this code owns and rebuilds as you type, and a table you
cannot type into is worse than the pipes. What is here instead is the pipes,
made to read as a table.
