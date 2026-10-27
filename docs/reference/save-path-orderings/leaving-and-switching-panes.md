---
type: Reference
title: Save path orderings: leaving a note and switching panes
description: The orders in which a flush on leaving a note, an unmount, and a focus moved to another pane can meet the write queue, what must hold in each, and whether getting it wrong loses typed text.
resource: frontend/src/lib/note/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings: leaving a note and switching panes

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page, so "As 82" points to the same row wherever it sits.

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| 50 | W1 out; type T2; open B. | The flush waits behind W1, names W1's answer, and puts T2 in A's cache as it leaves. | yes | orderings: `queues the flush on leaving behind the write in the air and names its answer` |
| 51 | Type in A; open B; A's flush fails. | A's text held for A; B's status, base and failures untouched. | yes | `holds the left note's text when the flush on the way out fails`, `leaves the next note alone when the old note's flush fails and it is left untouched`, `keeps the next note's own failure alone when the old note's flush fails` |
| 52 | Type in A; open B; A's flush answers late. | B's status and base are B's own. | no | `does not call the next note saved when the old note's flush answers late`, `names the new note's own save as its base when the old note's flush answers late` |
| 53 | A stands conflicted; open B or unmount. | A held as conflicted; nothing written. | yes | `holds a conflicted note's text and writes nothing when another note is opened`, `holds a conflicted note's text and writes nothing when the editor goes away` |
| 54 | Type; unmount the editor; the flush fails. | Text held. | yes | `holds the text when the flush on unmount fails`, home-route-held-text: `keeps the text when leaving the editor route fails to save it, and says so on return` |
| 55 | Type T1; leave; reopen while the flush is out; type T2. | The buffer opens on T1; W2 names the flush's answer; no conflict. | yes | `reopens a note on the flush's text and names its answer behind it` |
| 56 | Type T1; leave; reopen while the flush is out; the flush fails. | T1 stays on the clean screen, taken as held; status error. | yes | `keeps a failed flush's text on the screen it reopened on`, home-route-held-text: `keeps a flush that fails after the note was reopened on screen, and saves it from there` (#387) |
| 57 | Leave; reopen; the flush is refused; a save on reopen is refused. | Both texts kept. | yes | `keeps both texts when a flush refused after the reopen is followed by a refused save`, `keeps a flush refused after the reopen beside text the hide held there` |
| 58 | A write is out; the note moves; the write fails. | The text is held under the new path. | yes | `holds a write that fails after its note moved under the new path`, `drops the held entry a move carried when the write in the air lands` |
| 59 | Type in pane a; focus pane b on the same note. | Pane a's text is written first. | yes | `writes a first pane's unsaved text before a second pane on the same note types` |
| 60 | Nothing waiting; focus pane b. | Nothing sent. | no | `sends nothing on a pane switch on the same note with nothing waiting` |
| 61 | W1 out from pane a; focus pane b showing T1; type. | W2 names W1's answer; no conflict. | yes | `lets a second pane type on the first pane's text while its write is in the air`, `follows the queue in a second pane that took the first pane's text before it got the focus` |
| 62 | W1 out from pane a; pane b still shows the text before T1; type. | W2 names that old text; the refusal holds both. | yes | `names the old text from a pane that never took the first pane's, and holds the refusal` |
| 63 | Pane a's flush out; pane b's write queued; the flush lands. | The flush's answer stays out of the cache. | yes | `keeps a flush's answer out of the cache while the next pane's write is queued` |
| 64 | W1 out from pane a; pane b types on T1; W1 fails; W2 lands. | T1 not held: W2 carries it. | yes | `drops a failed flush's text that a later write in another visit carries` |
| 65 | Held text in pane a; focus pane b showing the vault's text; type or save there. | The held entry stays listed and is not dropped. | yes | `keeps held text one pane showed when the reader types in a second pane on the same note`, `keeps held text one pane showed when the reader saves in a second pane on the same note`, `leaves held text listed when the focus moves to a pane showing the vault's text` |
