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

Each part has a page of its own:

* [Cursor and marks in live preview](/explanation/live-preview/cursor-and-marks.md): why the vim mode decides what shows as source, why the cursor never rests on hidden text, why a drawn marker leaves with its text, and why the gutter counts from the cursor
* [The three blocks in live preview](/explanation/live-preview/the-three-blocks.md): why an image, a code block, a table, a diagram and a math block flip whole, and why the cursor decides for them
* [Tags, colour and embeds in live preview](/explanation/live-preview/embeds-and-the-rest.md): why a tag has no mark to hide, why each inline construct has its own colour, and why an embed is a read-only note

