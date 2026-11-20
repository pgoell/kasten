---
type: Reference
title: Save path orderings: moving a todo between notes, and the edit row
description: The orders in which a todo pane's refile with m, and a card dropped on another project lane, can meet a refusal or a press before them, what must hold in each, and whether getting it wrong loses a todo; the orders a redraw and the store's answer can meet an open edit row in; and the prompts of s, a and b against a refusing store.
resource: frontend/src/lib/notes/note/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests, todos]
status: stable
---

# Save path orderings: moving a todo between notes, and the edit row

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page, so "As 82" points to the same row wherever it sits.

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| 117 | The todo pane's `m` refiles a todo into its project's `index.md`. | One write: a `PATCH` of the todo's store row, by its id, at the version listed, naming the project and the note; a part also leaves its parent, or it would stay drawn under it. The pane reads and writes no note text. A todo with no project, or one in its project's note already, writes nothing and the notice says why. | no | home-route-refile: `#2191 m moves the todo into its project's note in the store, at the version listed`, `#2191 a part leaves its parent as it moves`, `#396 I5 a todo with no project moves nothing, and names p and a #p/x tag`, `#396 I7 a todo already in its project's note stays` (#396, #2191) |
| 118 | As 117, but the store refuses the write: a version older than the row's, or another reason. | Nothing moves, and the notice says `Nothing moved:` and the store's reason. | no | home-route-refile: `#2191 a move the store refuses says why` (#2191) |
| 119 | As 117, but the second write fails, or the todo or a line under it changed between the read and that write. | Gone: `m` is one write, so no half move can leave the todo in both notes or in none. | no | None: the ordering no longer exists. |
| 120 | `m` while either note holds text a failed save left, or while a write of either is in the air. | Gone: `m` reads and writes no note text, so there is no unsaved text for it to write over. | no | None: the ordering no longer exists. |
| 121 | `m` on a project with no `index.md`. | Gone: the pane makes no note; the move is the one write of 117 whatever the project's folder holds. | no | None: the ordering no longer exists. |
| 122 | Two `m` presses back to back on two todos of one note, before the list redraws. | Gone: each `m` names its own todo by its id, one write at a time (`inTurn`), so the first cannot shift the second. | no | None: the ordering no longer exists. |
| 123 | A card dropped on another lane of the board, with lanes by project, including a card from "No project". | The same write as 117, with the lane's project in place of the todo's. | no | home-route-refile: `#397 A2 a card dropped on another project lane moves into that project's note`; todo-drag: `#397 A2 a drop on another project lane in the same column refiles there, from No project too` (#397) |

## The edit row

The rows below are the todo pane's `i`, whose line stays open across redraws (#2087).

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| 149 | `i` straight after an `x`, typed into past the redraw in which the `x`'s answer moved the row into another group. | The line stays open on the todo, found by the words it was typed over, with its caret and every key; Enter writes the todo by its id. | yes | e2e `todos/board.spec.ts`: `x then i keeps the row and every typed key through the redraw, and Enter writes them`, `with vim off, x then i keeps the row through the redraw, and Enter writes it`; `panes/narrow/todo-pane.spec.ts` (phone): `edit tapped after a state press keeps the row and every typed key through the redraw that moves it (#2087)` (#2087) |
| 150 | Rows land above an open edit row, by any write. | As 149, by its words; of twins, the same one by their order while their count holds; with no row of its words, its own row. | yes | e2e `todos/board.spec.ts`: `an edit row follows its todo when rows land above it, and Enter writes there` (#2087) |
| 151 | A redraw leaves an open edit row no row to follow: its twins' count changed, or no row says its words and none is left at its line. | Nothing is written; the line closes, the notice says `Nothing moved: that line left the list while it was edited.` with the whole typed text, and the pane's keys work again. A todo that leaves its note hands its line to the next todo there, which the edit row then follows (#2257). | yes | e2e `todos/board.spec.ts`: `an edit row whose todo left the list closes, keeping its text in the notice, and the keys work again` (#2087) |
| 152 | Enter on an edit whose todo changed in the store since `i` opened. | The edit goes at the version `i` read, stepped past each version a write from this tab made, so the store refuses it over a change from elsewhere and writes nothing over the newer todo. The notice says so and the line opens again on the typed text; a second Enter writes it. | yes | todo-api-store: `#2247 sends the version the edit read, past a press from here but not past a change from elsewhere`; e2e `todos/pane/edit.spec.ts`: `#2247 Enter over a todo changed since i opened writes nothing, says so and keeps the line; Enter again writes it` (#2247) |
| 153 | Enter on an edit whose write fails: a `500` or the network. | As 152: the notice, the line open again on the typed text, and Enter sends it again. | yes | e2e `todos/board.spec.ts`: `an edit that fails with a 500 says so and keeps the text for another Enter` (#2087) |
| 154 | `i`, `b` or `s` on another row of a note straight after an `x` or an edit there, before the list redraws. | Gone as an ordering of its own: each key waits its turn (`inTurn`) and names its own todo by id, as 148 does for a key on the same row, so a write to another row cannot move it. | yes | None beyond row 148's. |
| 155 | Enter on the prompt of `s` (a part) or `a` (a todo) whose store write is refused: a `500`, the network, or a parent deleted since it was listed (`422`). | Nothing lands. The notice says `Nothing moved:` and the store's reason, and the prompt opens again on the typed text, so Enter sends it again; a send that lands clears the notice. Escape closes it and the text is gone. `s` under a parent whose words changed since it was listed lands under it. Before, the typed text was dropped with no notice (#2212). | yes | keys.spec.ts: `#2212 an s the store refuses says why and keeps the part for Enter to send again` (both vims), `#2212 an s under a todo deleted since it was listed …`, `#2212 an a the store refuses …`; strip.spec.ts: `#2212 a part the store refuses … by tap` (all red on main) |
| 156 | `b` whose row changed or was deleted in the store since it was listed, whose picked blocker was deleted, or whose write fails. | Nothing is written and the notice says why: a stale version answers `409`, a deleted row `404`, a blocker that names no todo `422`. The picker does not open again. Before, a deleted blocker was written as an id that names no todo, holding the row blocked for good, with no notice (#2212). | yes | keys.spec.ts: `#2212 a b on a todo changed since it was listed …` (both vims), `#2212 a b whose ${gone} was deleted since it was listed writes nothing and says so` (row and blocker, red on main), `#2212 a b the store refuses says why`; strip.spec.ts: `#2212 a blocked by on a todo changed … by tap` |
