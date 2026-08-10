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
| `<leader>cs` | Open a terminal, on a herdr session you name |
| `<leader>ct` | Start a tab, on one empty pane |
| `<leader>e` | Move the focus to the file tree |
| `<leader>ff` | Open the note finder |
| `<leader>fg` | Open search over note content |
| `<leader>ft` | Open the todo overlay |
| `<leader>gb` | Show what links to the open note |
| `<leader>gd` | Open today's note |
| `<leader>gm` | Open this month's note |
| `<leader>go` | Show what the open note links to |
| `<leader>gq` | Open this quarter's note |
| `<leader>gt` | Put the todo list in the focused pane |
| `<leader>gw` | Open this week's note |
| `<leader>gy` | Open this year's note |
| `<leader>h` | Move to the pane on the left |
| `<leader>j` | Move to the pane below |
| `<leader>k` | Move to the pane above |
| `<leader>l` | Move to the pane on the right |
| `<leader>o` | Move to the next pane |
| `<leader>p` | Turn live preview off, or back on |
| `<leader>q` | Close the note, then the pane, then the tab |
| `<leader>rf` | Open the rename prompt |
| `<leader>th` | Go to the previous tab |
| `<leader>tl` | Go to the next tab |
| `<leader>x` | Cycle the todo on this line |
| `<leader>%` | Split the pane left and right |
| `<leader>"` | Split the pane top and bottom |
| `<leader>1` to `<leader>0` | Go to a tab by number |
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

A rename also moves the links. Every `[[link]]` in the vault that named the note
is rewritten to name it at its new path, and it keeps the spelling it had: a
path stays a path and a bare name stays a bare name, so `[[borges]]` is left
alone by a move between folders and follows a change of name. Renaming a folder
does the same for every note it carries. [The link panels](#the-link-panels)
cover the two ways to read those links.

`<leader>gb` and `<leader>go` are a pair and need a note open, one showing what
links to it and the other what it links to. Both do nothing with no note on
screen, which is how the keys say there is nothing to ask about.

`<leader>e` unfolds the tree first if it was folded away, and lands on the row
the tree cursor is already on. Escape in the tree comes back to the editor.

`<leader>q` closes the note only once the vault holds the text. A write that
fails leaves the note open with the warning in the status bar, because closing
unmounts the editor and the only copy of the edit would go with it. So does a
note something else has written under you, which [Saving](#saving) covers.
[Panes and tabs](#panes-and-tabs) covers what the key does after that.

`<leader>p` and `<leader>b` keep their setting while you move between notes,
and start again from on and open when you reload the page.

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

Every pane in a divided window is drawn inside a border, and the border of the
focused one is blue. A window holding a single pane has no border, having
nothing to tell it apart from.

No pane or tab key on this page moves while the note in the focused pane reads
`Changed on disk`. Leaving the pane would write that note, so the key flashes
the status bar and stays put until `:w` or `:e!` settles it, which
[Saving](#saving) covers. A click into another pane is the one thing that still
goes through.

`<leader>ct` starts a tab. `<leader>tl` and `<leader>th` walk them, and
`<leader>1` through `<leader>9` go straight to one, with `<leader>0` for the
tenth, which is where those keys sit on the row rather than what the character
means. An eleventh tab is reached by walking. The strip naming the tabs appears
once there is more than one, and each tab is named for the note in the pane it
left focused, for the herdr session when that pane holds a terminal, and
`todos` when it holds the todo list.

`<leader>q` walks back out of all of this, one press at a time. On a pane
holding a note it writes the note and empties the pane, and it takes a terminal
or the todo list out of a pane the same way. On an empty pane it closes the
pane. On the last pane of a tab it closes the tab. On the last pane of the last
tab it does nothing, because a window with nothing on screen is not a state
worth reaching.

An empty pane is an editor on an empty document, which is what the window has
always shown with no note open. Text typed into one goes nowhere and closing
the pane discards it.

The arrangement is not in the URL. `?note=` names the note in the focused pane
and follows it from pane to pane, so a reload comes back to what you were
reading, in a single pane, with the tabs and splits gone. The back button steps
through pages rather than through panes.

## Terminal

`<leader>cs` puts a shell in the focused pane. It opens a prompt asking what the
herdr session is called; letters, numbers, `-` and `_`, up to 64 characters. A
name nothing answers to starts a fresh session, and a name that is already
running attaches to it.

The multiplexer is [herdr](https://herdr.dev) rather than tmux, running the
config in `shell/herdr.toml`, which is the one on this VPS at
`~/.config/herdr/config.toml`, itself migrated from `~/.tmux.conf`. So the
prefix is `Ctrl+Space` and the keys inside the session are the ones you already
press over ssh. That config is baked into the image and read through
`HERDR_CONFIG_PATH`; herdr's own sockets and session history live in the
container's home volume, which is what makes a session survive a restart.

The shell runs in its own container with the vault mounted at `/vault`, beside
jj, rg, git, Claude Code and codex. The two agents are fresh installs and sign
themselves in inside the container, so the first one you start asks you to log
in; nothing of your own home directory is in there, and the vault is the only
thing the container shares with the machine. The session outlives the pane, the tab and
the browser, so closing the tab and coming back to the same name finds the same
shell with its scrollback and whatever was still running in it. Closing the pane
detaches a client; it does not kill the session.

The list under the input is the sessions that already exist, ranked against
what has been typed, so a half-remembered name is one Tab away and a click on a
row opens it. It offers rather than restricts: a name nothing answers to is
still taken, and starts a session.

A session you no longer want is closed from inside any terminal, in two steps,
because herdr will not delete one that is still running:

```sh
herdr session stop <name>
herdr session delete <name>
```

`stop` ends the session and everything in it; `delete` removes what it left
behind, and the name stops being offered here. A session that is stopped but
not deleted is still on the list, because the list is what exists.

It says what exists, not what is running. `GET /api/terminals` lists the
directory the shell container keeps one entry per session in, so the backend
never runs herdr and cannot start or stop anything; and `herdr --session`
attaches to a stopped session and starts a missing one alike, which makes the
distinction one you do not have to care about here. `herdr session list` inside
any terminal is where the running state is. The list is empty when the shell
container is not up, and the prompt is then a bare input.

The keys below are the only ones kasten takes back inside a focused terminal.
They are not leader keys and cannot be: the leader is the space bar and a shell
must receive the space bar, so nothing kasten owns can reach into a terminal as
a leader sequence. Every other key, the space bar included, goes to the shell.

| Key | Does |
| --- | --- |
| `Ctrl+Shift+H` | Move to the pane on the left |
| `Ctrl+Shift+J` | Move to the pane below |
| `Ctrl+Shift+K` | Move to the pane above |
| `Ctrl+Shift+L` | Move to the pane on the right |
| `Ctrl+Shift+O` | Move to the next pane |
| `Ctrl+Shift+Q` | Take the terminal out of the pane |

They are `Ctrl+Shift` because a terminal cannot transmit most of those chords,
so claiming them costs the shell nothing. That is a reason to expect them to
work, not evidence that they are comfortable, and they are expected to change.
`TERMINAL` and `TERMINAL_CHORD` in `frontend/src/lib/key-bindings.ts` are the one
place to change them; the component, the `<leader>?` panel and its test all
derive from those two. This table does not, and has to be edited by hand.

`Ctrl+Shift+Q` empties the pane rather than removing it, which is what
`<leader>q` does to a note. That is also the way out of a window that holds
nothing but a terminal: there is no chord that splits, so with one terminal
pane the directions have nowhere to go and `Ctrl+Shift+O` wraps to itself. One
press puts an editor back in the pane and every leader key with it, splits
included. The herdr session goes on running either way, because closing the
socket detaches a client rather than ending the session.

They do not collide with herdr's own keys, which is the other reason to hold
`Ctrl+Shift`: herdr's prefix is `Ctrl+Space`, its tab keys are `Alt+Shift+H` and
`Alt+Shift+L`, and its pane navigation is `Ctrl+H` through `Ctrl+L`. Kasten
takes the shifted `Ctrl` variants and leaves all of those alone, so the six
chords move between kasten's panes and everything else moves within herdr's.

`Ctrl+Shift+H` is also Highlight in the editor. The two never meet: a chord
pressed in a focused terminal never reaches the editor, and formatting is bound
in insert and visual mode inside a note.

Leaving the browser tab and coming back puts the cursor where it was, in a
terminal pane as much as in a note. Only the focused pane claims it: every pane
would otherwise race for it on the way in, and a terminal has no editor to win
that race with, so the shell would sit there showing nothing focused and
dropping every key until you clicked into it.

A terminal pane is not in the URL. `?note=` names a note, and a terminal names
nothing, so a reload comes back to an empty pane. `<leader>cs` and the session
name is how you get back to it, which is the mechanism the sessions already have.

## Todos

A todo is a checkbox line in a note, and [Todo
format](/reference/todo-format.md) is what one is written in. Three keys reach
them. `<leader>x` makes and walks one where you are typing, `<leader>gt` puts
the whole vault's list in the focused pane, and `<leader>ft` opens that same
list as an overlay.

`<leader>x` cycles the line the cursor is on. A plain line becomes `- [ ]`, four
more presses walk it through doing, done, blocked and rejected, and a sixth
gives the words back as prose. It edits the buffer, so `u` undoes it and the
autosave writes it. [The cycle](/reference/todo-format.md#the-cycle) says what
each press stamps.

The editor draws each state as a symbol in place of its box, `☐ ◐ ☑ ⊘ ☒`, and
mutes and strikes through a line that is done or rejected. A due date that has
passed is drawn in red. The whole drawing comes off the line the cursor is on,
in insert and visual mode, the way every other construct does, so `i` hands the
`- [x] ` back. The red is the one part that stays, because it colours text that
is on screen either way rather than standing in for characters.

Today's date is read when the editor builds its rendering, so a tab left open
across midnight keeps yesterday's idea of overdue until it reloads.

## The todo pane

`<leader>gt` fills the focused pane with every open todo in the vault, grouped
by when it is due, under Overdue, Today, This week, Later and No date. An empty
group draws no heading. A row is the state's symbol, the priority where there is
one, the words, and the day of the due date. A blocked row is drawn muted and
sits in the group its due date names rather than under a heading of its own, its
state already being written on the line. The footer counts the rows, so many
open and so many blocked.

Only open todos are listed. One that is done or rejected is not work, and the
session lines `GET /api/todos` also matches are not todos, so neither is here.

| Key | Does |
| --- | --- |
| `j` / `k` | Move the cursor down or up |
| Enter | Open the note the todo is in |
| `x` | Cycle the todo under the cursor |
| `a` | Add a todo to today's note |
| `d` | Show what was finished in the last seven days |
| `/` | Narrow the list |
| `q` | Close the pane |
| Escape | Back to the editor |

Leader sequences work here too, so `<leader>gd` opens today's note from inside
the pane. `<leader>x` is not among them, and that is right: there is no buffer
under this cursor, and the bare `x` is the key that acts on a row.

Enter opens the note into this pane, which is what clicking a row in the file
tree already does, and `<leader>gt` brings the list back in one press.

`x` writes the vault rather than a buffer. The note the row names is read again
first, so a row that has gone stale since the last fetch cycles nothing, and the
note redraws in whatever pane is showing it. Ticking one done also writes the
[done log](/reference/todo-format.md#the-done-log) line into today's daily note.

`/` moves the focus to the filter line, because `j` and `k` have to go on moving
the cursor. Escape or Enter hands the focus back to the list and leaves the
filter applied. [Filter terms](/reference/todo-format.md#filter-terms) are what
it takes. Anything that is not a term ranks as text, and here the ranking
decides only which rows stay: the groups keep the order.

`d` swaps the list for what was finished in the last seven days, grouped by the
day it was finished rather than by when it was due, newest day first. A finished
todo has no due date worth grouping on, and a list reaching back to the
beginning of the vault is not one anybody reads to the end of. Pressing `d`
again brings the open list back.

`a` opens the add prompt over the pane. Type one line of
[shorthand](/reference/todo-format.md#the-add-prompts-shorthand), read the line
it will write under the input, and Enter puts it under `## TODOs` in today's
daily note, making that note where the vault has none. Escape closes and writes
nothing, and Enter on an empty input does nothing.

The pane is not in the URL. Terminal panes are not either, and the arrangement
of panes is already lost on a reload, so a reload comes back to an empty pane
and `<leader>gt` is one press.

The list is read again on every write the vault reports over `/api/events`, so a
todo written by an agent or over ssh appears without a reload.

## The todo overlay

`<leader>ft` asks the same question in the panel the finder and search use:
ranked list on the left, the note under the highlight rendered on the right, and
Enter opens it on the todo's line. A row is the note, the line number, the
todo's state symbol beside its words, and the due date where it has one. The
keys are [the note search's](#the-note-search).

It is that panel's backlinks mode rather than its search mode. The vault is
asked once and typing only ranks what came back, because what there is to do is
a set the vault decides and the input was never choosing the rows. So there is
no debounce here and no scan per keystroke.

The line underneath says `no open todos` for a vault with nothing to do in it.

The overlay and the pane share one answer, so opening one after the other reads
the vault once.

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

## Wikilinks

`[[reading/borges]]` is a link to another note. The editor renders it as the
name alone, in the link colour, with the brackets off the screen the way every
other mark is hidden, and `i` on that line hands them back.

| Key | Does | Mode |
| --- | --- | --- |
| `gf` | Open the note the wikilink names | normal |
| Ctrl+click | The same, with the mouse | any |

`gf` is vim's own go-to-file, and it reads the link under the cursor. Anywhere
in the name will do, the last letter included: the closing `]]` is hidden, so
the cursor cannot rest between the name and what follows it, and both edges
count as on the link.

Ctrl+click, or Cmd+click, is the same command with the mouse, and it is the
modifier that browsers already spend on opening a link. A plain click is left
to the cursor, because clicking into a link is how the link gets edited. The
click has to land on the link's own text; it reads the element under the
pointer rather than the nearest position to it, so the space after the line is
not the link. With live preview off there is no rendered link to click, and
`gf` is the way.

What the target names is decided against the vault's own listing:

* A target with a slash in it is a vault-relative path, and is taken at its
  word. `.md` is added unless you typed it.
* A target with no slash is a name, and is looked for anywhere in the vault,
  ignoring case, so `[[borges]]` opens `reading/borges.md` from any note. A
  note of that name at the vault root wins over one in a folder.
* A target nothing answers to is a note that is not there yet. Following it
  makes an empty note at that path, folders on the way included, and opens it.

That last one is the point of writing a link before the note: `gf` is where the
note begins. It uses [POST /api/files/{path}](/reference/http-api.md), so a path
the vault refuses, a hidden name or a note standing where the link wanted a
folder, leaves you where you are with the link still on screen to be fixed.

A link whose note is not there yet is drawn muted, with a dotted underline
rather than a solid one, so the two kinds are told apart before you follow
either. It is not a warning colour: an unwritten note is an invitation, and
following the link is what accepts it. The link comes to life on its own as
soon as the note exists, without reopening the one you are reading. Nothing is
marked dead where the vault listing has not arrived, so the finder's and
search's preview panes draw every link as one that lands.

## Completing a link

Type `[[` and the vault's notes are offered, filtered as you go. The rows are
paths without the `.md`, so `[[kast` reaches `projects/kasten` and typing a
folder narrows the same way it does in the finder.

| Key | Does |
| --- | --- |
| Down / Up | Move through the notes on offer |
| Enter | Take the highlighted one |
| Escape | Close the list and keep typing |

Taking one closes the link with `]]`, because typing `[[` does not: markdown's
close-brackets answers a `[` with nothing. A link you closed yourself gets no
second pair.

The whole vault goes into the list every time and CodeMirror scores the names
against what has been typed, which is the same fuzzy match [the note
finder](#the-note-finder) does by hand and one this does not have to repeat.

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
vault, so they are drawn as [the note search](#the-note-search) draws them, one
row per line with the note, the line number and the line itself, and Enter opens
the note on that line. Outgoing links are notes, so they are drawn as [the note
finder](#the-note-finder) draws them, one row per note, and Enter opens it.
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

The line underneath says `nothing links here` for a note nothing points at, and
`this note links nowhere` for one that points at nothing.

Both panels are a snapshot of the moment they opened. Nothing behind them is
being edited while they are up, so there is nothing for them to keep up with.

## Periodic notes

Five keys open the note covering today, one per stretch of time. They finish the
`g` group: `d` for the day, `w` for the week, `q` for the quarter and `y` for the
year, and `m` for the month because `go` is spent on the panel above.

| Key | Note | Path |
| --- | --- | --- |
| `<leader>gd` | Today | `01 Periodic/00 Daily/2026-08-06.md` |
| `<leader>gw` | This week | `01 Periodic/01 Weekly/2026-W32.md` |
| `<leader>gm` | This month | `01 Periodic/02 Monthly/2026-08.md` |
| `<leader>gq` | This quarter | `01 Periodic/03 Quarterly/2026-Q3.md` |
| `<leader>gy` | This year | `01 Periodic/04 Yearly/2026.md` |

The key opens the note if the vault holds it and makes it if it does not, so
there is one key rather than a key to make and another to open. The date is read
at the press: a tab left open overnight opens the new day's note.

A note the key makes starts with a heading and one line of links, under the
frontmatter every note carries. The daily note carries its weekday too, because
a date alone does not say which day it was.

```markdown
# 2026-08-06 Thursday

[[01 Periodic/00 Daily/2026-08-05]] | [[01 Periodic/01 Weekly/2026-W32]] | [[01 Periodic/00 Daily/2026-08-07]]
```

Three links: back one, up to the note holding this one, and on one. The year has
no note above it, so a yearly note carries two.

The links are written whether or not the notes on either side exist yet, which
is what makes the chain walkable in both directions. Tomorrow's note is a note
nobody has written, so the editor draws it dotted and `gf` on it makes it. That
is also why nothing goes back to rewrite the note behind: a note made this way
already points forwards.

The week is the ISO one, counted from its Thursday, so 2027-01-01 opens
`2026-W53` rather than a week of 2027. The month above a week is that Thursday's
month for the same reason: `2026-W53` links up to `2026-12`, not to `2027-01`.

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

The tree opens with every folder folded away, so what you first see is the top
level and the notes at the vault root. A folder's contents are not drawn until
you open it, which is what keeps a big vault cheap: at 10,000 notes that is 8
rows on screen rather than 10,842. The folders on the way to the open note are
unfolded for you, so a reload lands on the note it says is open rather than on
a tree that has hidden it.

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
| Down / Ctrl+n / Tab | Move the highlight down one row |
| Up / Ctrl+p / Shift+Tab | Move the highlight up one row |
| Enter | Open the highlighted note |
| Escape | Close, and hand the focus back |

Tab walks the list rather than completing anything, the way it does in a
terminal fuzzy finder. There is nothing here to complete: Enter opens the row
under the highlight whatever the input says. It is answered even with an empty
list, which is the one place the key would otherwise take the focus out of the
panel and not bring it back.

The list ranks every note in the vault, then shows the best twenty. The query
reads as a subsequence, so `kap` finds `projects/kasten/api-design.md`. A run of
letters scores above the same letters scattered, a letter opening a folder name
scores above one buried in it, and a letter landing in the note's own name
scores above one that only matched the folder, so `arch` finds
`kasten/architecture.md` before `archive/march.md`. Typing a folder still
narrows, which is what `kasten/arch` is for.

Beside the list sits the note under the highlight, rendered the way the editor
renders it: headings sized, lists drawn, marks hidden. The pane shows the note
as opening it will, which is what makes two notes easy to tell apart. Nothing
in it can be typed into, and the keys stay with the input. The text arrives a
moment after the highlight stops moving, which is
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
| Down / Ctrl+n / Tab | Move the highlight down one row |
| Up / Ctrl+p / Shift+Tab | Move the highlight up one row |
| Enter | Open the note on the line the match is on |
| Escape | Close, and hand the focus back |

One row per matching line, showing the note, the line number and the line
itself. Enter opens the note with the cursor on that line, centred rather than
scrolled just barely into view, and the line lands in the URL as `?line=`, so a
reload comes back to the match instead of the top of the note.

The panel is the finder's, at the same size and split the same way down the
middle. Beside the list sits the note around the highlighted hit, rendered the
same way the finder's pane renders it: numbered lines, the matching one marked, centred
in the pane and scrollable either side of it. The numbers are the note's own,
so a hit deep in a note still says where it is. The
pane shows thirty lines each way rather than the whole note, so a long note
costs what a short one does. The text arrives a moment after the highlight
stops moving, which is what keeps a held Ctrl+n from reading every note it
passes, and walking between two hits of one note re-centres the pane without
reading the note again. A note that cannot be read says `could not read this
note`, and Enter still opens it.

One thing the window costs: it slices the note at a fixed distance from the
hit, so a fenced code block that opens above the window and closes inside it
leaves the pane rendering a closing fence it never saw open. The note itself is
one Enter away and renders correctly there.

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
| `:e` | Read the note off the vault again | normal |
| `:e!` | The same, throwing away unsaved text | normal |

`:w` and Ctrl+S are not new to this page. Writing also happens on its own,
about a second after you stop typing.

Something outside kasten writing the note is answered while it is open. A note
you are not typing into simply takes the new text, with the cursor where you
left it. A note holding unsaved edits keeps them instead: autosave stops, and
the status bar wears the warning sign, labelled `Changed on disk`.

Two commands end that state, and they are the two answers to the one question
it asks, which writer wins. `:w` writes your buffer over the vault and keeps
what you typed. `:e!` throws your buffer away and takes what the vault holds.
Nothing else settles it: until one of them is pressed, nothing you typed
reaches the vault and nothing the other writer left reaches your screen.

`:e` without the bang is vim's own reread and behaves the way vim's does. It
takes the note off the vault when nothing is waiting to be written, and
declines when something is, flashing the reading in the status bar the way
every refused key below does. The bang is what says throw it away. Either way the vault is read before anything is discarded, so a `:e!`
whose request fails leaves the buffer and the warning exactly where they were
rather than dropping your only copy on the strength of a read that never
landed.

While `Changed on disk` stands, every way from here to another note asks first
and takes the refusal. A row clicked or opened in the tree, a hit taken out of
the finder or search, a `[[link]]` followed with `gf` or Ctrl+click, the create
prompt on `<leader>cf` or the tree's `c`, and `<leader>q` closing the note all
leave the pane exactly where it is. So do `<leader>rf` and the tree's `r`, but
only when what they would move is the open note itself or a folder it sits
under: a rename anywhere else in the vault goes ahead, because a conflict in
this pane is no reason to refuse to move some other note. `<leader>go` opens
its panel anyway, on the older text, reading the links being no reason to
overwrite. A `gf` at a link to a note that is not there still makes the note;
it just leaves it unopened.

The keys that move the focus decline too, because the autosave follows the
focused pane and would write this note on its way to the next: `<leader>o`,
`<leader>h`, `<leader>j`, `<leader>k`, `<leader>l`, the splits `<leader>%` and
`<leader>"`, `<leader>ct`, `<leader>th`, `<leader>tl`, `<leader>1` to
`<leader>0`, and a tab clicked in the strip. The reading in the status bar
flashes each time one of them is refused, so a key that did nothing reads as
refused rather than as broken. Every one of them works again the moment `:w` or
`:e!` settles the note.

One way past is left, and it takes a divided window and a mouse: clicking into
another pane moves the focus without asking, and the note you were typing into
is written as the autosave changes over. The browser has already moved the
focus by the time the app hears about it, so refusing would mean either pulling
it back, which fights the hand that moved it, or leaving a pane whose border
says focused while the cursor is somewhere else. Every key into that pane
refuses, so this is the one route that still overwrites, and `:w` or `:e!`
first is what avoids it.
