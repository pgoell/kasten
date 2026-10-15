---
type: Reference
title: Save path orderings
description: Every order in which a write, its answer, a reload, a refetch, a hide, a pane switch, a rename, a delete and :e can meet one note's write queue, what must hold in each, whether getting it wrong loses typed text, and the test that holds it.
resource: frontend/src/lib/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings

The editor writes a note back to the vault through one hook,
`frontend/src/lib/use-autosave.ts`. Every write to a note goes through one
ordered queue for that note: the quiet write after the typing stops, `:w`, the
flush on leaving the note or the pane, the keepalive as the page is hidden, and
the save that rename and delete make first. A write goes out once the one ahead
of it answers, and names as its base the text the vault holds under the buffer,
so the vault can refuse it with `409` if somebody else wrote the note since.
That refusal is the only conflict check. [Saving](/reference/editor-keys.md#saving)
says what the reader sees; this page lists the orders the queue can meet. For
rename and delete, see also [Moving notes](/explanation/moving-notes.md) and
[Deleting a note](/explanation/deleting-a-note.md).

## How to read the table

* W1, W2 are writes of the texts T1, T2, in the order they were asked for. K is
  a keepalive write. R is text somebody else wrote, taken into a clean buffer.
* "Lands" is a `200`; "fails" is a `500`; "network" is a failure with no HTTP
  status (a `TypeError`), after which the server may or may not have written;
  "refused" is a `409`.
* A refetch is a read of the note that answers late, with text the page has
  already moved past. A reload is the editor taking the vault's text into a
  clean buffer through `allowReload`.
* "Loses typed text" is yes when, if the rule broke, text the reader typed
  would end up on no disk, no screen and in no held entry, or would be written
  over by older text. It is no for a false `Changed on disk`, or a stale screen
  that the next event or `:e!` heals.
* The test column names a test in `frontend/tests/use-autosave.test.ts` unless
  it names another file. `orderings:` means
  `frontend/tests/use-autosave-orderings.test.ts`. Rows marked #310 or #311
  are held by tests in `use-autosave.test.ts` added with those fixes.

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
| 50 | W1 out; type T2; open B. | The flush waits behind W1, names W1's answer, and puts T2 in A's cache as it leaves. | yes | orderings: `queues the flush on leaving behind the write in the air and names its answer` |
| 51 | Type in A; open B; A's flush fails. | A's text held for A; B's status, base and failures untouched. | yes | `holds the left note's text when the flush on the way out fails`, `leaves the next note alone when the old note's flush fails and it is left untouched`, `keeps the next note's own failure alone when the old note's flush fails` |
| 52 | Type in A; open B; A's flush answers late. | B's status and base are B's own. | no | `does not call the next note saved when the old note's flush answers late`, `names the new note's own save as its base when the old note's flush answers late` |
| 53 | A stands conflicted; open B or unmount. | A held as conflicted; nothing written. | yes | `holds a conflicted note's text and writes nothing when another note is opened`, `holds a conflicted note's text and writes nothing when the editor goes away` |
| 54 | Type; unmount the editor; the flush fails. | Text held. | yes | `holds the text when the flush on unmount fails`, home-route: `keeps the text when leaving the editor route fails to save it, and says so on return` |
| 55 | Type T1; leave; reopen while the flush is out; type T2. | The buffer opens on T1; W2 names the flush's answer; no conflict. | yes | `reopens a note on the flush's text and names its answer behind it` |
| 56 | Type T1; leave; reopen while the flush is out; the flush fails. | T1 stays on the clean screen, taken as held; status error. | yes | `keeps a failed flush's text on the screen it reopened on`, home-route: `lists a flush that fails after the note was reopened, and keeps it through a save there` |
| 57 | Leave; reopen; the flush is refused; a save on reopen is refused. | Both texts kept. | yes | `keeps both texts when a flush refused after the reopen is followed by a refused save`, `keeps a flush refused after the reopen beside text the hide held there` |
| 58 | A write is out; the note moves; the write fails. | The text is held under the new path. | yes | `holds a write that fails after its note moved under the new path`, `drops the held entry a move carried when the write in the air lands` |
| 59 | Type in pane a; focus pane b on the same note. | Pane a's text is written first. | yes | `writes a first pane's unsaved text before a second pane on the same note types` |
| 60 | Nothing waiting; focus pane b. | Nothing sent. | no | `sends nothing on a pane switch on the same note with nothing waiting` |
| 61 | W1 out from pane a; focus pane b showing T1; type. | W2 names W1's answer; no conflict. | yes | `lets a second pane type on the first pane's text while its write is in the air`, `follows the queue in a second pane that took the first pane's text before it got the focus` |
| 62 | W1 out from pane a; pane b still shows the text before T1; type. | W2 names that old text; the refusal holds both. | yes | `names the old text from a pane that never took the first pane's, and holds the refusal` |
| 63 | Pane a's flush out; pane b's write queued; the flush lands. | The flush's answer stays out of the cache. | yes | `keeps a flush's answer out of the cache while the next pane's write is queued` |
| 64 | W1 out from pane a; pane b types on T1; W1 fails; W2 lands. | T1 not held: W2 carries it. | yes | `drops a failed flush's text that a later write in another visit carries` |
| 65 | Held text in pane a; focus pane b showing the vault's text; type or save there. | The held entry stays listed and is not dropped. | yes | `keeps held text one pane showed when the reader types in a second pane on the same note`, `keeps held text one pane showed when the reader saves in a second pane on the same note`, `leaves held text listed when the focus moves to a pane showing the vault's text` |
| 66 | Text waiting; rename or delete. | `saveFirst` writes it first, then the command goes. | yes | `writes on the way to another command when nothing is in conflict`, home-route: `writes what is waiting before it deletes the note` |
| 67 | The note stands conflicted; rename or delete. | Refused; nothing written. | yes | `writes nothing on the way to another command while the note stands conflicted`, home-route: `refuses to delete a note that changed on disk` |
| 68 | W1 out; rename or delete; W1 fails. | `saveFirst` waits for W1 and refuses. | yes | `lets a rename wait for the write in the air, and refuses when it fails` |
| 69 | W1 out; rename or delete; W1 lands. | `saveFirst` waits for W1, then lets the command go. | no | orderings: `lets a rename go once the write in the air lands` |
| 70 | W1 out; rename or delete; W1 refused. | `saveFirst` refuses; status conflict. | yes | orderings: `refuses a rename when the write in the air is refused` |
| 71 | W1 out; W2 queued; rename; W1 fails; W2 lands. | `saveFirst` lets the command go. | no | `lets a rename go when a later write landed after a failed one` |
| 72 | Text waiting or a write out; `:e`. | Refused; the text and the screen stay. | yes | home-route: `refuses :e on a buffer holding unsaved text`, `refuses :e without the bang while a write is in the air, and holds that write's text when it fails`, home-route: `refuses :e while a save is on its way, leaving the screen and the cache alone` |
| 73 | W1 answers; `:e`. | Allowed. | no | `lets :e through once the write has answered` |
| 74 | W1 out; `:e!`; W1 fails. | Nothing held; nothing left in the air. | no | `says nothing is in the air after a write that failed on discarded text`, home-route: `does not keep a failed write's text once :e! has thrown it away` |
| 75 | W1 out; `:e!`; W1 lands. | W1's answer is not cached or shown. | no | `still throws the buffer away on :e! while a write is in the air`, home-route: `does not let a write in flight put back what :e! threw away` |
| 76 | W1 out; `:e!`; W1 lands; the vault's event for W1 arrives. | `:e!` queues a write of the vault's text behind W1, so the vault ends on it and the thrown-away text does not come back on screen. Keys typed meanwhile go out behind it; its refusal or failure holds nothing. | no | `keeps what :e! threw away out of the vault and off the screen when its write lands after`, `sends keys typed after :e! behind its write, naming that write's answer`, `reloads somebody else's text when the write after :e! is refused, holding nothing`, `holds nothing when the write after :e! fails`, `writes nothing on :e! with no write in the air` (#311) |
| 77 | W1 out; W2 queued; `:e!`. | W2 never goes out. | no | `never sends a write still queued at :e!` |
| 78 | `:e!`; type. | The next write names the text read for `:e!`. | no | `names the vault's text read for :e! once the typing starts again`, `names the text read for :e! as its base after the cache moves under a dirty buffer` |
| 79 | A's flush queued behind A's write; open B; `:e!` in B. | A's flush still goes out: `:e!` drops B's text only. | yes | orderings: `still sends a left note's queued flush after :e! in the next note` |
| 80 | Held text on screen; `:e!`. | Only the entry on screen is dropped; the conflict clears. | no | `drops only the entry the buffer showed on :e!`, home-route: `leaves nothing waiting and nothing conflicted behind :e!` |
| 81 | W1 out; `:e!` queues the write of the vault's text behind it; hide; W1 lands; somebody else writes X. | The hide holds and sends nothing for the `:e!` write: it carries no typed text. The clean buffer takes X. | no | `holds and sends nothing on hide while the write after :e! waits its turn` (#311) |
| 82 | Type T1, W1 out; open another note and come back before W1 answers, the editor on the text under W1; type T2; hide. | The keepalive names the base, not T1, since the buffer never took T1: refused, it is held as a conflict and never resent, so T1 stays on disk. | yes | `names the base on hide when the buffer reopened on the text under a write in the air` (red on main) |
| 83 | Type T1, W1 out; open another note and come back before W1 answers, the editor on the text under W1; type nothing; hide. | T1 held off screen and not sent: the screen shows the text under W1, and a keepalive would land T1 over it unseen. W1 landing drops the copy. | yes | `holds without sending on hide when the buffer reopened on the text under a write in the air`, `drops the copy held off screen at hide once the write in the air lands` (red on main), `holds the write in the air off screen against the write it named, so reopening reads no conflict` (#314) |
| 84 | As 83, but the reopened buffer takes T1 before the hide. | The hide holds T1 and resends it with keepalive: the buffer follows W1. | yes | `holds and resends on hide once the reopened buffer took the text of the write in the air` (#314) |
