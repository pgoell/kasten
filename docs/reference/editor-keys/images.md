---
type: Reference
title: Editor keys, images
description: Pasting, dropping, picking, drawing and toggling images in the editor, and the keys that take them.
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
| Ctrl+v | Put the clipboard's image or video file in the vault and write the reference to it |
| `<leader>ci` | Toggle the link at the cursor into an image, and back |
| `<leader>ca` | Pick image or video files from your disk or phone into the note |
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
An `image/svg+xml` on the clipboard is filed under `.svg`, and drawn as an
`<img>`, which runs none of its script.

A video file, an mp4 or a webm, goes in by a paste or a drop, as in Obsidian.
It goes to the same folder under its own name, and `![[walk.mp4]]` lands where
the cursor is when the upload ends; a drop first puts the cursor where the file
fell. A name any folder already holds, in any case, gets ` 1`, ` 2` before the
suffix, so the vault overwrites nothing and the link names this file alone.
The characters a wikilink cannot carry, `[ ] | # ^`, become `-`. Several files
go in order, one embed to a line, and a file over 10MiB goes up in pieces through
[`POST /api/uploads`](/reference/http-api/assets-and-books.md#post-apiuploads).

While a file goes up the status bar names it and how far it has got,
`Uploading walk.mp4 42%`, with `+1` for each upload waiting behind it, a phone's
bar too. It clears when the upload ends, and a failure puts its reason there.
A note closed before its upload ends still gets the embed, on a line of its own
at the end: in an editor open on that note by then, else in its file, written
once the note's own saves have answered and only over the text the vault holds
then, so nothing typed is lost. A note gone by then is not made again; the bar
says the file is in the folder.

An image file dropped into a note goes in the same way, as in Obsidian: under
its own name, numbered the same way, with the same characters made `-`. What
lands where it fell is `![](that path)`, the form a pasted image gets. An image
file whose name has no suffix the vault takes is named for today, as a pasted
one is. Images and video files dropped together go in the order they came, one
to a line.

A phone browser takes no file drop from another app, and a keyboard paste
seldom carries a video, so the editor has a picker. `<leader>ca`, or the
palette's `Pick an image or video file into this note` (`run` on a phone, once
you have tapped into the note), opens the system's file picker, and each file
picked goes in as a dropped one does: the same upload and progress in the bar,
the same names, the embed at the cursor, a closed note's embed at its end. The
picker lists only what the vault takes; any other file, such as an
iPhone's `.MOV`, is left out and the bar names it.

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
