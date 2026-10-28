---
type: Reference
title: Editor keys, panes and tabs
description: How panes, splits, tabs, the history pane, the graph pane and the pdf pane answer the keys.
tags: [editor, keyboard, panes, tabs, frontend]
status: stable
---

# Panes, tabs and views

## Panes and tabs

The window divides the way tmux divides a terminal. A tab holds panes, a pane
holds one note, one terminal or the todo list, and every key above applies to
the pane that has the focus.

`<leader>%` and `<leader>"` are tmux's own split keys, and the shape of each
character says which way the pane divides: `%` sets the new pane beside this
one, `"` puts it underneath. Both make the pane empty and move to it, so a
split is followed by `<leader>ff` or the file tree to say what goes in it.

Splitting the same way twice gives even thirds rather than a half and two
quarters. The panes of one split are one row or one column of any number, not a
pair, and a split made inside a split dividing the same way joins it instead of
nesting in it.

`<leader>h`, `<leader>j`, `<leader>k` and `<leader>l` move to the pane in that
direction, and stand still at the edge of the window. `<leader>o` moves to the
next pane instead and wraps at the end, so repeating it reaches every pane of
the tab where a direction stops. Clicking into a pane moves the focus there
too, and so does `gf` following a link into one.

Which pane is left of this one is a question about rectangles on screen rather
than about the tree the panes are laid out from, so the directions are answered
against the panes' boxes. The tree cannot answer it. Four panes in a square are
`row[col[A,C], col[B,D]]`, and walking that rightward out of C steps up to the
row, across to the second column and down to its first pane, which is B. B is
diagonally across from C. D is the one beside it, and D is where `<leader>l`
goes. This is the same thing vim and tmux do, and for the same reason.

Moving right out of the bottom half of the window arrives in the bottom half.
Where two panes are equally close, the upper or the left one wins.

`<leader>H`, `<leader>J`, `<leader>K` and `<leader>L` swap this pane with the
one in that direction instead of moving to it. Vim spells the pair the same
way, `<C-w>h` going to a window and `<C-w>H` moving one, and so does hyprland.
The two panes trade places and each keeps what it holds, so the focus does not
move: after the swap you are in the same pane, further left. The divisions
themselves do not change, only which pane sits in which of them, and at the
edge of the window nothing happens.

Every pane keeps what it holds through a split, a close or a swap, however the
panes divide: its cursor, its undo history and the text not yet written. A
split inside a split the other way, or a close that folds a split back into its
row, is no different from a split of the tab's only pane (#932, #935).

A swap moves each pane to the other's place, and each keeps what it holds, the
focus following the pane. A book, a video and an HTML page are the exception,
being frames of their own that the browser reloads when they move: the reader
comes back to the page it recorded and the player to the second the note names.

`<leader>z` draws the focused pane over the whole window, and a second press
puts the tab back. It is tmux's own zoom key and hyprland's fullscreen. Nothing
is closed: the other panes are still there holding what they held, a line not
yet written still waiting to be saved, a terminal still attached, a video still
playing. The footer says `zoom` while it is on. Any key that moves the focus
turns it off, which is what tmux does, so `<leader>o` moves to the next pane
and unzooms in one press. The four directions have nowhere to go while it is
on, one pane being all there is on screen.

A window narrower than 768px stacks the panes of a split, top and bottom,
whichever way the split divides. While the on-screen keyboard is up, only the
focused pane shows, at full height, and the rest hold what they held. The
splits are kept, so they are side by side again when the window widens.
`<leader>o` moves to the next pane there. The footer says `pane 1/2`, the
number of the pane the focus is on and how many the tab holds, whenever the
tab holds more than one.

That window's footer carries the date and the time and leaves out the weekday,
the week and the version. A notice takes the clock's place while it shows. A
click or a tap on a notice opens it out in full above the footer, and one on
the save sign of a write that failed or a note that changed on disk does the
same with the reason and the way out; a second one shuts it. Under a mouse the
same text is on hover. Opened out, a write that failed has a `Write my text`
button under it, which does what `:w` does, and `Drop my text`, which does what
`:e!` does. A note that changed on disk has `Write my text` and
`Take the vault's`, which is `:e!` again.

Every pane of a split on screen has a header row of its own, with the kind of
thing it holds (Note, PDF, Book, Review, Graph or Video, each with its icon)
and the path, and the focused pane has a 2 px accent line at its top. Nothing
else changes colour when the focus moves, and a hairline divides the panes. A
single pane and a zoomed one have no header and no line, having nothing to
tell them apart from. On a phone a split's panes have them, with the line on
the focused one. Each pane scrolls on its own and keeps
its place when the focus moves.

No pane or tab key on this page moves while the note in the focused pane reads
`Changed on disk`. Leaving the pane would leave that note unsettled, so the key flashes
the status bar and stays put until `:w` or `:e!` settles it, which
[Saving](/reference/editor-keys/saving.md#saving) covers. A click into another pane is the one thing that still
goes through. `<leader>z` is the other: it writes nothing, opens nothing and
moves the focus nowhere, so a conflicted note is no reason to refuse it.

`<leader>ct` starts a tab. `<leader>tl` and `<leader>th` walk them, and
`<leader>1` through `<leader>9` go straight to one, with `<leader>0` for the
tenth, which is where those keys sit on the row rather than what the character
means. An eleventh tab is reached by walking.

The tab strip sits under the top bar, 40 px tall (44 px under a finger), and is
always drawn. It opens on `Today` in italic serif, the home tab: it goes to the
first tab holding one empty pane, which shows Today, or starts one. A thin
divider follows, then every open tab, each with the icon of what its focused
pane holds (page, PDF, book, review, graph or video), its name cut with an
ellipsis, and a close x, drawn on the active tab and on hover. A tab whose note
has text not yet written shows a dot in place of the x, and the x on hover.
Closing the active tab writes its note first, as moving away does; closing the
last tab leaves one empty tab. `Space 1` and the other digits name the tab in
its tooltip. Tabs that do not fit go behind `N more` at the right, which opens
a list of them; the active tab is always among the tabs drawn. On a phone (a
window under 768px with a touch screen) every tab is drawn instead, the strip scrolls sideways, the active
tab is brought into view, and there is no `N more`. In the strip the
arrow keys move between tabs, `Home` and `End` go to the ends, `Enter` opens
one and `Delete` closes it. An empty tab reads `New tab`, and each tab is named
for the note in the pane it
left focused, for the herdr session when that pane holds a terminal, and
`todos` when it holds the todo list. A pane holding a pdf, an image or an HTML
page names its tab for the file, without the folder or the suffix, so
`x/my plan.pdf` reads `my plan`. An exam and a person card name the tab for
their note, again without the folder or `.md`, so `people/Ada Lovelace.md`
reads `Ada Lovelace`. The graph of the whole vault reads `graph view`, the
graph around a note reads `graph of` and the note's name, a note's history
reads `history of` and the note's name, and the review reads
`review`. A 2 px accent line under the active tab glides to the next one on a
switch, and hover fills a tab with the accent wash. The strip arrives once, on
the first load of the page, and stays at the top, see-through over the page,
with one hairline under it. A pane split off
slides in from its side and fades in, from below when the panes are stacked or
on a phone.

`<leader>q` walks back out of all of this, one press at a time. On a pane
holding a note it writes the note and empties the pane, and it takes a
terminal, the todo list, the graph, a note's history or a person card out of a
pane the same way, so `q` in a lone graph pane leaves Today. On an empty pane
it closes the pane. On the last pane of a tab it closes the tab. On the last pane of the last
tab it does nothing, because a window with nothing on screen is not a state
worth reaching.

An empty pane is an editor on an empty document, which is what the window has
always shown with no note open. Text typed into one goes nowhere and closing
the pane discards it. Above that editor the pane shows Today, as [Reading a
note](/reference/reading-a-note.md#today-in-an-empty-pane) says.

The arrangement is not in the URL. `?note=` names the note in the focused pane
and follows it from pane to pane, so a reload comes back to what you were
reading, in a single pane, with the tabs and splits gone. The back button steps
through pages rather than through panes.

## The history pane

`<leader>gh` lists the jj changes of the open note in a pane beside it, newest
first, and the palette's **Show this note's history beside it** does the same
on a phone, where the two panes stack. A second press moves to the pane
already open. The newest change is picked when it opens, and its text shows as
a line diff against the note now, the `modified` line set aside. The keys are
the same with vim on or off.

| Key | Does |
| --- | --- |
| `j` `k` `ArrowDown` `ArrowUp` | Move the cursor down or up the list |
| `Enter` | Show the diff of the change under the cursor |
| `Ctrl+Enter` | Restore the change whose diff is shown |
| `Escape` `q` | Empty the pane, leaving Today in it |

A click or a tap on a change shows its diff, and a tap on **Restore** restores
it. How a restore goes, and when kasten refuses one, is in
[Recover an earlier version of a note](/how-to/recover-an-earlier-version.md#from-the-history-pane).

## The graph pane

`<leader>gg` puts the graph of the whole vault in the focused pane, over what
was there, the way `<leader>gt` puts the todo list there. In a note pane wide
enough for its right margin, which already shows the small graph around the
note ([the local graph](/reference/reading-a-note.md#the-local-graph)),
`<leader>gl` draws the graph around the open note in a pane beside it, one edge
out; a second press moves to that pane rather than drawing a second one. In a
narrower pane it opens the margin's graph and lists in a sheet over the note
instead, and on a phone (a narrow screen and a finger) in a sheet from the foot
of the screen: drag the grabber or the header down, tap outside it or press
`Escape` to close it. Picking a note in either sheet closes it and opens the
note. Pressed with no note open, `<leader>gl` does nothing.

### The vault graph

The graph of the whole vault groups its notes. In Folders mode each top folder
has a spot on the canvas, and so does each project under a folder whose name
ends in "Projects"; a note is pulled to its spot, and a soft round area in the
accent, named in small italic serif, marks the place. In Tags mode each tag has
an area in its tag colour; a note counts towards every tag it carries and sits
between their areas. A note at the vault root, or one nobody has written, has
no spot and sits loose around the places. The same vault lays out the same way
on every open. The areas are the accent or the tag colour at 8 % in light and
11 % in dark (`--k-area`).

Each dot is filled with the colour of the note's first tag (`--tg-none` for a
note with none), the same colour the margin graph gives it, and each further
tag adds a thin ring in that tag's colour.

A 300 px panel at the right holds the title, how many notes and links are drawn
and whether the archive is in, how to read the colours, the Folders / Tags
switch, the tags with their colour and count, and a card for the note under the
pointer, with its folder, tags, links and an Open button. A click on a tag
hides its area and ring, and every note that has no other tag; a second click
shows it again. The mode is kept per device (`kasten.graph.mode`). In a pane
under 640 px wide, and on a phone, the panel sits under the canvas. On a phone
the canvas is about 118vw high, at most 70% of the screen height, and the panel
below it takes the full width; the pane scrolls as one. On a touch screen a tap
on a note picks it into the card, and Open or a second tap opens it.

On a touch screen the vault graph settles at a zoom where names read: the
larger of the fit and 180 %, where names draw solid, about the note with the
most links. Two fingers zoom about the point between them, from half the fit to
400 %, where the smallest dot is a finger wide; one finger on the background
pans. The touch row shows the zoom right of `fit`, and `fit` or a double tap on
the background brings the whole vault back. A mouse and its wheel zoom as
before, with no such limits.

### Around a note

Around a note each dot is larger the more edges it has, coloured by its `type`
from the graph's tag slots in [the design tokens](/reference/design-tokens.md):

| Type | Slot | Colour |
| --- | --- | --- |
| `Concept` | `--tg-4` | purple |
| `Source` | `--tg-8` | orange |
| `Person` | `--tg-2` | green |
| `Book` | `--tg-5` | olive |
| `Reference` | `--tg-3` | blue |
| `Periodic Note` | `--tg-none` | grey |
| anything else | `--tg-none` | grey |

A note a link names and nobody has written is a hollow ring. A typed relation
is a violet line (`--tg-7`) with an arrow at the note it points to; a plain
link is a faint line with none. The centre of a local graph wears a ring in the
accent colour. The graph repaints when the theme switches.

Names fade in as you zoom. Hovering a note lights it and its neighbours and
dims the rest, and names the relations on its edges. Drag a note to move it,
drag the background to pan, and scroll to zoom. A click opens the note in the
pane, and a click on a hollow ring makes the note the way following its link
would.

A finger does the same: one finger on the background pans, one on a note drags
it, two pinch to zoom, and a tap opens the note. A second finger turns a note's
drag into the pinch, the note staying where the first finger left it, and a
finger on a note in a pinch zooms like any other; a pinch lifted without a
move is no tap. A tap on a hollow ring asks
before it makes the note. On a touch screen a note
answers a tap within 12 pixels of its middle however far out the zoom is, where
a mouse has to be on the dot. A row under the header carries `fit`, which is
`f`, and around a note `depth -` and `depth +`, which are `-` and `+`.

The line at the top takes a query in the language
[Graph query](/reference/graph-query.md) states: a filter such as
`type:Concept -tag:#draft`, or a pattern such as `?paper supports ?idea`. It is
asked a quarter second after typing stops, or at once on Enter. A pattern also
answers in a table under the graph, each note in it a click away. A query the
backend cannot read leaves the last drawing up and says why under the line.

| Key | Does |
| --- | --- |
| `/` | Move into the query line |
| `Enter`, `Escape` | In the query line: ask now, or leave it, and go back to the graph |
| `+` or `=` | Around a note: reach one edge further out, up to 5 |
| `-` | Around a note: pull one edge back in, down to 0 |
| `f` | Zoom until every note is on screen |
| `m` | The vault graph: switch between Folders and Tags |
| `q` | Empty the pane, leaving Today in it |

The leader keys work here as in every pane. `<leader>a` puts the archive in the
drawing too. A focused button (a note in the pattern's table, the panel's mode
and tag buttons, `fit`, `depth`, Create and Cancel) takes its own `Space` and
`Enter`, which press it; `Space` on the pane or the canvas opens the which-key
panel. A note written anywhere, by you or by an agent, redraws a graph on
screen.

## The pdf pane

A pdf opened from the tree, or followed from `![[plan.pdf]]`, is drawn in the
pdf pane. Its header reads `PDF`, the path, the minus and plus buttons with the
zoom between them in percent, and `Note beside`, which opens the pdf's note
beside it.

| Key | Does |
| --- | --- |
| `+` or `=` | Zoom in one step |
| `-` | Zoom out one step |
| `y` | Take the selected passage into today's dump, when one is held |
| `Space` | Open the which-key panel, as in every pane |

The zoom steps are 50, 75, 100, 125, 150, 200 and 300 percent. A button greys
out at the end it cannot pass.

On a touch screen, two fingers pinch the page larger or smaller around the point
between them, so the browser never zooms the whole app over the page. One finger
pans a zoomed page both ways. A double tap toggles between fit width (100
percent) and 200 percent around the tapped point. The pinch, the buttons and the
`+` and `-` keys share one zoom value, from 50 to 300 percent. A pinch can stop
at any value, such as 137 percent, which the header shows as a whole percent.
The buttons then step from there to the next stop. The page redraws sharp once
the fingers lift.

On a desktop, ctrl+wheel (cmd+wheel on a Mac) over the page zooms it about the
pointer, and so does a trackpad pinch, which Chrome, Edge and Firefox send as
ctrl+wheel and Safari as gesture events. The browser does not zoom the app over
the page. A mouse notch zooms by a fifth at most; a trackpad follows the
fingers. That zoom shares the value and the 50 to 300 percent of the buttons,
and the page redraws sharp once the wheel stops. A wheel without ctrl scrolls
the pages. Over the header and the thumbnails, and anywhere outside the pdf
pane, ctrl+wheel and ctrl or cmd with `+`, `-` and `0` are the browser's, which zooms the whole app.

From 900 px of pane width a column of page thumbnails sits on the left, drawn
as the pages come into view. The page on screen has an accent ring, and a click
on a thumbnail goes to that page. The width is the pane's own, so a split
narrows its own column, and a narrower pane gives the whole width to the pages.

On the dark theme the pages are drawn in the dark colours rather than as
printed, and a page's edge is a hairline instead of a shadow. A switch of theme
redraws the pages on screen and keeps the page and the scroll.

Select text in a page to get a Take button over the selection. With a mouse it
sits above the words, and on a touch screen below them, clear of the phone's own
menu. The button and `y` take the passage into today's dump by the route
[`<leader>cd`](/reference/editor-keys/capture.md#capturing-into-todays-dump)
uses. The note at the foot of the pane offers Undo and Put it in a note, as a
page's take does, and it moves to the top when the passage sits low on the page.
A word taken stays marked on the page until its Undo, or until the pane shows
another pdf. A selection in another part of the document takes nothing.
