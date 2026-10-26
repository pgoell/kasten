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

On a desktop the rejected column is folded away at first. A click on its heading
unfolds it. Moving the cursor onto it with `l` unfolds it too.

The rows are lanes. The board opens with a lane for each of `#client`,
`#internal` and `#private` that has cards, then `No kind` for the rest. A part
with no kind tag sits in its parent's lane. `g` switches to a lane per project
and back, with `No project` first. The backend says which project a todo is
in, by the [five steps](/reference/todo-format/tags-projects-and-views.md#projects).
A tap or a click on a lane's heading folds or unfolds it. A folded lane still
shows its count of cards in its heading, and a card dropped on it writes nothing.

Every todo is a card, a part too, and cards sit on paper. A card shows the
priority, the words, the count of its parts, what it waits for after a `⛔`, and
the due date cut as the list cuts it. An overdue date is red. A part names the
todo it is part of on a line above, after a `↳`.

| Key | What it does |
| --- | --- |
| `c` | Back to the list |
| `g` | Lanes by kind, or by project. The phone's `kind` and `project` buttons do the same |
| `h` `l` | The column to the left, or to the right. `l` unfolds a folded Rejected |
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

On a phone `board` beside `done`, `next` and `view` does what `c` does. The
board shows one column at a time under a row of state tabs, one per state with
its count. A tap on a tab shows that column. A swipe left or right on the column
shows the next or the previous state. The column follows the finger, and it
gives a little past the first and the last state. A swipe that does not pass a
quarter of the width springs back and shows no other column. A vertical drag
scrolls the page. A touch that starts at the screen's edge belongs to the
system. The swipe stays on the column, so a long press still lifts a card, and
then the column does not swipe. Beside the tabs, the `kind` and `project`
buttons do what `g` does. A lane with no card in the shown state folds on its
own. On a phone `h` and `l` move the shown column as a tab does.

A tap on a card opens its line, and its `⋯` opens a strip: `open`, `doing`,
`review`, `done`, `blocked`, `waiting` and `rejected` move it on one tap,
`project` is `p` and `refile` is `m`. `cancel` beside the project picker's line
shuts it and writes nothing.
