---
type: Reference
title: Editor keys, the file tree
description: The file tree's keys, its drawer on a phone, and how it moves, renames and deletes rows.
tags: [editor, keyboard, file-tree, frontend]
status: stable
---

# The vault in the tree

## The file tree

These apply while the tree holds the focus. `<leader>e` reaches the row the
cursor is on, and these keys move it from there.

The tree opens with every folder folded away, so what you first see is the top
level and the notes at the vault root. A folder's contents are not drawn until
you open it, which is what keeps a big vault cheap: at 10,000 notes that is 8
rows on screen rather than 10,842. The folders on the way to the open note are
unfolded for you, so a reload lands on the note it says is open rather than on
a tree that has hidden it.

That unfolding happens once, when the page loads. Every note you open after
that, through the finder, a `[[link]]`, a backlink or a periodic key, leaves the
tree where it was: folded the way you left it, cursor on the row you left it on.
`<leader>E` is the way to catch it up. It unfolds the way down to whatever the
focused pane holds, note or image, puts the tree's cursor on that row and moves
the focus there, which is `<leader>e` plus the jump. It unfolds on top of what
you already had open rather than in place of it, so nothing you opened by hand
folds away. A pane holding no note, and a note the archive is hiding, leave the
cursor where it is: there is no row to go to, and moving it nowhere is worse
than not moving it.

A reader and a practice exam count as the note they were opened from, so
`<leader>E` reaches that note from either, and the tree marks its row while you
are reading. It is the pane where knowing where you are is worth most: a book
fills the screen and says nothing about which note in the vault opened it.

| Key | Does |
| --- | --- |
| `j` / `k` | Move the cursor down or up |
| `h` | Collapse the folder, or go to its parent |
| `l` | Expand the folder, or open the note or image |
| Enter | Open the note or image under the cursor |
| `gg` / `G` | Go to the first or last row |
| `c` | New note in the folder the cursor is in |
| `f` | Open the note finder |
| `s` | Open search over note content |
| `r` | Rename the note or folder under the cursor |
| `d` | Delete the note, image or folder under the cursor |
| `q` | Close the file tree |
| Escape | Back to the editor |

In a window narrower than 768px the tree is a drawer over the page rather than
a panel beside it. It starts closed, the button on the rail at the left edge
and `<leader>b` open it, and it has no grip to resize it by. A narrow window
under a coarse pointer draws no rail: `files` on
[the toolbar](/reference/editor-keys/touch.md#the-toolbar) opens the drawer there. A tap outside it
closes it, and so does anything that hands the focus to a pane: opening a note,
an image, a page or a pdf from it, a note made with `c` or picked in the finder or the
search, and Escape, which lands in the pane on screen. The page under an open
drawer takes no focus and no keys. A panel open in a wide window closes when
the window turns narrow.

The tree draws the vault's images beside its notes, muted, keeping the suffix a
note's row drops: the vault holds one kind of note and five kinds of image.
They, the pages and the pdfs below are the only rows here that are not notes,
and nothing else in the app treats them as notes, the finder, search and every `[[link]]` reading the note listing
alone. Enter or a click shows one in the focused pane, over whatever was there,
and `<leader>q` hands the pane back to an editor. A folder holding nothing but
images is a folder in the tree all the same, which is how you reach the ones
pasting has filed.

HTML pages are rows too, muted the way images are and keeping `.html`, which is
what sets `report.html` apart from a `report` note beside it. Enter or a click
draws the page in the focused pane, its styles and script included, the way a
research run's report or slide deck was written to be read. `r` and `d` do
nothing on a page's row: whatever wrote the page owns it, so it goes out
through a terminal pane.

Pdfs are rows too, muted and keeping `.pdf`, under the same archive filter as
every other row. Enter or a click opens one in kasten's pdf pane at page 1, in
the focused pane and over whatever was there, as an image row does; a second
click on the row takes the pane back to page 1. The row of the pdf the focused
pane shows is marked as a note's is, and `<leader>E` reaches it. `r` and `d` do
nothing on a pdf's row, which goes out through a terminal pane as a page does.

The pane's header reads `PAGE`, the page's path in mono, and `Open in a browser
tab` at the right, which opens the same page in a tab of its own.

Keys typed inside a page are the page's, so a deck's arrows turn its slides,
with three exceptions kasten adds to every page: Space opens [the which-key
panel](/reference/editor-keys/leader.md), `?` opens key help, and Escape gives
the keys back to kasten. In a text field of the page all three stay the page's.
`j` and `k` scroll the page by 64 px, unless the page uses them itself. When the
panel or key help closes, the keys go back to the page. A click on the pane's
header takes them back too. A link to another site opens in a new tab.

The pane is an image and the path above it, and nothing else: no next image,
and nothing to type into. It opens fitted to the pane. Two fingers pinch it
larger, up to eight times, and one finger moves it while it is
zoomed, as far as its edge and no further; pinching back to fitted centres it
again. No key zooms. What it is for is looking at a picture the
vault holds without first writing a note that points at it. `d` there deletes
the image in front of you, the same key the tree spends on a row, and the pane
empties. On a touch screen the header carries a `delete` button that does the
same on its second tap, the first turning it to `delete?`. A press on the
picture or five seconds takes the question back. `<leader>w` downloads the
picture under its own name, so
`99 Misc/shot.png` arrives in your downloads as `shot.png`.

An image goes into the trash the way a note does, and `<leader>du` puts the last
one back, so the two keys are one gesture and its undo. Nothing asks first, for
the reason nothing asks about a note: what a mistyped key costs is a keypress.
The notes pointing at a deleted image are left alone and draw a picture that
will not load, which is what a `[[link]]` to a deleted note does too. A book has no
delete in the app: it travels with the note beside it, and which of the pair a
delete should take is a decision nobody has made, so `.epub` goes out through a
terminal pane.

Opening a note takes the focus with it, from here and from everywhere else that
opens one: Enter in the tree, a click on a row, the finder, search, a `[[link]]`
and the periodic keys. The editor claims the focus on its own only when nothing
else holds it, and the tree holds it, so without this the note arrived on screen
with every following key still reaching the panel beside it. Escape is for
leaving the tree without opening anything.

Leader sequences work here too, so `<leader>b` closes the tree from inside it.

`c`, `f`, `s` and `r` are bare letters rather than leader sequences, because the
tree's own keys are single presses. `c` does what `<leader>cf` does from here,
`f` does what `<leader>ff` does, `s` does what `<leader>fg` does, and `r` does
what `<leader>rf` does and one thing more: on a folder row it renames the
folder. The tree is the only place that can point at a folder, so it is the only
place the key exists.

Search is `s` here and not `g`, which is the letter `<leader>fg` ends on: `g`
already opens `gg` in the tree and cannot also be a command of its own.

`c` and `r` read the row the cursor is on; `f` and `s` do not. Both read the
whole vault and start from nowhere, so they do the same thing from every row.

Renaming a folder moves every note under it, and the links along with them: a
`[[reading/borges]]` anywhere in the vault becomes `[[archive/borges]]`, and the
subtree's own links to each other move with it. A bare `[[borges]]` is left
alone, the note's name being unchanged. The prompt says how many notes before
you press Enter, and the whole subtree arrives at the new path together, so
there is no state where half of it moved. It cannot land on a folder the vault already
has, on a note, or inside itself, and the line under the list says which of
those it is. The note you are writing follows into the URL when it was one of
the notes that moved, and stays where it is when it was not.

### Dragging a row

The mouse moves a row too. Drag a note or a folder onto a folder row and it
lands inside that folder, onto a note row and it lands in that note's folder,
or onto the empty space below the rows and it lands at the vault root. A folder
the pointer rests on for 600ms unfolds, so a drop can reach inside it. Images
and HTML pages do not drag. A drop where the row already sits, or a folder
dropped on itself or inside itself, does nothing.

A drop asks first. A dialog lists every file whose text the move would
rewrite, read from
[`GET /api/move-preview`](/reference/http-api/moving.md#get-apimove-preview), and
moves nothing until you answer.

| Key | Does |
| --- | --- |
| Enter | Move, the same as the `Move` button |
| Escape | Cancel, the same as `Cancel` or a click outside |

Text waiting to be written is saved before the dialog opens, as with the prompt,
and every pane holding a note that moved follows it.
[Moving a note](/explanation/moving-notes.md#why-a-drop-asks-and-the-prompt-does-not)
says why a drop asks when a rename does not.
