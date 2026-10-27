---
type: Reference
title: Save path orderings: reopened buffers and held text
description: The orders in which a note reopened while its write is in the air, and a page that dies or hides after that, can meet the write queue and the keepalive, what must hold in each, and whether getting it wrong loses typed text.
resource: frontend/src/lib/note/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings: reopened buffers and held text

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page, so "As 82" points to the same row wherever it sits.

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| 82 | Type T1, W1 out; open another note and come back before W1 answers, the editor on the text under W1; type T2; hide; the page dies, so W1 never arrives and K lands. | K names the base, not T1, since the buffer never took T1. The hide holds T1 off screen beside T2's entry, so the next opening offers T1. A phone's `visibilitychange` takes the same path. | yes | `holds the write in the air off screen beside text typed on the text under it when the page dies at hide` (red on main), `holds the write in the air beside text typed on the text under it when a phone backgrounds the page and it dies` (red on main) (#317) |
| 83 | Type T1, W1 out; open another note and come back before W1 answers, the editor on the text under W1; type nothing; hide. | T1 held off screen and not sent: the screen shows the text under W1, and a keepalive would land T1 over it unseen. W1 landing drops the copy. | yes | `holds without sending on hide when the buffer reopened on the text under a write in the air`, `drops the copy held off screen at hide once the write in the air lands` (red on main), `holds the write in the air off screen against the write it named, so reopening reads no conflict` (#314) |
| 84 | As 83, but the reopened buffer takes T1 before the hide. | The hide holds T1 and resends it with keepalive: the buffer follows W1. | yes | `holds and resends on hide once the reopened buffer took the text of the write in the air` (#314) |
| 85 | As 82, but the page lives: W1 lands, then K is refused. | W1 landing drops T1's copy. K is held as a conflict, once, and never resent. | yes | `names the base on hide when the buffer reopened on the text under a write in the air`, `drops the copy of the write in the air once it lands after a hide with text typed on the text under it` (#317) |
| 86 | As 82, but the page lives: K lands, then W1 is refused. | T1 is held once, as a conflict. T2 is held nowhere: it is on disk. | yes | `holds the write in the air once when the vault refuses it after the keepalive of text typed on the text under it` (#317) |
| 87 | As 82, but the page lives: W1 fails. | T1 is held once, not twice, and T2's entry stays until K lands. | yes | `holds the write in the air once when it fails after a hide with text typed on the text under it` (red on main, which held T1 only on the failure, after T2) (#317) |
| 88 | As 82, but W1 reaches the vault and K is refused there, and the page dies before either answer. | The next opening, on the vault's T1, drops T1's copy; T2 stays held. | no | `drops the copy of the write in the air on reopening once it reached the vault before the page died` (red on main, which held no copy of T1) (#317) |
| 89 | As 82, but the reopened buffer's quiet write W2 of T2 queues behind W1 unsent; type T2b; hide. | The buffer follows W2, which never followed W1, so K names the base, not T1, and the hide holds T1 off screen beside T2b's entry. If the page lives and W1 lands, K and W2 are refused and T2b is held as a conflict, once: T1 stays on disk. | yes | `holds the write in the air off screen when the page dies with a quiet write of the reopened buffer queued behind it`, `holds the write in the air off screen when a phone backgrounds the page with a quiet write of the reopened buffer queued behind it`, `keeps the write in the air on disk when it lands after a hide with a quiet write of the reopened buffer queued behind it` (all red before this fix; main has the loss since #313) (#317) |
| 90 | As 89, but the reopened buffer types T1 again, so W2 sends T1; W1 lands, W2 goes out; type more; hide. | W2 went out from this buffer, so K names W2's text and lands, and the hide holds no copy of T1. The test is which visit sent the newest write, not its text. | no | `names the reopened buffer's own write on hide once it went out with the text of the write it never took` (red on the first fix for row 89, which compared text) (#317) |
| 91 | W0 out; type T1, W1 queues behind W0 unsent; open another note and come back on the text under W0; type T2, W2 queues behind W1; type T2b; hide; the page dies. | The hide holds T1 off screen beside T2b's entry, and K names the base, not W0's text. | yes | `holds a queued write off screen when the page dies with the reopened buffer's write queued behind it` (red on the first fix for row 89) (#317) |
