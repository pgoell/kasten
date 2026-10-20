---
type: Reference
title: Editor keys, the todo board
description: The todo board, its columns, lanes, keys, project picker and drag, as the todo pane turns into it.
tags: [editor, keyboard, todos, board, frontend]
status: stable
---

# The todo board

### The board

`c` turns the list into a board and back. The board has seven columns, open,
doing, review, waiting, blocked, done and rejected, each headed with its count. Done
and rejected hold what was finished in the last seven days, as `d` does. A todo
whose start date has not come stays off, as it does in the list.

The rows are lanes. The board opens with a lane for each of `#client`,
`#internal` and `#private` that has cards, then `No kind` for the rest. A part
with no kind tag sits in its parent's lane. `g` switches to a lane per project
and back, with `No project` first. The backend says which project a todo is
in, by the [five steps](/reference/todo-format/tags-projects-and-views.md#projects).

Every todo is a card, a part too. A card shows the priority, the words, the
count of its parts, what it waits for after a `⛔`, and the due date cut as the
list cuts it. A part names the todo it is part of on a line above, after a `↳`.

| Key | What it does |
| --- | --- |
| `c` | Back to the list |
| `g` | Lanes by kind, or by project |
| `h` `l` | The column to the left, or to the right |
| `j` `k` | The next card down the column, or the one above, across lanes |
| Enter | Open the card's line, as a click does |
| `x` | Cycle the card's todo |
| `O` `P` `V` `W` `B` `X` `R` | Move the card to open, doing, review, waiting, blocked, done or rejected |
| `p` | Pick a project for the card: `j` `k` and Enter, or a click, pick, Escape shuts |
| `m` | Move the card's todo into its project's note, as in the list |
| `/` | Filter the cards, as in the list |
| `v` | The next saved view |
| `q` | Close the pane |
| Escape | Back to the editor, or shut the project picker |

`p` lists the folders under `02 Projects` that hold an `index.md`. Picking one
adds a link to that `index.md` to the todo's words, as `i` would write it, and
the todo stays in its note. A card that already links there writes nothing.

A card moves through the write the state keys make in the list, so `X` runs
everything a tick runs. `m` moves a card into its project's note.

A card can also be dragged, with the mouse or, on a phone, after a long press.
Dropped on another column it takes that state through the same write; dropped
on another project lane it moves into that project's note through `m`'s path.
A drop on the cell it left, outside the board, or after Escape writes nothing,
and a drop that changes lane and column at once is refused with a notice. The
keys go to the pane and never to the editor, so vim mode on or off changes
nothing here. The leader keys work as they do over the list.

On a touch screen `board` beside `done`, `next` and `view` does what `c` does.
The board shows one column at a time under a row of tabs, one per column with
its count; a tap on a tab shows that column, and `lanes` beside the tabs does
what `g` does. A tap on a card opens its line, and its `⋯` opens a strip:
`open`, `doing`, `review`, `done`, `blocked`, `waiting` and `rejected` move it
on one tap, `project` is `p` and `refile` is `m`. `cancel` beside the project picker's line shuts it
and writes nothing.
