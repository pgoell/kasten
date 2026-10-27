---
type: Reference
title: Save path orderings: rename, delete and :e
description: The orders in which a rename, a delete, a discard with :e! and a :e can meet one note's write queue, what must hold in each, and whether getting it wrong loses typed text.
resource: frontend/src/lib/note/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings: rename, delete and :e

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page, so "As 82" points to the same row wherever it sits.

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| 66 | Text waiting; rename or delete. | `saveFirst` writes it first, then the command goes. | yes | `writes on the way to another command when nothing is in conflict`, home-route-daily-and-trash: `writes what is waiting before it deletes the note` |
| 67 | The note stands conflicted; rename or delete. | Refused; nothing written. | yes | `writes nothing on the way to another command while the note stands conflicted`, home-route-daily-and-trash: `refuses to delete a note that changed on disk` |
| 68 | W1 out; rename or delete; W1 fails. | `saveFirst` waits for W1 and refuses. | yes | `lets a rename wait for the write in the air, and refuses when it fails` |
| 69 | W1 out; rename or delete; W1 lands. | `saveFirst` waits for W1, then lets the command go. | no | orderings: `lets a rename go once the write in the air lands` |
| 70 | W1 out; rename or delete; W1 refused. | `saveFirst` refuses; status conflict. | yes | orderings: `refuses a rename when the write in the air is refused` |
| 71 | W1 out; W2 queued; rename; W1 fails; W2 lands. | `saveFirst` lets the command go. | no | `lets a rename go when a later write landed after a failed one` |
| 72 | Text waiting or a write out; `:e`. | Refused; the text and the screen stay. | yes | home-route-colon-e: `refuses :e on a buffer holding unsaved text`; use-autosave-failed-writes.test.ts: `refuses :e without the bang while a write is in the air, and holds that write's text when it fails`; home-route-colon-e: `refuses :e while a save is on its way, leaving the screen and the cache alone` |
| 73 | W1 answers; `:e`. | Allowed. | no | `lets :e through once the write has answered` |
| 74 | W1 out; `:e!`; W1 fails. | Nothing held; nothing left in the air. | no | `says nothing is in the air after a write that failed on discarded text`, home-route-colon-e: `does not keep a failed write's text once :e! has thrown it away` |
| 75 | W1 out; `:e!`; W1 lands. | W1's answer is not cached or shown. | no | `still throws the buffer away on :e! while a write is in the air`, home-route-colon-e: `does not let a write in flight put back what :e! threw away` |
| 76 | W1 out; `:e!`; W1 lands; the vault's event for W1 arrives. | `:e!` queues a write of the vault's text behind W1, so the vault ends on it and the thrown-away text does not come back on screen. Keys typed meanwhile go out behind it; its refusal or failure holds nothing. | no | `keeps what :e! threw away out of the vault and off the screen when its write lands after`, `sends keys typed after :e! behind its write, naming that write's answer`, `reloads somebody else's text when the write after :e! is refused, holding nothing`, `holds nothing when the write after :e! fails`, `writes nothing on :e! with no write in the air` (#311) |
| 77 | W1 out; W2 queued; `:e!`. | W2 never goes out. | no | `never sends a write still queued at :e!` |
| 78 | `:e!`; type. | The next write names the text read for `:e!`. | no | `names the vault's text read for :e! once the typing starts again`, `names the text read for :e! as its base after the cache moves under a dirty buffer` |
| 79 | A's flush queued behind A's write; open B; `:e!` in B. | A's flush still goes out: `:e!` drops B's text only. | yes | orderings: `still sends a left note's queued flush after :e! in the next note` |
| 80 | Held text on screen; `:e!`. | Only the entry on screen is dropped; the conflict clears. | no | `drops only the entry the buffer showed on :e!`, home-route-colon-e: `leaves nothing waiting and nothing conflicted behind :e!` |
| 81 | W1 out; `:e!` queues the write of the vault's text behind it; hide; W1 lands; somebody else writes X. | The hide holds and sends nothing for the `:e!` write: it carries no typed text. The clean buffer takes X. | no | `holds and sends nothing on hide while the write after :e! waits its turn` (#311) |
