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
| `<leader>cf` | Open the new note prompt |
| `<leader>e` | Move the focus to the file tree |
| `<leader>ff` | Open the note finder |
| `<leader>fg` | Open search over note content |
| `<leader>p` | Turn live preview off, or back on |
| `<leader>q` | Write the note and close it |
| `<leader>rf` | Open the rename prompt |
| `<leader>?` | Show every binding on this page, in the app |

`<leader>cf` takes two keys after the leader, `c` then `f`, and is the first
binding here to take more than one. The `<leader>?` panel spells it
`Space c f`, one letter per press. From the editor it opens an empty prompt.
From the file tree it opens one already holding the folder the tree cursor sits
in, or the folder holding the note it sits on. The `＋` in the panel header
does the same with the mouse, reading the tree cursor the same way. [The note
prompt](#the-note-prompt) covers the keys inside it.

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
the prompt opens, so a rename never strands a keystroke at the old path.

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
| `c` | New note in the folder the cursor is in |
| `f` | Open the note finder |
| `s` | Open search over note content |
| `r` | Rename the note or folder under the cursor |
| `q` | Close the file tree |
| Escape | Back to the editor |

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

Renaming a folder moves every note under it. The prompt says how many before you
press Enter, and the whole subtree arrives at the new path together, so there is
no state where half of it moved. It cannot land on a folder the vault already
has, on a note, or inside itself, and the line under the list says which of
those it is. The note you are writing follows into the URL when it was one of
the notes that moved, and stays where it is when it was not.

## The note prompt

`<leader>cf`, `<leader>rf` and the tree's `c` and `r` open the same prompt over
the editor: one to make a note, one to move a note that is there, one to move a
folder. Type where it goes, relative to the vault root, and `.md` is added
unless you typed it. A folder takes no `.md`, because a folder has a name and
not a suffix. Under the input sits the list of the vault's folders, ranked
against what you have typed, best first, and never more than twenty rows. A
folder move leaves the folder itself and everything inside it out of that list,
since neither is a place it can go.

The header says which of the three you are in, `new note`, `rename note` or
`rename folder`.

| Key | Does |
| --- | --- |
| Down / Up | Move the highlight through the folders |
| Ctrl+N / Ctrl+P | The same two, the way vim's completion moves |
| Tab | Take the highlighted folder, leaving the caret after its slash |
| Enter | Make it or move it, per the line under the list |
| Escape | Close the prompt and give the focus back |

Clicking a folder does what Tab does. Either way the folder replaces the whole
input rather than joining what is there, because the whole input was the query
it was ranked against.

That same rule is what empties the list once you have typed the note's own
name: `reading` matches `reading/`, and `reading/borges` matches no folder at
all. Tab is for before you name the note, not after.

The line under the list says what Enter will do, and Enter does what it says.
It reads `creates folder reading/` for a folder the vault does not have yet, or
`moves 12 notes` for a folder about to take its subtree somewhere else, or why
the path is refused, so `name the note` for one ending in a slash. It says
nothing where the input already spells out the whole story. An input naming
nothing leaves Enter with nothing to do. A write the vault refused leaves the
typed path where it is and says `could not create the note`, `could not rename
the note` or `could not rename the folder`, so the next Enter tries again.

A path that is already taken is the one line the modes read differently.
Making a note there is opening it, so the line says `already exists, Enter
opens it`. Moving a note there would write over it, which the vault refuses, so
the line says `a note is already there` and Enter does nothing, and a folder
onto a folder says `a folder is already there` for the same reason. The
exception is the path a rename starts on, its own: Enter closes the prompt
rather than refusing, because leaving a name alone is not a collision.

Escape hands the focus back where it came from, the editor or the tree.
Opening a note is the exception: the focus goes to the editor, in normal mode,
so you can type into a new note at once. A rename that leaves the editor where
it is hands the focus back the same as Escape, so renaming from the tree keeps
you in the tree.

## The note finder

`<leader>ff` and the tree's `f` open the finder over the editor. It is the other
way round from the prompt: there the input is the answer and the list completes
it, here the list is the answer and the input only filters it. Nothing typed
into the finder has to name a path, and the finder never writes.

| Key | Does |
| --- | --- |
| any character | Narrow the list to the notes the query reads into |
| Down / Ctrl+n | Move the highlight down one row |
| Up / Ctrl+p | Move the highlight up one row |
| Enter | Open the highlighted note |
| Escape | Close, and hand the focus back |

Tab is unbound here. There is nothing to complete: Enter opens the row under the
highlight whatever the input says.

The list ranks every note in the vault, then shows the best twenty. The query
reads as a subsequence, so `kap` finds `projects/kasten/api-design.md`. A run of
letters scores above the same letters scattered, a letter opening a folder name
scores above one buried in it, and a letter landing in the note's own name
scores above one that only matched the folder, so `arch` finds
`kasten/architecture.md` before `archive/march.md`. Typing a folder still
narrows, which is what `kasten/arch` is for.

Beside the list sits the note under the highlight, as plain text. It is for
telling two notes apart, not for reading one, so there is no highlighting and no
editor. The text arrives a moment after the highlight stops moving, which is
what keeps a held Ctrl+n from reading every row it passes. A note that cannot be
read says `could not read this note`, and Enter still opens it.

The line underneath says `no notes match` for a query that reads into nothing,
and `the vault has no notes` for a vault with nothing in it yet. Enter does
nothing in either case.

## The note search

`<leader>fg` and the tree's `s` open search over what is written in the notes,
rather than over their names. Telescope spells the pair this way, `find_files`
and `live_grep`, which is where `ff` and `fg` come from. Nothing typed here has
to name a path, and search never writes.

| Key | Does |
| --- | --- |
| any character | Narrow to the lines holding the query |
| Down / Ctrl+n | Move the highlight down one row |
| Up / Ctrl+p | Move the highlight up one row |
| Enter | Open the note on the line the match is on |
| Escape | Close, and hand the focus back |

One row per matching line, showing the note, the line number and the line
itself. Enter opens the note with the cursor on that line, centred rather than
scrolled just barely into view, and the line lands in the URL as `?line=`, so a
reload comes back to the match instead of the top of the note.

Beside the list sits the note around the highlighted hit: numbered lines, the
matching one marked, centred in the pane and scrollable either side of it. The
pane shows thirty lines each way rather than the whole note, so a long note
costs what a short one does. The text arrives a moment after the highlight
stops moving, which is what keeps a held Ctrl+n from reading every note it
passes, and walking between two hits of one note re-centres the pane without
reading the note again. A note that cannot be read says `could not read this
note`, and Enter still opens it.

The panel is wider than the finder's, because a row here carries the path, the
line number and the line, and the pane still needs half.

The work is split in two, and the split is the whole design. The backend finds
the lines holding the query literally, which is the part a browser cannot do
without every note loaded into it. The browser ranks what came back, which is
the part that has to answer per keystroke. It has to be this way round: a
subsequence match is what makes the finder feel fuzzy over note names, and it
means nothing over prose, where an eight letter query still reads into 15% of
the lines in a vault. So a subsequence never chooses the lines here, only their
order.

That split is also why typing keeps narrowing. Reading the vault waits for the
typing to settle, but the lines already in hand are ranked against every
keystroke, so the list tightens while the next scan is still out rather than
freezing until it lands.

The line underneath says `type to search every note` before anything is typed,
`reading the vault` while a scan is out, and `no notes match` when the vault
holds nothing that matches. See [GET /api/search](/reference/http-api.md) for
what the backend does and does not look at.

## Saving

| Key | Does | Mode |
| --- | --- | --- |
| `:w` | Write the note | normal |
| Ctrl+S | Write the note | any |

Neither is new to this page. Writing also happens on its own, about a second
after you stop typing.
