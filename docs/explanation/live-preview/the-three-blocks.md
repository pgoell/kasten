---
type: Explanation
title: The three blocks in live preview
description: Why an image, a fenced code block, a table, a diagram and a math block are drawn as whole blocks, and why the cursor rather than the mode decides when they show their source.
tags: [design, editor, frontend, vim]
status: stable
---

# Three blocks in live preview

## The three blocks

Everything above is one rule read three ways: find the mark, hide it, style
what it wrapped. Three blocks answer to something else, and each for its own
reason.

An image is drawn, and it is the one widget here that loads something. That is
what it cost to render: [GET /api/assets/{path}](/reference/http-api.md) already
served books, so a picture only needed a suffix added to it, and the widget asks
for the line to be measured again when the bytes land, the height of an image
being unknown until then. A tap or click on a picture puts the cursor on it,
as a click on text does; the browser puts no caret on a picture, so the widget
does it. A picture inside a link, `[![alt](cat.png)](https://example.com)`,
follows the link in a new tab instead, as a tap on the link's text does, unless
the cursor already sits in the link. An `https:` address is drawn too, since a clipped
article links its pictures rather than holding them; the page's own policy
allows images from `https:` and sends no referrer, so the host never learns
which note asked. Any other address stays as its source. A reference image,
`![alt][label]`, `![alt][]` or `![alt]`, finds its address in a
`[label]: url` definition the way a reference link does, and then draws as
`![alt](url)` would. Any address loses its backslash escapes before it is
drawn, opened or copied, and one in angle brackets, `<x.png>`, loses the
brackets too, as CommonMark reads it. The parser kasten uses ends `<…>` at the
first `>`, escaped or not, so `frontend/patches/` carries a fix to it; a bump
of `@lezer/markdown` needs that patch made again with `bun patch`.

CommonMark ends a bare address at a space, so it reads
`![shot](99 Misc/shot.png)` as `![shot]` and some text. Obsidian draws the picture, and so does kasten: when
an image ending in `]` has a `(` straight after it, the address runs from there
to the first `)` on the line, spaces kept. A title after a space is not read.
The backslash escapes come off, each space becomes `%20`, and the rest goes
through the same checks as any address, so a script address stays as typed.
The parens win over a definition of the alt text. Copy as still reads the line
as CommonMark does. A reference image whose label nothing defines stays as
typed, and in the colour of the words around it, as a `[text]` does.

The same brackets around a YouTube address draw the player instead, `videoId`
in `video.ts` reading the address the pane already reads. It is the second
widget that loads something, and the only one that keeps running after it is
drawn, which is why it is compared by video id rather than by its URL: the
position a note remembers is written into the note while you watch, so a widget
compared by the `start=` it was built with would be a new widget on every write
and would remount the frame under a video that is playing.

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
ask for, and the pipes are off the screen entirely. An `![](path)` in a cell
draws as its picture, so two images in one row stand side by side, and so does
an `![[x.png]]` the vault holds, at the width its alias asks for. The cell asks
the same helper the line does for that picture, so `![[x.png\|200]]` in a cell
and `![[x.png|200]]` on a line come out the same size. A picture wrapped in a
link or in emphasis draws too: what sits between the marks is cut the way a
cell is, so `**word ![](a.png)**` is bold text and the picture. A tap or click
in a cell opens the table, except where it follows a link as it would outside
one: a tap on a link's text or picture, Ctrl+click on its text, any click on
its picture. A `[[wikilink]]` in a cell follows on a tap or Ctrl+click and
opens its note, alias and heading read as they are outside a table. Each link
in a cell opens its own target, never the one the table starts with. A sound or a video in
a cell stays its source, and so do an address that cannot load, a picture the
vault lacks, and an embedded note or pdf, which would be a page inside a table.
A `\|` in a code span in a cell reads `|`, as GFM says, though a code span keeps
every other escape as written. A
table wider than the pane scrolls sideways inside its own block, and the note
stays as wide as the pane. Put the cursor in it and the
whole block comes back as source, in the monospaced face, with every mark in the
cells on screen.

Two things there are the table's own rule, shared only with the other drawn
blocks below. The block flips
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
keys write it into the note, which [Tables](/reference/editor-keys/editing.md#tables)
covers.

The cells are cut for the widget out of the syntax tree rather than out of the
text, so a cell wears the same colours a paragraph does and a tag in one gets
its pill back, the alignment being the grid's job now rather than the character
count's. The columns are counted off the walls and not off the cells: an empty
cell is no node at all, so `| a |  | c |` read by its cells is two columns and
read by its walls is the three it says. A table indented into a list item is
left as source, a block widget having to cover whole lines.

Where the table stops is the rendering's reading and not the parser's. GFM ends
a table at a blank line, so a paragraph written straight under one parses as
rows of a single cell, and drawing what the parser handed back put two lines of
prose in the first column. A row is a line carrying a `|`, which is the reading
`tableAt` already walks a table by, and the first line without one ends it. The
widget stands in for the rows alone; the walk goes on into the prose below them
and renders it as prose.

A pane with no cursor in it never shows the source. The finder, search and the
review pane all mount this rendering read only, and their selection sits at
offset zero because nothing has moved it, so a note or a flashcard that opens
with a table would otherwise be a pane full of pipes. The read-only facet is
what tells the two apart, `EditorView.editable` being a view-level thing this
code cannot see.

A ```` ```mermaid ```` block and a `$$` math block are drawn by the table's
rule, and for the table's reasons. Each is one block widget standing in for
its lines, a diagram or a formula, so `j` and `k` step over it the same way and
only the cursor arriving by position can open it; half a diagram drawn and half
of it source would be neither, as with a table. Inline `$x$` is a construct
inside a line, so it reveals by the mode like bold does.
[Math and diagrams](/reference/math-and-diagrams.md) states the syntax, the
errors and where each one is drawn.
