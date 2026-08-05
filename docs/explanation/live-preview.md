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

## What it does not render

Tables, images and fenced code blocks keep their syntax. All three need widget
decorations, which means DOM this code owns and rebuilds as you type, and images
would additionally need an endpoint that serves files out of the vault. None of
that exists yet. Wikilinks are not rendered either, because the app does not have
them at all; see [The vault and the derived index](vault-and-derived-index.md)
for what does and does not live in the database.
