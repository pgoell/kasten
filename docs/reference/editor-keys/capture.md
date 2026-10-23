---
type: Reference
title: Editor keys, capture
description: The keys that bring a web page, a markdown file or a thought into the vault, and the key that takes a note back out.
tags: [editor, keyboard, capture, import, frontend]
status: stable
---

# Getting notes into the vault

## Importing a web page

`<leader>cw` puts a web page in the vault as a note. It opens a prompt that
takes one address; paste it, press Enter, and the page arrives in the inbox
under its own title, open in the focused pane.

The reading is [defuddle](https://github.com/kepano/defuddle), the extractor
behind Obsidian's web clipper, running in the browser. So a page lands looking
the way the same page lands in an Obsidian vault: the article and not the
navigation, the footer or the cookie banner, headings and lists and code fences
kept, and every relative link made absolute so it still leads somewhere. The
backend's part is [the fetch](/reference/http-api/capture.md#get-apifetch) alone.

The note is named after the page's title, with the characters a path or a
`[[link]]` cannot hold taken out and the name cut at 80. A page with no title
at all is named after the site it came from.

Its frontmatter carries `type: Source` and `resource`, the page's address, and
`author` and `published` where the page names them, beside the `id`, `created`
and `modified` every note gets. The title is the note's first heading as well as
its name. Clippings written before this carry `source` in place of `resource`,
and nothing rewrites one.

Clipping a page twice makes one note: the second press opens the note that is
already there rather than writing a copy beside it. Editing what you clipped is
what the vault is for, so it is never overwritten.

A page that could not be read leaves the prompt open with the reason in it and
the address still in the input, which is where half of these are fixed: a
mistyped path, or a page that wants a login.

## Capturing into today's dump

`<leader>cd` puts one thought in the `## Dump` section of today's daily note,
from wherever the focus is: a note, the tree, the todo pane, the reader. It
opens a one-line prompt over the page, the shape of the todo pane's add prompt,
with the day it writes to under the input.

| Key | Does |
| --- | --- |
| Enter | Send what was typed, close the prompt and leave the focus where it was |
| Escape | Close the prompt and write nothing |

Enter on an empty input does nothing. The text is sent as it was typed, bar the
spaces around it. The thought is kept in the browser first and sent after, so
nothing is lost with no signal. A short line in the status bar says "Captured
into today's dump" when it landed, "Captured, waiting to send (N waiting)" when
it waits, N counting every thought still waiting, "Captured, waiting to send:
sign in again" when the login ran out, the vault's reason when it refused the
thought, or why the browser could not keep it. A
waiting thought goes when the signal returns, into the day it was typed on. The
day is read at the press, so a prompt left open over midnight writes into the
new day.

The dump is the section of prose the day's loose thoughts collect in, so each
capture lands as a paragraph of its own at the end of the section, before any
section that follows it. The daily note is made where the vault has none,
exactly as `<leader>gd` makes it, and the section is made at the end of the note
where the note has none. [`POST /api/dump`](/reference/http-api/capture.md#post-apidump)
covers where the text goes line by line.

`d` for the dump, in the `c` group because it creates: a paragraph, and the note
and the section where the day has neither. A bare `<leader>d` is not free: vim
runs a complete match the moment it is typed, so it would fire before `df` or
`du` could be finished.

The same capture has a page of its own for a phone, `/capture`, which
[Capture from your phone](/how-to/capture-from-your-phone.md) covers.

A passage taken from a vault HTML page goes into the same dump by the same
route, as a blockquote. It holds the passage, cut to 2000 characters and with
every markup character escaped, then a link back to its place on the page,
`[[<page>#<anchor>|<heading>]]`. [The file tree](/reference/editor-keys/file-tree.md#the-file-tree)
says how a page is taken.

A passage taken from a vault PDF goes into the same dump by the same route, with
the same escape, the same 2000-character cap and the same outbox. Its link reads
`[[<pdf>#page=N|<file name>, page N]]`, which points at the page the words sit
on. `y`, or the Take button over the selection, takes it in the pdf pane, and
the note at the foot offers the same Undo and Put it in a note as a page does.
[The pdf pane](/reference/editor-keys/panes-and-tabs.md#the-pdf-pane) says how.

A wikilink cannot hold `[`, `]`, `|` or `#` in a name, so for a page or pdf
whose path holds one the link is a markdown link with the path percent-encoded,
as Obsidian links such a file: `[<heading>](a%5D%5Db.html#<anchor>)`,
`[<file name>, page N](a%7Cb.pdf#page=N)`. It opens the file in kasten as the
wikilink would.

A take whose send lands after its pane has moved to another page or pdf still
lands in the dump, but shows no note over the new document, and so no Undo;
the line is edited in the daily note. A selection made after `y` stays.

## Importing markdown, and taking a note out

`<leader>cm` puts markdown files from your disk into the vault. It opens the
browser's file picker on `.md`; choose one file or a folder full, and each one
lands in the inbox under its own name, with the first of them open in the
focused pane.

They go in one at a time, each write finished before the next begins, because
every note made this way takes a change of its own in the vault's history.

Nothing is overwritten. A name the inbox already holds bounces that one file
and lets the rest through, with the reason at the foot of the window: the file
is still on your disk, to rename and pick again. Frontmatter another notebook
wrote comes through untouched, and `id`, `created` and `modified` are added
around whatever fields the block already carries.

A name is cleaned the way a clipped page's is, the characters a path or a
`[[link]]` cannot hold taken out and the name cut at 80. A file whose name
leaves nothing behind is refused rather than guessed at, and so a slash in one
files nothing in a folder nobody asked for.

`<leader>w` is the way back out. It hands whatever the focused pane holds to
the browser as a file under its own name, so `20 Literature/DDIA.md` arrives in
your downloads as `DDIA.md`. In an image pane it is the picture, `shot.png`,
and an exam counts as its note. A reader says it `w` on its own, that pane
having no leader, and hands over whichever file sits beside the note,
`DDIA.epub` or `DDIA.pdf`. A terminal and the todo list are not files, so
nothing goes out from either.

For a note, text still waiting is written to the vault first, so the file holds
the note as you last typed it rather than as the vault last read it. A book and
a picture go out as the vault has them, nothing having edited either. `w` is
vim's own key for writing what you are looking at out to a file.

One file at a time is all it takes. The vault is a folder on disk, so the way
to carry the whole thing off is to copy the folder: the terminal has it
mounted, and the jj repo beside the notes holds its history.
