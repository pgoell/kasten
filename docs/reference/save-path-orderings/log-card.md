---
type: Reference
title: "Save path orderings: the log card and the palette's log commands"
description: The orders in which a tap on a daily note's log card, its Undo, and the palette's Log water, Log coffee and Log alcohol can meet the note's write queue or the vault, what must hold in each, and whether getting it wrong loses a logged line.
resource: frontend/src/lib/log-card.ts
tags: [editor, saving, autosave, frontend, tests, log]
status: stable
---

# Save path orderings: the log card and the palette's log commands

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page. The format of the lines is [Log format](/reference/log-format.md).

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| L1 | A tap on the card, or the palette's entry over today's own note, with or without a write of the note in the air. | One transaction in the buffer, at the end of `## Log` (made at the end of the note where there is none), isolated in the history so `u` takes back that tap alone. Autosave writes it as it writes typing, naming its base, so rows 1 to 28 hold for it and a vault that moved refuses it with `Changed on disk`. No write of its own. | no | log-card: `a tap appends the default line at the end of ## Log`, `a tap makes ## Log where the note has none`, `two quick taps come back one undo each`, `with vim on, a tap leaves vim in normal mode and u takes it back`; palette: `the drink entries writes today's own note in its buffer as one change, and calls no route` (#620) |
| L2 | Two quick taps on the card. | Both lines land, in the order tapped. | no | log-card: `two quick taps both land, in order` (#620) |
| L3 | The card's `Undo` after the tapped line was edited, moved off its start or taken out by hand. | Nothing is written, and the card offers no `Undo`. Otherwise `Undo` takes out exactly that line. | yes | log-card: `Undo takes the tapped line out`, `no Undo once the tapped line was edited` (#620) |
| L4 | The palette's entry with no pane on today's note: two quick commands, a save refused with `409`, a create racing another, a failed write. | Each command reads today's note, appends the line and saves naming the read as its base through `updateNote`, which reads again and retries on `Changed on disk`. A note the listing lacks is created with the `<leader>gd` template; a create answered `NoteExists` writes into the note there. Commands run one after another, so two land in the order given, and a failed one rejects with its message in the notice and does not hold up the next. | no | log-write: `a drink logged into the vault reads the note again after a changed-on-disk refusal and lands`, `a drink logged into the vault lands two quick taps in order even when the first save answers late`, `a drink logged into the vault updates the note that is there when the create finds it already made`, `a drink logged into the vault rejects a failed write, and the next tap still lands` (#620) |
