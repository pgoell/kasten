---
type: Explanation
title: Cursor and marks in live preview
description: Why the vim mode, not the cursor, decides what shows as source, why the cursor never rests on hidden text, why a drawn marker leaves with its text, and why the gutter counts from the cursor.
tags: [design, editor, frontend, vim]
status: stable
---

# Cursor and marks in live preview

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
you are reading while you write it. A [callout](/reference/callout-format.md)
comes back whole, the way a fenced code block does: its box is drawn over every
line of it, so the cursor anywhere inside hands back every `>` and the
`[!type]` line.

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

With vim off there is no mode to go by, and the editor reads as insert mode
throughout. Typing is all a plain editor does, so the line under the cursor
always shows its source and every other line renders. The reading state is
lost, and that is the price of an editor a finger can use: an on-screen
keyboard has no Escape to get back to it. The gutter counts from the top there,
a distance from the cursor being a number only a counted motion wants.

A table, a mermaid diagram, a `$$` math block and an inline `<svg>` block are
the exception to the whole of this section: each flips on the cursor being in
it and on no mode at all, and each flips as a block rather than a line.
[The three blocks](/explanation/live-preview/the-three-blocks.md) says why they had to.

One construct is a mark the rendering has to leave alone. `- [/] task` parses
its box as a link, brackets and all, and the bullet already hides that box and
draws a symbol in its place. Two renderings of the same three characters can
only disagree, so the link rendering stands down where a todo's box begins.

The parser reads every `[text]` as a link, with or without an address. A
reference link, `[text]`, `[text][]` or `[text][label]`, draws as a link when
the note holds a definition `[label]: url` that starts a block of its own,
anywhere in the note but a code block, the label matched without regard to
case. It then draws, opens and copies as `[text](url)` does, through the same
code: kasten has one link rendering, and a reference link only finds its
address elsewhere. A label opening with `^` is a footnote and never a link. The
definition line stays as typed, as Obsidian's live preview shows it, and Copy
as leaves it out. A `[text]` whose label nothing defines stays as typed,
brackets and all, as Obsidian shows it, and Copy as keeps the brackets too.
Such text draws plain, with no link colour or underline, so in bold or a
heading it looks like the words around it. The highlighter still colours the
node as a link, so a mark over it takes that look back off (#441).

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

The filter walks a cursor and leaves a selection where it is. Vim reads what a
yank takes by selecting it, `yy` from column zero of the line, and a selection
walked out of the hidden `## ` yanked the heading as `Notes`. A selection made
in visual mode needs no walking either, because it reveals the marks it covers.

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
