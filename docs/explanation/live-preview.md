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

Two decisions in that behaviour are worth the explanation, because both were
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
