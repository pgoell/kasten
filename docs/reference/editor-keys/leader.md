---
type: Reference
title: Editor keys, the leader
description: Every leader key grouped as the leader panel groups them, the command palette and the pages you type into.
resource: frontend/src/lib/leader-keys.ts
tags: [editor, keyboard, vim, leader, frontend]
status: stable
---

# The leader key

## Leader

The leader is the space bar, in normal mode. Vim ships `<Space>` bound to `l`,
and kasten unmaps it so a sequence can begin there. Visual mode keeps
move-right, because the leader is registered in normal mode only.

The tables follow the groups of the `<leader>?` panel, in the same order. The
panel shows the leader keys apart from every other key, and with vim off it
says that the command palette runs them by name. With vim off its Editor group
also leaves out `gf` and Enter, the keys there that only vim resolves. Every
group lines its keys up on the left, so the presses after `Space` read down one
column.

**Panes**

| Key | Does |
| --- | --- |
| `<leader>%` | Split the pane left and right |
| `<leader>"` | Split the pane top and bottom |
| `<leader>h` | Move to the pane on the left |
| `<leader>j` | Move to the pane below |
| `<leader>k` | Move to the pane above |
| `<leader>l` | Move to the pane on the right |
| `<leader>H` | Swap this pane with the one on the left |
| `<leader>J` | Swap this pane with the one below |
| `<leader>K` | Swap this pane with the one above |
| `<leader>L` | Swap this pane with the one on the right |
| `<leader>o` | Move to the next pane |
| `<leader>z` | Draw this pane on its own, or put the tab back |
| `<leader>q` | Close the note, then the pane, then the tab |

**Tabs**

| Key | Does |
| --- | --- |
| `<leader>ct` | Start a tab, on one empty pane |
| `<leader>tl` | Go to the next tab |
| `<leader>th` | Go to the previous tab |
| `<leader>1` to `<leader>0` | Go to a tab by number |

**Find**

| Key | Does |
| --- | --- |
| `<leader>fb` | Open the book finder |
| `<leader>ff` | Open the note finder |
| `<leader>fg` | Open search over note content |
| `<leader>ft` | Open the todo overlay |

**Create and capture**

| Key | Does |
| --- | --- |
| `<leader>cf` | Open the new note prompt |
| `<leader>cd` | Capture a thought into the `## Dump` of today's note |
| `<leader>cw` | Import a web page into the inbox |
| `<leader>cm` | Import markdown files from your disk into the inbox |
| `<leader>cb` | Add an epub or a pdf to the inbox, with a note beside it |
| `<leader>ci` | Make an image of the link at the cursor, or write an empty one |
| `<leader>cv` | Write the transcript of this note's video into the note |
| `<leader>cc` | Open the chat with Claude Code in the focused pane |
| `<leader>cs` | Open a terminal, on a herdr session you name |

The file pickers that `<leader>cm` and `<leader>cb` open wait until you let go of the last key, so the picker opens once the key is up.

**This note**

| Key | Does |
| --- | --- |
| `<leader>rf` | Open the rename prompt |
| `<leader>df` | Move the open note into the trash |
| `<leader>du` | Put the last deleted note or folder back |
| `<leader>w` | Download what this pane holds as a file |
| `<leader>=` | Tidy the markdown in this note |

**Periodic notes**

| Key | Does |
| --- | --- |
| `<leader>gd` | Open today's note |
| `<leader>gw` | Open this week's note |
| `<leader>gm` | Open this month's note |
| `<leader>gq` | Open this quarter's note |
| `<leader>gy` | Open this year's note |

**Panes to open**

| Key | Does |
| --- | --- |
| `<leader>gb` | Show what links to the open note |
| `<leader>go` | Show what the open note links to |
| `<leader>gr` | Read this note's book in a pane beside it |
| `<leader>gc` | Read the current book |
| `<leader>gp` | Show this person's card in a pane beside their note |
| `<leader>gh` | Show this note's history in a pane beside it |
| `<leader>gl` | Show the graph around this note in a pane beside it |
| `<leader>gv` | Watch this note's video in a pane beside it |
| `<leader>ge` | Sit the open note as a practice exam |
| `<leader>gs` | Put the review in the focused pane |
| `<leader>gt` | Put the todo list in the focused pane |
| `<leader>gf` | Put the food log in the focused pane |
| `<leader>gg` | Put the graph of the whole vault in the focused pane |

**Todos**

| Key | Does |
| --- | --- |
| `<leader>x` | Cycle the todo on this line |
| `<leader>i` | Stamp an id on the todo on this line |
| `<leader>@` | Send this todo to the agent, or take it back |
| `<leader>so` | Set this todo to open |
| `<leader>sp` | Set this todo to doing |
| `<leader>sx` | Set this todo to done |
| `<leader>sb` | Set this todo to blocked |
| `<leader>sw` | Set this todo to waiting on somebody |
| `<leader>sv` | Set this todo to waiting for review |
| `<leader>sr` | Set this todo to rejected |

**Toggles**

| Key | Does |
| --- | --- |
| `<leader>a` | Show or hide the archive in the tree, the finder, search and the todos |
| `<leader>b` | Fold the file tree away, or bring it back |
| `<leader>p` | Turn live preview off, or back on |
| `<leader>e` | Move the focus to the file tree |
| `<leader>E` | Unfold the tree down to the open note and put its cursor there |
| `<leader>v` | Play or pause this note's video |

**Help**

| Key | Does |
| --- | --- |
| `<leader>?` | Show every binding in the app |
| `<leader>:` | Run a command by name, in [the command palette](#the-command-palette) |

`<leader>cf` takes two keys after the leader, `c` then `f`, and is the first
binding here to take more than one. The `<leader>?` panel spells it
`Space c f`, one letter per press. From the editor it opens an empty prompt.
From the file tree it opens one already holding the folder the tree cursor sits
in, or the folder holding the note it sits on. The `＋` in the panel header
does the same with the mouse, reading the tree cursor the same way. [The note
prompt](/reference/editor-keys/finding.md#the-note-prompt) covers the keys inside it.

`<leader>rf` takes two keys the same way, `r` then `f`, and the panel spells it
`Space r f`. It opens the same prompt on a note that already exists, so the
input starts holding that note's whole path with the name selected: the folder
and the `.md` are what a rename usually keeps. From the editor it renames the
open note. From the file tree it renames the note the tree cursor sits on,
which need not be the one you are writing, and does nothing at all when the
cursor is on a folder. The `f` names a file; the tree's own `r` is the key that
takes a row of either kind.

A rename can change the whole path, so it moves a note between folders as well
as renaming it in place, making folders on the way and taking away the ones it
emptied. The note you are writing follows into the URL; renaming any other note
leaves the editor where it is. Text still waiting to be written is saved before
the prompt opens, and every save still on its way must answer first, so a rename
never strands a keystroke at the old path. A save that failed keeps the prompt
shut.

A rename also moves the links. Every `[[link]]` in the vault that named the note
is rewritten to name it at its new path, and it keeps the spelling it had: a
path stays a path and a bare name stays a bare name, so `[[borges]]` is left
alone by a move between folders and follows a change of name. Relative markdown
links follow as well, and an entry in the old folder's `index.md` moves to the
new one's. Renaming a folder does the same for every note it carries.
[What a move does to the links](/reference/http-api/moving.md#what-a-move-does-to-the-links)
has the rules. [The link panels](/reference/editor-keys/links.md#the-link-panels)
cover the two ways to read those links.

`<leader>df` takes the note out of the vault, and `<leader>du` puts the last
deleted one back. The pane holding the note empties, and so does every other
pane holding it, since one note can be open in several at once. The tree's own
`d` deletes a row of either kind, the way its `r` renames one, and it is the
only way to delete a folder: a folder and everything under it go as one entry
and come back as one.

Nothing asks first, because nothing is lost. The note is moved into a hidden
`.trash` folder in the vault, where the listing, search, the event stream and
every route refuse to look at it, and it waits there for thirty days. Text still
waiting to be written is saved before it goes, so the trash holds what you last
typed. `<leader>du` reads the trash rather than remembering what this tab did,
so it reaches a delete made in another tab, before a reload, or by hand in a
terminal pane, and it flashes the bar when there is nothing to put back or
something has taken the path since. Links pointing at a deleted note are left
alone and draw as links to a note that is not there.
[Deleting a note](/explanation/deleting-a-note.md) covers why it works this way,
and [Configuration](/reference/configuration.md) how to change the thirty days.

`<leader>gb` and `<leader>go` are a pair and need a note open, one showing what
links to it and the other what it links to. Both do nothing with no note on
screen, which is how the keys say there is nothing to ask about.

`<leader>e` unfolds the tree first if it was folded away, and lands on the row
the tree cursor is already on. `<leader>E` does that and one thing more: it
unfolds the way down to the note the pane holds and takes the cursor to it, so a
note you reached by any route but the tree stops being a note the tree cannot
show you. Escape in the tree comes back to the editor.

`<leader>q` closes the note only once the vault holds the text. A write that
fails leaves the note open with the warning in the status bar, because closing
unmounts the editor and the only copy of the edit would go with it. So does a
note something else has written under you, which [Saving](/reference/editor-keys/saving.md#saving) covers.
[Panes and tabs](/reference/editor-keys/panes-and-tabs.md#panes-and-tabs) covers what the key does after that.

`<leader>p` and `<leader>b` keep their setting while you move between notes,
and start again from on and open when you reload the page.

## The command palette

`<leader>:` opens a box that lists every command by name, and so does
Ctrl+Shift+P, which also works with [vim off](/reference/editor-keys.md#vim-on-or-off), and `run` on
[the toolbar](/reference/editor-keys/touch.md#the-toolbar). Type a few letters,
and the list narrows by fuzzy match. Enter runs the highlighted row, Escape
or a press outside the box closes it, and the arrows, Tab, Shift+Tab, Ctrl+N and Ctrl+P move the
highlight. Each row prints the key that does the same thing.

Opened over a note, the palette lists every leader command, every leader edit,
the four formatting marks, the inserts below, and the commands vim spells at
its prompt: the write, the two rereads, the three copies and `gf`. Opened over
a pane with no note, it lists the leader commands only, as the rest act on a
note. Both lists end with `Go to tab 1` to `Go to tab 10`, `Toggle vim keys`,
`Toggle light and dark mode` (see [the design tokens](/reference/design-tokens.md#light-and-dark)),
one `Log <name>` per kind of the log config note, and `Log food`, none of
which has a key. Over a daily note's card `Log food` opens that card's food
search. Anywhere else it opens today's daily note in the focused pane, as
`<leader>gd` does, making it when there is none, then opens its card's food
search. A note with unsaved text that will not save keeps the pane, and nothing
opens.

With no config note the kinds are `Log water`, `Log coffee` and `Log alcohol`,
writing `- 💧 250 ml`, `- ☕ 1` or `- 🍺 1`. With
[`log.md`](/reference/log-format.md#the-config-note) they are exactly the kinds
it names, each writing its tap line, so `- 🍵 tea: 1 cup` adds `Log tea`, which
writes `- 🍵 1 cup`, and a note without a `☕` line offers no `Log coffee`. The
list follows an edit to the note without a reload. Each writes its line
at the end of `## Log` in today's daily note, making the section, and
the note as `<leader>gd` would, where there is none. With today's note in the
focused pane the line goes into its buffer, so `u` takes it back; otherwise it
is written to the vault and the status bar says so, or says `Nothing logged:`
while today's note holds unsaved text or is being saved. See
[Log format](/reference/log-format.md#the-card).

`frontend/src/lib/palette.ts` builds both lists from the tables in
`leader-keys.ts` and `buffer-keys.ts`, so a new leader binding appears in the palette and in the
`/` menu with no further edit.

### The `/` menu

In insert mode, or anywhere with vim off, a `/` typed at the start of a line or
after a space opens a completion menu of the inserts, the leader edits, the
formatting marks and the leader commands. Letters after the slash narrow it. Enter or Tab
takes the highlighted row, removes the `/` and what you typed after it, and
then writes the insert or runs the command. A `/` inside a word, a path or a
URL opens nothing.

### Inserts

| Insert | Writes |
|---|---|
| Heading 1, 2, 3 | `# `, `## `, `### ` |
| Todo | `- [ ] ` |
| Bullet list | `- ` |
| Numbered list | `1. ` |
| Quote | `> ` |
| Code block | a fence, with the cursor on the language |
| Table | two header cells, a divider and an empty row |
| Divider | `---` |
| Wikilink | `[[]]`, with the cursor between the brackets |

Every insert but the wikilink starts a line of its own: chosen mid-line, it
writes a line break first. Tab walks the fields an insert leaves, such as a
table's two header cells. Chosen from the palette in normal mode, an insert
puts vim in insert mode first.

## Screens you type

Three screens have a URL and nothing else: no link and no row in the tree. The
keys panel lists them under **Screens you type**, which is the only place in the
app that says they exist.

| Address | What it is |
| --- | --- |
| `/tokens` | Mint and revoke the [tokens](/reference/agent-api.md) an agent reaches the vault with |
| `/review` | The review, on a page of its own, sized for a phone |
| `/capture` | Capture a thought into today's dump, sized for a phone |

None of the three opens from a leader key. `/tokens` and `/review` are visited
a few times a year, and a key is worth spending on something pressed daily.
What they were missing was not a key but a mention, because a screen nothing
links to and no key opens is one you have to read the documentation to find.
`/capture` is the phone's; at a desk the same capture is `<leader>cd`.

`/review` is the phone's shell around the review; at a desk the same three
screens are in a pane behind `<leader>gs`. `/tokens` has no pane and no
equivalent, so its address is the whole of the way in.
