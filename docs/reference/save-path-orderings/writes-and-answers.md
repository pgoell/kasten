---
type: Reference
title: Save path orderings: writes and their answers
description: The orders in which a write, its answer, a reload and a refetch can meet one note's write queue, what must hold in each, and whether getting it wrong loses typed text.
resource: frontend/src/lib/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings: writes and their answers

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page, so "As 82" points to the same row wherever it sits.

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| 1 | Type T1; the quiet period passes; W1 lands. | One write of T1; the cache holds the vault's stamped answer, not T1; status saved. | no | `writes once the typing stops`, `puts the note the vault wrote in the cache, not the text that was sent` |
| 2 | Type several keys inside the quiet period. | One write of the last text. | no | `folds a burst of keystrokes into one write` |
| 3 | Type T1; W1 out; type T2; W1 lands. | The cache keeps out W1's answer; T2 stays waiting; status not saved. | yes | `leaves the cache alone when newer text was typed during the write`, `does not call itself saved while newer text is waiting` |
| 4 | Type T1; W1 fails. | T1 stays in the buffer and waiting; status error with the reason; the next save sends it again. | yes | `keeps the text when the write fails, and retries on the next save`, `keeps why the write failed, and drops it once one goes through` |
| 5 | Type T1; W1 refused. | Status conflict; T1 kept; the quiet write stops; `:w` overwrites and clears the conflict. | yes | `reads a save the vault refused over its base as a conflict, and keeps the text`, `writes nothing on the quiet period while the note stands conflicted`, `overwrites the vault when saved by hand, which is what clears the conflict` |
| 6 | W1 network after the server wrote T1; type T2. | The note is read again; W2 names the read text, since it holds T1 landed. | no | `reads the note before naming a base after a write failed with no answer` |
| 7 | W1 network, never reached the server, somebody else wrote X; type T2. | W2 names the old base, not X, so the vault refuses it. | yes | `keeps the old base after a write lost on the network when somebody else wrote meanwhile` |
| 8 | W1 network; the read after it fails too; type T2. | W2 names the old base. | no | orderings: `names the old base when the read after a network failure fails too` |
| 9 | W1 out; type T2; `:w` queues W2; W1 network after the server wrote T1. | W2 waits for the read and names it. | no | orderings: `names the read text on a write queued behind a network failure` |
| 10 | W1 out; type T2; `:w` queues W2; W1 lands. | W2 goes after W1 answers and names W1's stamped answer. | no | `sends :w during a quiet write once that write lands, naming what it landed as`, `names the landed text when the vault stamped more than modified on the write before` |
| 11 | W1 out; W2 queued; W1 lands. | W1's answer stays out of the cache and off screen; status saving. | yes | `keeps the first write's answer out of the cache while the second is queued` |
| 12 | W1 out; W2 queued; W1 lands; type T3. | T3 goes on T2, not on W1's answer. | yes | `keeps keys typed after the first write lands on the second write's text` |
| 13 | W1 out; W2 queued; W1 lands; W2 fails. | T2 stays waiting; status error; the cache gets W1's answer. | yes | `keeps the second write's text in pending when it fails after the first landed`, `reopens without a conflict after the second write and the flush fail behind a landed first` |
| 14 | W1 out; W2 queued; W1 lands; W2 refused. | T2 kept; status conflict. | yes | `keeps the second write's text in pending when it is refused after the first landed` |
| 15 | W1 out; W2 queued; W1 fails; W2 lands. | W2 names W1's base; T1 is not held or written over T2. | yes | `names the base of a write before it that failed, which never landed`, `never writes a failed write's text over newer text that landed behind it` |
| 16 | W1 out; W2 queued; W1 fails; W2 fails. | T2 waits; T1 is not kept in its place. | yes | `keeps the newer text waiting when the write behind a failed one fails too` |
| 17 | W1 out; W2 queued; both refused. | T2 held as a conflict. | yes | `holds the second write as a conflict when both are refused`, `holds a queued write that fails against what the write ahead of it landed` |
| 18 | The vault reports a write while the buffer is clean and nothing is in the air. | `reconcile` asks for the reload; the buffer takes the text. | no | `asks for the reload when the buffer holds nothing unwritten`, `takes anything from the vault while nothing is waiting`, note-editor: `takes a write from the vault when nothing is waiting, and says nothing about it` |
| 19 | Type T1 (not yet written); somebody else writes R; the event arrives. | The buffer keeps T1; nothing marked; the next save is refused and shows the conflict. | yes | `marks nothing on an outside write's event, and shows the conflict once the save is refused`, home-route: `marks nothing on an outside write's event, and says changed on disk once the save is refused` |
| 20 | W1 lands; type T2; the event for W1 arrives after. | T2 stays; no conflict. | yes | `marks nothing when its own write comes back while the typing goes on`, note-editor: `keeps a keystroke typed after a save, which the note's own event would revert` |
| 21 | W1 out; the event for any write arrives. | `reconcile` declines; the note reloads once the last write answers. | yes | `declines an outside write's event while a write is in the air`, `reloads a declined event's note once the last write to it answers` |
| 22 | The buffer holds T1 unwritten or conflicted; the vault comes to hold T1. | The conflict and the waiting text clear; only the entry on screen is dropped. | no | `clears a conflict when the vault comes to hold the buffer's text`, `keeps a held entry the buffer never showed when the vault comes to hold the buffer's text` |
| 23 | W1 out; R reloads into the clean buffer; type on R; W2 queued; W1 fails. | W2 names R and lands. | no | `names a reload's text behind a write that fails` |
| 24 | W1 out; R reloads; type on R; W2 queued; W1 lands. | W2 names R; neither answer is cached over the buffer. | yes | `names a reload's text behind a write that lands, and caches neither answer over it`, `names a reload's text typed while the older write was in the air, once that write lands` |
| 25 | W1 out; R reloads into the clean buffer; W1 fails or is refused. | T1 is held and listed, not put back in the buffer under R. | yes | `holds a failed write's text when the buffer took other text while it was in the air`, `holds a failed write's text when the reader typed on other text the buffer took`, `only holds a refused write when a reload took the vault's text into the buffer meanwhile` |
| 26 | W1 out; a refetch answers with the text under W1. | Declined; the note reloads once W1 answers. | yes | `declines a refetch answering while a write is in the air, and reloads once it lands` |
| 27 | W1 out; a refetch answers with W1's stamped text before W1 answers; type T2. | Taken; W2 names W1's answer. | no | orderings: `takes a read of the text in the air and names the write's answer behind it` |
| 28 | W1 lands; W2 out; a refetch answers with W1's answer. | Declined: it is a step behind T2 on screen. | yes | orderings: `declines a read of the first write's answer while the second is in the air` |
