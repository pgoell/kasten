---
type: Reference
title: Save path orderings: hiding the page and the keepalive
description: The orders in which a hide of the page, its keepalive write, and a leave of a note can meet the write queue, what must hold in each, and whether getting it wrong loses typed text.
resource: frontend/src/lib/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings: hiding the page and the keepalive

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table). Rows keep their numbers on every page, so "As 82" points to the same row wherever it sits.

## Orderings

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| 29 | Type T1; hide the page (pagehide or a phone's visibility change). | T1 held, then sent with keepalive. | yes | `writes the waiting text with keepalive when the page is hidden`, `writes the waiting text when a phone backgrounds the page, and says how it went`, home-route: `writes the waiting text with keepalive when the page goes away` |
| 30 | W1 out, nothing waiting; hide. | T1 held and sent again with keepalive; the held copy goes once a write lands. | yes | `holds and resends a quiet write still in flight when the page is hidden`, `holds and resends a quiet write still in flight when a phone backgrounds the page`, `drops the copy held at hide time once the quiet write lands` |
| 31 | W1 out; type T2; hide. | K sends T2 naming T1, so it lands behind W1. | yes | `names the write in the air as the keepalive's base, so text typed behind it lands`, `holds and sends text typed after the quiet write went out, not the quiet write's`, `holds text typed behind a write in the air at hide against that write's text` |
| 32 | W1 out; type T2; hide; W1 lands or fails. | T2's held copy stays until K answers. | yes | `keeps text held at hide time when an older write lands`, `keeps text held at hide time when an older write fails` |
| 33 | Hide; K refused. | The held copy stays for the next opening. | yes | `keeps the text held when the keepalive write is refused at hide time` |
| 34 | The note stands conflicted; hide. | Held, conflicted; nothing sent. | yes | `holds the text without writing when the page is hidden while conflicted` |
| 35 | W1 out; `:e!`; hide. | Nothing held or sent. | no | `holds and sends nothing on hide when the quiet write in flight was thrown away` |
| 36 | Hide; show the page again. | Nothing written. | no | `writes nothing when the page is shown again` |
| 37 | Held text reopened and untouched; hide. | Nothing written. | no | `writes nothing on hide while reopened held text is untouched` |
| 38 | W1 out; type T2; hide; the page lives on; type T3. | W3 names K's answer. | no | `names the keepalive's answer on the next write when the page lives on` |
| 39 | W1 out; type T2; hide; W1 fails; K refused. | K goes again naming the base and lands; no conflict. | no | `resends a refused keepalive naming the base when the write ahead of it failed` |
| 40 | W1 out; K behind it; both fail. | The cache keeps the base, not K's guess. | no | `keeps the base in the cache when a keepalive behind a failed write fails too` |
| 41 | W1 out; R reloads; type on R; hide. | K names R, not T1. | no | `names a reload's text on the keepalive, not the write in the air` |
| 42 | W1 out; R reloads into the clean buffer; hide. | Nothing sent: T1 would land over R. | yes | `sends nothing on hide when the note reloaded since its write went out` |
| 43 | W1 out; R reloads; type on R; hide; W1 fails. | T1 held beside the hide's entry. | yes | `holds an older write that fails after a reload beside the hide's text`, `drops an older write that fails behind the hide's text when another note reloaded` |
| 44 | W1 out; type T2; `:w` queues W2 (not yet sent); hide. | K names T1, the last write actually sent, not the base. | no | `names the last write sent on hide behind a queued write, and lands over it` (#310) |
| 45 | W1 out; type T2; hide; K reaches the server before W1. | No false conflict held for K: K goes again naming W1's answer. A K refused after W1 landed is a true conflict. | no | `resends a keepalive that overtook the write ahead of it, naming that write's answer`, `holds a keepalive refused after the write ahead landed as a conflict` (#310) |
| 46 | Type in A; open B; hide before A's flush answers. | A's text held for A and sent again with keepalive. | yes | `holds and resends the flush to a note just left when the page is hidden` |
| 47 | A's flush queued behind A's write, not yet sent; open B; hide. | The keepalive for A names the last write actually sent. | no | `names the last write sent for a left note whose newest write is still queued` (#310) |
| 48 | Type T1 in A, T2 behind it; open B; hide; K lands; W1 refused. | T1 is dropped, not held as a conflict. | no | `drops an older write to a left note refused behind the hide's keepalive` |
| 49 | Type in A; open B. | The flush writes A's text to A, not to B. | yes | `writes pending text to the note it was typed into, not the one just opened` |
