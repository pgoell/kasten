---
type: Reference
title: Editor keys, editing text
description: Formatting, copying, tables, backticks and indenting in the editor, and the keys that take them.
tags: [editor, keyboard, formatting, tables, frontend]
status: stable
---

# Editing text

## Formatting

These apply in insert and visual mode, and everywhere with
[vim off](/reference/editor-keys.md#vim-on-or-off). Vim owns all four in normal mode, where
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

On screen the marks are hidden and the formatting is what you see. They come
back one construct at a time, while the cursor is inside that construct and in
insert or visual mode, so editing one word on a line leaves every other bold,
italic, strikethrough, inline code, highlight, link and wikilink on it rendered.
A heading, a bullet, a todo's box and a blockquote's bar reveal by the line
instead, their mark sitting at the head of it.

`<leader>=` is the other formatting key, and it takes the whole note rather than
one word. It cuts the trailing whitespace off every line, collapses a run of
blank lines to one, puts a blank line in front of a heading that has none,
writes a `*` or `+` bullet as a `-`, and lines up the columns of every table,
which [Tables](#tables) covers. It steps over two things untouched: the
frontmatter, which is YAML and not markdown, and anything between code fences,
which holds whatever it holds. Nothing else in the note moves, there is no
rewrapping and no renumbering, and the cursor stays where it was. `=` is vim's
own key for putting the formatting right; the other one, `gq`, is spent on the
quarter's note.

`==highlight==` is not part of any markdown flavour kasten loads, so
`frontend/src/lib/markdown-highlight.ts` adds it to the parser. A delimiter
opens only when a non-space follows it and closes only when a non-space
precedes it, which keeps `a == b` out of it.

## Copying

With vim on, every yank also writes the system clipboard, the way vim's
`clipboard=unnamedplus` does, so `yy`, `yiw` or a visual `y` in a note and
Ctrl+V in another window move the same text. `"_y` still writes nowhere, and
`"+y` writes the clipboard once rather than twice. A delete or a change stays in
vim's registers. Ctrl+C copies the selection too. Both take the markdown as it
sits in the file, marks included, whatever the screen shows.

`:copy` rewrites the markdown for where it is going before it writes the
clipboard.

| Command | Writes |
| --- | --- |
| `:copy` or `:copy md` | the markdown as it is |
| `:copy slack` | text in Slack's markup |
| `:copy teams` | HTML, with the markdown beside it as plain text |

Typed from visual mode, which fills in `'<,'>`, it takes the selection to the
character; from visual line mode, the whole lines. A range typed by hand, such
as `:3,9copy slack`, takes those lines. With no range it takes the whole note.
The frontmatter is never part of it.

Slack reads its markup out of text when the message is sent, so `:copy slack`
writes `*bold*`, `_italic_`, `~struck~` and code in backticks. A heading becomes
a bold line, a bullet becomes `•`, a todo's box becomes `☐` or `☑`, and a code
fence loses its language, which Slack would print as the first line of the code.
A link becomes its label with the address after it in brackets; Slack's
`<url|label>` works only for messages sent through its API. A table goes in a
code block, which keeps its columns lined up.

Teams reads no markup out of text but keeps the formatting of pasted HTML, so
`:copy teams` writes headings, lists, links, code and tables as HTML.

In both, a wikilink becomes the name of the note and a highlight becomes its
text. The status bar says `Copied for Slack`, or why nothing was copied.
`frontend/src/lib/copy-as.ts` does the rewriting, walking the parse the editor
renders from.

## Tables

| Key | Does |
| --- | --- |
| Tab | Go to the next cell, and line the table up on the way |
| Shift+Tab | Go to the cell before |
| `<leader>=` | Line up every table in the note |

A table is written the way GFM writes one, a row of cells between pipes with a
row of dashes under the head. This is one after `<leader>=`, which is what the
key does to whatever shape you typed:

| Language   |   Runs on    |             Notes |
| :--------- | :----------: | ----------------: |
| Python     | the backend  |     typed with ty |
| TypeScript | the frontend | vim in the editor |

Lining it up pads every cell to the widest one in its column and squares the
dashes off to match, so the source reads as the table it is. A column is at
least three characters wide, that being the narrowest legal row of dashes. The
dashes also say which side of its column the text sits on, `:---` left, `---:`
right and `:---:` centred, and the padding obeys them.

Nothing is thrown away. A row carrying more cells than the dashes do grows the
table a column rather than losing what it says, and the walls a row left off its
two ends are written in. A `\|` inside a cell is a pipe and not a wall, and
stays one.

Tab walks the cells left to right and down the rows, stepping over the row of
dashes, which is nobody's cell. Shift+Tab walks back the same way. Tab in the
last cell of the last row writes an empty row and lands in it, which is how a
table grows a line. Shift+Tab in the very first cell does nothing here and
lifts the line out the way it does everywhere else, and so does either key
outside a table. Each press lines the table up first, so a cell you have just
typed into is squared before you leave it. A table already square is a move and
not an edit: no undo step and nothing written to disk.

A table you type into is lined up for you as well, once you are done with it:
when the cursor leaves the table, and when the note is saved (`:w`, ctrl+s).
Only a table you edited since the note opened is touched. A ragged table you
only read, or one in a note you open and save, is written back as it was, and
so is a table in a fence, a quote or a list item. The line-up changes padding
and nothing else: the text of each cell, a `\|`, the colons in the dashes and
every character stay as written. Width counts one per character (one code
point), so a CJK character or an emoji counts one, though it draws two wide. The
line-up is an undo step of its own: `u` or ctrl+z puts the ragged text back and
keeps what you typed, and it stays ragged until you edit the table again.

On screen a table is drawn as a table: sans at 13 px, a strong rule above the
head row and hairlines between the rows, and each column's text on the side its
dashes ask for. A column whose filled cells are all numbers sits on the right in
figures of one width; an empty cell shows a dash, which is drawn and never
written; a cell that reads as an id or a code name (`WH-07`, `us-east-1`) is set
in mono. A line that starts `Table: ` straight under the last row is the table's
caption, drawn small and muted under it with the `Table: ` hidden. A table wider
than the pane scrolls sideways in its own box, with the first column held at
the left and a soft shadow at the edge that has more to show; a table taller than
70 % of the window scrolls down in its box under its head row. On a pane under
776 px wide, a phone, the cells do not wrap and the table scrolls instead. In
Edit a table shows as its source in the monospaced face, with the cursor's row
marked, and going back to Read keeps the line at the top of the pane where it
was.

The cursor in a drawn table is what
shows the source, in any mode, and the whole block comes back at once, in the
monospaced face, because columns lined up by counting characters only stay lined
up where every character is one width. In that source a table keeps all of its
marks: a cell holding `**bold**` or a `[[link]]` shows them, coloured, since
hiding two characters would shorten the cell by two and pull the column out of
true.

`j` and `k` step over a drawn table rather than into it, which is the quick way
past a long one. To get in, use a key that moves by position rather than by what
is on the screen, `w`, `/`, a line jump, or click the table. A table indented
into a list item is drawn as source throughout.

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

On screen a fenced block is a shaded surface in the monospaced face, with its
backticks and its language off the screen. The cursor anywhere in the block
hands them back, in insert or visual mode, and the whole block shows them at
once rather than the cursor's line alone: a hidden fence line is a line the
cursor cannot reach. A block with nothing between its fences keeps them, which
is the block a third backtick writes, so the backticks are there while you type
the first line into it.

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

In a table both keys mean something else, which [Tables](#tables) covers.
