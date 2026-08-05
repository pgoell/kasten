---
type: Reference
title: Editor keys
description: Every keyboard binding kasten adds, and the mode each one applies in.
resource: frontend/src/lib/key-bindings.ts
tags: [editor, keyboard, vim, frontend]
status: stable
---

# Editor keys

The editor runs vim. Everything on this page is what kasten adds on top of it;
every vim binding not listed here still does what vim does.

`frontend/src/lib/key-bindings.ts` holds these bindings as one table, and both
the registrations and the `<leader>?` panel are built from it. A test fails if
that table names a command the app does not provide.

## Leader

The leader is the space bar, in normal mode. Vim ships `<Space>` bound to `l`,
and kasten unmaps it so a sequence can begin there. Visual mode keeps
move-right, because the leader is registered in normal mode only.

| Key | Does |
| --- | --- |
| `<leader>b` | Fold the file tree away, or bring it back |
| `<leader>p` | Turn live preview off, or back on |
| `<leader>q` | Write the note and close it |
| `<leader>?` | Show every binding on this page, in the app |

`<leader>q` closes the note only once the vault holds the text. A write that
fails leaves the note open with the warning in the status bar, because closing
unmounts the editor and the only copy of the edit would go with it.

`<leader>p` and `<leader>b` keep their setting while you move between notes,
and start again from on and open when you reload the page.

## Formatting

These apply in insert and visual mode. Vim owns all four in normal mode, where
they page up, walk the jump list, and decrement a number, and they keep doing
that. The bindings carry a mode and vim's own do not, which is what leaves
normal mode alone.

| Key | Does |
| --- | --- |
| Ctrl+B | `**bold**` |
| Ctrl+I | `*italic*` |
| Ctrl+Shift+H | `==highlight==` |
| Ctrl+Shift+X | `~~strikethrough~~` |

Each one toggles. With text selected it wraps the selection. With nothing
selected it wraps the word under the cursor. With the cursor already inside the
marks it removes them. On a blank line it opens an empty pair and leaves the
cursor between the halves. Used in visual mode, it returns to normal mode
afterwards, the way an operator does.

Highlight sits on Ctrl+Shift+H rather than Ctrl+H, which Chrome spends on its
history window.

`==highlight==` is not part of any markdown flavour kasten loads, so
`frontend/src/lib/markdown-highlight.ts` adds it to the parser. A delimiter
opens only when a non-space follows it and closes only when a non-space
precedes it, which keeps `a == b` out of it.

## The file tree

These apply while the tree holds the focus. Tab reaches the row the cursor is
on, and these keys move it from there.

| Key | Does |
| --- | --- |
| `j` / `k` | Move the cursor down or up |
| `h` | Collapse the folder, or go to its parent |
| `l` | Expand the folder, or open the note |
| Enter | Open the note under the cursor |
| `gg` / `G` | Go to the first or last row |
| `q` | Close the file tree |
| Escape | Back to the editor |

Leader sequences work here too, so `<leader>b` closes the tree from inside it.

## Saving

| Key | Does | Mode |
| --- | --- | --- |
| `:w` | Write the note | normal |
| Ctrl+S | Write the note | any |

Neither is new to this page. Writing also happens on its own, about a second
after you stop typing.
