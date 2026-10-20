---
type: Reference
title: Editor keys, images
description: Pasting, drawing and toggling images in the editor, and the keys that take them.
tags: [editor, keyboard, images, frontend]
status: stable
---

# Images

## Images

An image is a plain markdown image, `![alt](path)`, and the path is
vault-relative. The editor draws the picture where the text sits, never wider
than the column, and `i` on that line hands the `![alt](path)` back the way it
does for every other mark. An `https:` address is drawn too, with no referrer
sent. Any other address, `http:` included, is left as text: the page's own
policy and the browser both refuse it, so drawing one would draw a broken
picture where the source at least says what was meant.

| Key | Does |
| --- | --- |
| Ctrl+v | Put the clipboard's image in the vault and write the reference to it |
| `<leader>ci` | Toggle the link at the cursor into an image, and back |
| `<leader>w` | Download the picture in the pane, in an image pane |

Pasting is the way in. A screenshot on the clipboard is uploaded to
the images folder, `99 Misc/02 Assets/01 Images/` unless
[`KASTEN_IMAGES_PATH`](/reference/configuration.md#the-vaults-folders) names
another, named for today and eight random hex digits, and
`![](that path)` lands where the cursor is when the upload finishes. Nothing
asks first and nothing else changes. A paste carrying text is left to the
editor's own paste, which is every paste but this one.

The name is not yours to choose because the clipboard has none to give: every
image ever copied arrives called `image.png`, and the vault overwrites nothing.
Rename it in a terminal pane afterwards if the name matters, and fix the
reference while you are there.

A refused upload writes nothing into the note and puts the reason in the status
bar. The vault refuses a path that is taken, a body over 1GiB, and bytes that
disagree with the suffix they arrived under, all three on the rules
[POST /api/assets/{path}](/reference/http-api/assets-and-books.md#post-apiassetspath) sets out.
An `image/svg+xml` on the clipboard is refused too: an SVG is markup a browser
runs, and the vault takes `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`.

`<leader>ci` is the other half. On a link it writes the `!` that makes an image
of it, on an image it takes the same character away, and on neither it writes
`![]()` and opens the list of images to fill it with. Pressed twice it leaves
the note as it found it.

Typing a path inside `![](` offers every image in the vault, the way `[[` offers
every note. The rows are filenames and what goes in is the whole path, so a
folder of screenshots reads as the names you can tell apart while the note holds
something the backend answers to. Spaces are written `%20`, which is what makes
`99 Misc/...` a destination markdown reads to the end of.

The listing behind that list, and behind the tree's own image rows, follows the
vault: a change to anything that is not a note is the one event that can move it,
and it is read again when that arrives. So an image dropped in over a terminal
pane turns up in the tree and in the list without a reload, and a note being
written costs nothing, notes firing a different event.

Images are not ignored by jj the way books are: they are part of what a note
says, and a screenshot is a tenth the size of a book. A snapshot sweeps in any
untracked file under a megabyte, so an image over that stays out of the history
until something tracks it by hand.
