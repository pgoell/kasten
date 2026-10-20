---
type: Reference
title: Editor keys, links and people
description: The person card, wikilinks and the link panels, with the keys that follow them and how a link is read.
resource: frontend/src/lib/wikilink.ts
tags: [editor, keyboard, links, wikilinks, frontend]
status: stable
---

# Links and people

## The person card

A person is a note like any other, marked `type: Person` in its frontmatter.
That mark is the whole of what makes one, and it is what the card draws under.

The card says what the vault holds on them right now, in three lists.

| List | What is in it |
| --- | --- |
| open todos | every todo that is neither done nor rejected and links them, soonest due first |
| last meetings | the three most recent notes whose filename opens with a date and link them |
| recently done | the five most recent `- ✅` log lines that link them |

It is drawn in two places. At the foot of the person's own note, where it
appears as soon as the note says `type: Person` and nowhere else, and in a pane
beside that note on `<leader>gp`. Reach for the pane to keep someone on screen
while you write somewhere else; a second press moves to the card already open
rather than drawing a second one, the way the reader and the player do. Pressed
over any other note the key does nothing, a card about a note that is not a
person being three empty lists. Every row opens the line it names, and draws
the links on it plainly, the brackets gone and a path shown as the note's own
name: every row of a card links the person it is about, so the brackets say
nothing there that the heading has not said already.

**A link, never a name.** A line counts when it carries a `[[wikilink]]` that
resolves to the person's note, so `ask Max about the script` is on nobody's card
and `ask [[Max Bosch]] about the script` is on his. Two colleagues share a first
name and a surname is also a word, so a card that read prose would put one
person's work on another's page. What it costs is that a todo written without
the link is invisible here, which is why the vault's own `How-To-TODO` asks
agents to write the link.

The done log copies the words of the todo, so a person linked once shows on
their card while the work is open and again once it is finished.

The card asks nothing new of the backend. It reads `GET /api/todos` and
`GET /api/search` for the person's name, which are the two answers the todo pane
and [the link panels](#the-link-panels) already hold, and decides for itself
which of those lines are links.

## Wikilinks

`[[reading/borges]]` is a link to another note, and `[[report.html]]` a link to
a page of HTML. The editor renders it as the
name alone, in the link colour, with the brackets off the screen the way every
other mark is hidden, and `i` on that line hands them back.

The target is read the way Obsidian reads it, bar first, then hash:

| Written | Shows | Opens |
| --- | --- | --- |
| `[[note\|alias]]` | `alias` | `note` |
| `[[note#Heading]]` | `note#Heading` | `note`, at the heading |
| `[[note#Heading\|alias]]` | `alias` | `note`, at the heading |
| `[[#Heading]]` | `#Heading` | this note, at the heading |

A heading the note lacks opens the note where a plain link would. In a table
the bar is written `\|`, since a bare one ends the cell. A link to a note
nobody has written makes it under its name alone, never under the alias or
the heading. The backlinks panel, the graph and a rename read the same rule.

| Key | Does | Mode |
| --- | --- | --- |
| `gf` | Open the note or page the wikilink names, or the book a highlight came from | normal |
| Enter | The same, one key | normal |
| Ctrl+click | The same, with the mouse | any |
| Tap | The same, with a finger | any |

`gf` is vim's own go-to-file, and it reads the link under the cursor. Anywhere
in the name will do, the last letter included: the closing `]]` is hidden, so
the cursor cannot rest between the name and what follows it, and both edges
count as on the link.

On a highlight block it opens the book instead, at the passage the block
quotes. In a pdf that is the page holding the quote, found by reading each
page's own words, a pdf handing out no document until the page is drawn. Four
places in a block answer: the quote line, the blank line under it,
the chapter words and the anchor, the last two sharing a line. The book opens
in a pane beside the note when nothing has it open, and where a pane is already
reading it the cursor moves there rather than a second reader opening. Where
the book no longer holds the quote's words, which is what editing a quote by
hand does, one sentence goes to the foot of the window and the reader stays
where it was. Enter does the same thing `gf` does, here as on a link.

A plain blockquote is not a highlight and neither key opens anything on one:
the anchor line is what tells the two apart.
[Highlight format](/reference/highlight-format.md) states the rule.

Enter does the same on one key. Off a link it does what vim does with a bare
`<CR>`, which is move to the first word of the next line, so nothing is lost on
a line holding no link.

Ctrl+click, or Cmd+click, is the same command with the mouse, and it is the
modifier that browsers already spend on opening a link. A plain click is left
to the cursor, because clicking into a link is how the link gets edited. The
click has to land on the link's own text; it reads the element under the
pointer rather than the nearest position to it, so the space after the line is
not the link. A click in a pane that is not focused focuses it first, so the
link opens off the pane you clicked, as in Obsidian. With live preview off
there is no rendered link to click, and `gf` is the way. Ctrl+click and a tap
work on a wikilink in a drawn table's cell too; a plain click there opens the
table. A tap on the wikilink the cursor is in moves the cursor, since that is
the link being edited; a tap on any other link follows it, one to the same
note included. A double tap or a double Ctrl+click follows once.

Ctrl+click or a tap on a markdown link, `[mail](https://mail.google.com/...)`,
opens its address in a new tab. Only an address with a scheme opens; a
relative one such as `[notes](notes.md)` does nothing. A tap on the markdown
link the cursor is in moves the cursor, as on a wikilink. A double tap or a
double Ctrl+click opens one tab. A picture inside such
a link, `[![a](cat.png)](https://example.com)`, opens it on any click or a tap,
no Ctrl needed, and a double-click opens it once. A tap on it right after a
tap beside it opens it too. The same holds for a link in
a drawn table's cell; a plain click or a tap anywhere else in the cell opens the
table. `gf` and Enter leave markdown links alone.

Ctrl+click or a tap on an embed, `![[note]]`, opens the embedded note in the
pane the embed sits in, at its heading for `![[note#heading]]`, and that pane
takes the focus. On a pdf, `![[plan.pdf]]`, it opens the pdf in a pdf pane
beside that note, as `gf` does, on a phone as on a desktop. The pane draws the pdf with pdf.js, the way the embed does, so a
phone shows the page the link names. `![[plan.pdf#page=3]]` opens it at page
3, and so do `gf` and Enter on `[[plan.pdf#page=3]]` or on the embed's source.
A second link to a pdf already open turns its pane to the new page rather than
opening another. A `#page=` that is not a whole number from 1 opens it at page
1, and so does a page the pdf lacks. `<leader>q` closes the pane. A plain click
on the embed does nothing. [Embed format](/reference/embed-format.md) says what an embed draws.

A tap on a touch screen follows the link with no modifier. A finger that lands on a link and drags scrolls the note and follows
nothing. A tap on the link the cursor is already in moves the cursor, so to
edit a link, put the cursor beside it and move in with the arrow keys or
Backspace.

What the target names is decided against the vault's own listing:

* A target with a slash in it is a vault-relative path, and is taken at its
  word. `.md` is added unless you typed it.
* A target with no slash is a name, and is looked for anywhere in the vault,
  ignoring case, so `[[borges]]` opens `reading/borges.md` from any note. A
  note of that name at the vault root wins over one in a folder.
* A target ending in `.html` names a page of HTML, by its whole file name, by
  the same two rules: `[[2026-10-07.html]]` finds the page in any folder, and
  `[[news/2026-10-07.html]]` is a path. Following one draws the page in the
  focused pane, the way a click on its row in the tree does. `[[report]]` and
  `[[report.html]]` are two files.
* A target nothing answers to is a note that is not there yet. Following it
  makes an empty note there, folders on the way included, and opens it. A name
  says which note and never where it belongs, so a bare one lands in
  the inbox; a target that spelled a path out is made at the path it spelled.

That last one is the point of writing a link before the note: `gf` is where the
note begins. A page is the exception: the vault has no write for one, so a
link to a page nobody made stays a dead link and following it does nothing. It uses [POST /api/files/{path}](/reference/http-api.md), so a path
the vault refuses, a hidden name or a note standing where the link wanted a
folder, leaves you where you are with the link still on screen to be fixed.

A link whose note is not there yet is drawn muted, with a dotted underline
rather than a solid one, so the two kinds are told apart before you follow
either. It is not a warning colour: an unwritten note is an invitation, and
following the link is what accepts it. The link comes to life on its own as
soon as the note exists, without reopening the one you are reading. Nothing is
marked dead where the vault listing has not arrived, so the finder's and
search's preview panes draw every link as one that lands.

`[[wikilinks]]` are not part of any markdown flavour kasten loads, so
`frontend/src/lib/wikilink.ts` adds them to the parser, the way
`markdown-highlight.ts` adds `==highlight==`. What sits between the brackets is
a note's name rather than prose, so nothing in it is parsed as markdown, and a
link that runs past the end of its line is not a link.

## The link panels

`<leader>gb` shows what links to the open note. `<leader>go` shows what it links
to. The same pair Obsidian calls backlinks and outgoing links, and the same two
letters: `g` for go, then the direction. Neither can be a bare letter, `b`
folding the tree and `o` opening a line in vim.

Each one reuses a panel that was already here. Backlinks are lines from the
vault, so they are drawn as [the note search](/reference/editor-keys/finding.md#the-note-search) draws them, one
row per line with the note, the line number and the line itself, and Enter opens
the note on that line. Outgoing links are notes, so they are drawn as [the note
finder](/reference/editor-keys/finding.md#the-note-finder) draws them, one row per note, and Enter opens it.
Typing filters either list, and the keys are that panel's keys.

Backlinks are found in two steps, the way search is. The vault is asked once for
the note's name, which every link to it carries whether it spelled the path out
or not, and each line that comes back is then read the way the editor reads it:
a line counts only where one of its `[[links]]` resolves to this note. That is
what tells `see [[borges]]` from `borges wrote the library`, and what keeps
`[[reading/borges]]` counting while a `[[borges]]` that the vault answers with
another note does not.

Outgoing links are read off the note itself, and the note is written to the
vault first, so a link you have just typed is in the list. A link to a note
nobody has written yet is left out: the panel is a list of notes, and there is
no note there to list. The editor already draws that link dotted, and `gf` is
what turns it into a note.

Under the links, the backlinks panel lists the unlinked mentions: lines in other
notes that name this note in plain words, under a heading of that name, the one
Obsidian uses. A mention is the note's title or one of its `aliases`, matched
whole and ignoring case, outside a link, code or the frontmatter, and never in
the note itself or the archive. Each row is drawn as a
backlink is, and typing, the arrows, Tab and Enter treat it as one. `Ctrl+Enter`
(`Cmd+Enter` on a Mac) on a mention, or a tap on the `link` button at the end
of its row, turns those words into a link and keeps them as they were written:
`[[name]]` where they spell the note's name, `[[name|words]]` where case or an
alias differs, and the path in place of the name where another note shares it.
The write follows the bookmark's rules. It skips a note that is open to type
in, still being saved, or holding text a failed save left behind, and a line
that changed since the panel read it, and the line under the list says which.
Once the link lands, the row moves from the mentions to the links.

The line underneath says `nothing links here` for a note nothing points at,
mentions or not, and `this note links nowhere` for one that points at nothing.

Both panels are a snapshot of the moment they opened, but for a link written
from the panel, which reads the backlinks again.
