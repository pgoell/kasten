---
type: Reference
title: Save path orderings
description: Every order in which a write, its answer, a reload, a refetch, a hide, a pane switch, a rename, a delete and :e can meet one note's write queue, and the review sitting's undo can meet its own, what must hold in each, whether getting it wrong loses typed text, and the test that holds it.
resource: frontend/src/lib/use-autosave.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings

The editor writes a note back to the vault through one hook,
`frontend/src/lib/use-autosave.ts`, whose parts sit beside it: the page's
write queue in `save-queue.ts`, a write's answer in `write-answer.ts`, the
writes themselves in `use-buffer-write.ts`, held text against the buffer in
`held-buffer.ts`, and what the buffer takes from the vault in
`vault-reads.ts`. Every write to a note goes through one
ordered queue for that note: the quiet write after the typing stops, `:w`, the
flush on leaving the note or the pane, the keepalive as the page is hidden, and
the save that rename and delete make first. A write goes out once the one ahead
of it answers, and names as its base the text the vault holds under the buffer,
so the vault can refuse it with `409` if somebody else wrote the note since.
That refusal is the only conflict check. [Saving](/reference/editor-keys/saving.md#saving)
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
* The test column names a test in one of the `frontend/tests/use-autosave-*.test.ts`
  files unless it names another file. The tests sit one file per behaviour:
  `-writes` (the quiet write, status, reloads), `-leaving` (writes in the air,
  the flush on leaving a note, moves), `-held-panes`, `-held-reopen` and
  `-held-taken` (held text, reopening, panes), `-hide` (the page hidden),
  `-base` and `-base-vault` (the base a save names), `-failed-writes` (#290,
  #291), `-older-answers` (#296 to #298), `-queue` (#301 to #307),
  `-keepalive-queue` and `-reopened-under` (#310, #311), `-live-conflict`
  (#269), `-leaving-route` and `-leaving-route-back` (#382). Their shared
  fixtures are in `frontend/tests/autosave-fixture.ts`. `orderings:` means
  `frontend/tests/use-autosave-orderings.test.ts`. Rows marked #310 or #311
  are held by tests in the files of the `(#310, #311)` describe, added with
  those fixes.

## Orderings

The table splits by theme. Rows keep their numbers on every page, so "As 82" points to the same row wherever it sits. Each page repeats the table's header.

* [Writes and their answers](/reference/save-path-orderings/writes-and-answers.md): rows 1 to 28.
* [Hiding the page and the keepalive](/reference/save-path-orderings/hiding-and-keepalive.md): rows 29 to 49.
* [Leaving a note and switching panes](/reference/save-path-orderings/leaving-and-switching-panes.md): rows 50 to 65.
* [Rename, delete and :e](/reference/save-path-orderings/rename-delete-and-colon-e.md): rows 66 to 81.
* [Reopened buffers and held text](/reference/save-path-orderings/reopened-buffers-and-held-text.md): rows 82 to 91.
* [Live conflicts and leaving the route](/reference/save-path-orderings/conflicts-and-leaving-the-route.md): rows 92 to 106.
* [Panels, history restores and CRLF notes](/reference/save-path-orderings/panels-history-and-crlf.md): rows 107 to 116.
* [Moving a todo between notes](/reference/save-path-orderings/todo-pane-moves.md): rows 117 to 123.
* [Presses on a todo row](/reference/save-path-orderings/todo-row-presses.md): rows 124 to 129.
* [Agent tags and the editor's todo shortcut](/reference/save-path-orderings/todo-agent-tags.md): rows 130 to 134.
* [The review sitting's undo](/reference/save-path-orderings/review-sitting-undo.md): rows U1 to U6.
* [The log card, the palette's log commands and the log pane](/reference/save-path-orderings/log-card.md): rows L1 to L14.
* [The dump capture](/reference/save-path-orderings/dump-capture.md): rows D1 to D4.
