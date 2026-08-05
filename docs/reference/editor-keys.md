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
| `<leader>e` | Move the focus to the file tree |
| `<leader>p` | Turn live preview off, or back on |
| `<leader>q` | Write the note and close it |
| `<leader>?` | Show every binding on this page, in the app |

`<leader>e` unfolds the tree first if it was folded away, and lands on the row
the tree cursor is already on. Escape in the tree comes back to the editor.

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

## Backticks

A backtick closes itself, the way a bracket and a quote already did. Markdown
ships no bracket list of its own, so the editor was using the default set from
`@codemirror/autocomplete`, and a backtick was not in it.

| Typed | You get |
| --- | --- |
| `` ` `` | `` `` `` with the cursor between the pair |
| `` `` `` | The cursor steps over the closing one |
| ``` ``` ``` | A whole fenced block, with the cursor on the empty line inside |

The third backtick is handled separately, because closing brackets alone would
leave four of them on the line: one pair from the first keystroke, the second
stepping over it, and the third opening a pair of its own. It only fires when
the line holds the pair and nothing else, so a backtick typed mid-sentence
still just opens a pair.

## Indenting

| Key | Does |
| --- | --- |
| Tab | Indent the line, which nests a list item under the one above |
| Shift+Tab | Lift the line back out |

Both act on the line rather than the cursor, so the indent goes in at the front
of the line wherever in it you are pressing the key. CodeMirror leaves Tab
unbound by default so the key can move the focus out of the editor. Binding it
takes that away, which is what `<leader>e` is for.

The unit is two spaces. Neither key is a list key: they indent a plain line the
same way, and an ordered list the same way as a bulleted one.

## The file tree

These apply while the tree holds the focus. `<leader>e` reaches the row the
cursor is on, and these keys move it from there.

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
