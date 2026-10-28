---
type: Reference
title: Editor keys on a touch screen
description: What kasten draws for a finger, and what a finger can reach without a key.
tags: [editor, keyboard, touch, frontend]
status: stable
---

# Touch screens

## Touch

What kasten draws for a finger, and what a finger can reach. The steps are in
[Use kasten on a phone](/how-to/use-kasten-on-a-phone.md), and the reasons in
[kasten on a phone](/explanation/kasten-on-a-phone.md).

### What counts as a phone

The app asks the browser two questions and keeps the answers apart.

* **Narrow**: the window is under 768px wide. The query is `(width < 48rem)`,
  which is 768px at the default font size.
* **Coarse**: the primary pointer is a finger. The query is `(pointer: coarse)`.

A phone answers yes to both. A tablet is coarse and wide. A desktop window
dragged thin is narrow and not coarse. Both answers follow the window live, so
a phone turned on its side can stop being narrow.

| Needs | What it brings |
| --- | --- |
| Narrow | [The file tree](/reference/editor-keys/file-tree.md#the-file-tree) as a drawer over the page, closed to begin with. A split stacks its panes top and bottom, and while the keyboard is up only the focused one shows. The status bar says `pane 1/2` and drops the weekday, the week, the version and `zoom`, as [Panes and tabs](/reference/editor-keys/panes-and-tabs.md#panes-and-tabs) says. [The note finder](/reference/editor-keys/finding.md#the-note-finder) and [the note search](/reference/editor-keys/finding.md#the-note-search) draw no preview |
| Coarse | The editor starts [without vim](/reference/editor-keys.md#vim-on-or-off). Rows and buttons are 44px tall. Inputs are 16px. The frame makes room for [the on-screen keyboard](#the-on-screen-keyboard). A terminal draws [a row of keys](/reference/editor-keys/terminal.md#terminal). Each pane draws [its own buttons](#what-each-pane-answers) |
| Narrow and coarse | [The toolbar](#the-toolbar). No rail beside the file tree |
| Narrow, and the last input was a touch | The editor takes [no focus it was not asked for](#focus) |
| A touch, whatever the window | A tap on a wikilink [follows it](/reference/editor-keys/links.md#wikilinks) |
| Neither | A tap or a click [outside a panel](#closing-a-panel) closes it. A tap or a click on a notice in the status bar opens it out in full |

The 44px rows and buttons are: tree rows and the tree's two buttons, tabs, the
status bar, the rows of the palette, the finder, the search, the note prompt and
the terminal prompt, the two buttons of the move prompt, the rows of a person
card and of a book's contents, and every button named on this page as drawn on
a touch screen.

### The toolbar

A row along the bottom edge, under the status bar. When the buttons do not all
fit on one line, the row wraps and the rest go to a second line, which happens
on a 360px or 390px phone once the tab holds a split.

| Button | Does | Command | Key |
| --- | --- | --- | --- |
| `files` | Open or close the file tree | `toggleTree` | `<leader>b` |
| `find` | Open the note finder | `findNote` | `<leader>ff` |
| `search` | Open search over note content | `searchNotes` | `<leader>fg` |
| `run` | Open the command palette | `openPalette` | `<leader>:` |
| `today` | Open today's note | `openDaily` | `<leader>gd` |
| `todos` | Open the todo pane | `openTodos` | `<leader>gt` |
| `log` | Open the log | `openLog` | `<leader>gf` |
| `chat` | Open the chat with Claude Code | `openChat` | `<leader>cc` |
| `pane` | Move to the next pane. Drawn only while the tab holds more than one | `nextPane` | `<leader>o` |
| `space` | Open the which-key panel, as Space does | none | `Space` |

Each button runs the command its key runs and nothing more, and `space` opens
the which-key panel and runs nothing. Every other leader
command is a row of [the command palette](/reference/editor-keys/leader.md#the-command-palette), which `run`
opens.

A tap on a button leaves the focus where it was. `run` tapped while you type in
a note opens the palette over that note, with its inserts and edits listed, and
the on-screen keyboard stays up. Tapped with nothing focused, it lists the
leader commands only.

The toolbar stays on screen while the keyboard is up. Under an open drawer it
answers nothing.

### The on-screen keyboard

With the keyboard up, the cursor's line, the status bar and the toolbar all
stay above it. Chrome on Android shrinks the page for the keyboard. Safari on iOS
covers the page, so there the frame reads `window.visualViewport` and pads away
the covered part. A prompt, the palette, the finder and the search stop at the
top of the keyboard the same way, input first. A zoomed page is padded too.
In a narrow window with a split, the focused pane alone takes the full height
while the keyboard is up.

Under a coarse pointer these inputs are 16px: the prompts, the todo pane's
filter and edit line, the graph's query, the review's two fields and the token
name. The editor's own text keeps its size.

### Focus

In a narrow window the editor takes the focus after a key moves to its pane or
opens its note, and not after a tap does. A tap on `pane`, on a row of the tree
or on a row of the finder shows the note, and a tap on its text focuses the
editor. A tap on a pane of a split moves the focus to that pane. An editor that holds the focus keeps it, and coming back to the browser
tab hands it none.

This goes by the last input, so a phone with a keyboard attached gets the focus
after its keys. Before any input a coarse pointer counts as a touch, so a page
that has just loaded there focuses nothing.

A wide touch screen gives the editor the focus after a tap, as after a click. A
terminal pane takes the focus at any width.

### Closing a panel

Every panel over the page closes on a tap or a click outside it: the palette,
the finder, the search, the prompts, key help and the which-key panel. It closes on the
release. A press inside the panel closes nothing, and neither does a press that
starts on one side of the panel's edge and ends on the other, a selection
dragged out of the input being the usual one.

A prompt holding something typed stays open: the note, todo, dump, clip and
terminal prompts close only on Escape, or on their own Enter, once their input
has changed.

The drawer closes on a tap outside it. A book's contents close on a tap on the
dimmed page around them.

### What each pane answers

| Pane | By touch | Stated in |
| --- | --- | --- |
| A note | A tap on the text focuses the editor and puts the cursor there. A tap on a wikilink follows it. A tap on a callout's arrow folds or unfolds it | [Wikilinks](/reference/editor-keys/links.md#wikilinks), [Callout format](/reference/callout-format.md#folding) |
| The file tree | A tap on a note, an image or a page opens it. A tap on a folder folds or unfolds it. Two buttons in the header: new note, and hide the tree | [The file tree](/reference/editor-keys/file-tree.md#the-file-tree) |
| An image | Two fingers zoom, one finger moves the zoomed picture. `delete` in the header, on its second tap | [The file tree](/reference/editor-keys/file-tree.md#the-file-tree) |
| A pdf | Two fingers pinch the page to zoom, one finger pans it when zoomed, and a double tap toggles fit width and 200 %. The header's buttons share that zoom | [The pdf pane](/reference/editor-keys/panes-and-tabs.md#the-pdf-pane) |
| The todo pane | A tap on a row opens its line. The state symbol cycles the todo, on its second tap. `+` adds one. `done`, `next` and `view` change the list, and `board` turns it into the board. `⋯` opens a strip of states, `timer`, `part`, `edit`, `blocked by`, `refile` and `agent`. The footer shows the count alone, with no keys | [The todo pane](/reference/editor-keys/todo-pane.md#the-todo-pane) |
| The graph | One finger pans or drags a note, two zoom about the point between them, a double tap on the background fits, a tap opens a note; the vault graph opens where names read, and the touch row shows the zoom; in the vault graph a tap picks the note into the panel's card, and Open or a second tap opens it. A tap on a hollow ring asks before it makes the note. `fit`, `depth -` and `depth +` | [The graph pane](/reference/editor-keys/panes-and-tabs.md#the-graph-pane) |
| A book | A swipe or a tap in the left or right quarter turns the page. `Contents` and `Take` at the foot | [The book pane](/reference/editor-keys/book-pane.md#the-book-pane) |
| A video | A tap on the player's shield plays or pauses it, and the pane keeps the focus. A tap on the count goes to the next video, and a tap on a chapter seeks to it. The shield covers YouTube's own controls, so a tap on `Full screen` in the header takes the player full screen instead, and `Exit full screen` on the player brings it back. Safari on an iPhone cannot make a box full screen, so there the button is not drawn | [The video pane](/reference/editor-keys/video-pane.md#the-shield) |
| A video's transcript | In the video view, a tap on a paragraph's time seeks the video there. Select words to take them: the `Take` button sits under the words and writes the take into the video's note | [Take](/reference/editor-keys/video-pane.md#take) |
| A person card | A tap on a row opens the line it names | [The person card](/reference/editor-keys/links.md#the-person-card) |
| A note's history | A tap on a change shows its diff against the note now. `Restore` writes the change shown back over the note | [The history pane](/reference/editor-keys/panes-and-tabs.md#the-history-pane) |
| The review | A tap on the question shows the answer. Swipe the answer right for Good, left for Again, past 38 % of the card's width counting how fast the finger leaves; a shorter swipe grades nothing. Every other move is a button | [The review pane](/reference/editor-keys/review-pane.md#the-review-pane), [Reviewing cards](/reference/flashcard-format/reviewing-cards.md#sitting-one) |
| A practice exam | An option is a button. A row of moves: `prev`, `next`, `reveal`, `timer`, `finish`, `close`. `finish` acts on the second tap, and so does `close` while a sitting is under way | [Sit it by touch](/how-to/write-a-practice-exam.md#sit-it-by-touch) |
| A terminal | A tap focuses it. A row of keys: `Esc`, `Tab`, `Ctrl`, the arrows, `\|`, `/`, `-` | [Terminal](/reference/editor-keys/terminal.md#terminal) |
| An HTML page | The page's own links and buttons. `Open in a browser tab` in the header | [The file tree](/reference/editor-keys/file-tree.md#the-file-tree) |
| The status bar | A tap on a notice, or on the save sign of a failed write, opens it out in full. Under a failed write are `Write my text` and `Drop my text`, and under `Changed on disk` `Write my text` and `Take the vault's`. `Not saved: <note>`, a failed write of a note already left, names the notes whose text kasten holds; opening one puts the text back. `Changed on disk: <note>` names a note left while it stood conflicted; opening it shows what differs | [Panes and tabs](/reference/editor-keys/panes-and-tabs.md#panes-and-tabs) |
| The palette, the finder, the search, a prompt | A tap on a row does what Enter on it does | [The command palette](/reference/editor-keys/leader.md#the-command-palette) |

### Still keys only

* Renaming or deleting a folder.
* Renaming or deleting a note or an image from its row in the tree, without
  opening it. An open note is renamed and deleted from the palette, with
  `Rename the note` and `Delete the note`. An open image has `delete`.
* Moving a row of the tree by dragging it. The rename prompt takes a new
  folder, which moves an open note.
* `:copy` with a line range. The three copy rows of the palette take the
  selection.
* An exam timer of another length than 30, 60, 90, 120 or 180 minutes.
