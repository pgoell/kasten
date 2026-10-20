---
type: Reference
title: Save path orderings: the review sitting's undo
description: The orders in which the review sitting's undo can meet the write queue of its own rating, jot and suspend writes, what must hold in each, and whether getting it wrong loses typed text.
resource: frontend/src/lib/use-sitting-writes.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings: the review sitting's undo

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table).

## The review sitting's undo

The review sitting writes each rating, suspend and jot through a write queue of
its own, `frontend/src/lib/use-sitting-writes.ts`, one note at a time, each
write naming as its base what the vault answered for the write before it. Undo
takes back the last rating or suspend by writing the note's text from before
that step, naming as its base the text the step sent, which the queue turns
into the vault's answer for it. Anything written over the note since leaves
that base stale, so the vault refuses the undo rather than the undo writing
over newer text, and the card comes back only once the undo has landed. S is
the step's write and U the undo's. The tests are in
`frontend/tests/review-session-undo.test.tsx` (U2 to U5) and
`frontend/tests/review-session-undo-writes.test.tsx` (U1 and U6).

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| U1 | S out; Undo; S lands. | U waits behind S and names S's answer, stamps and all; it lands, and the card comes back revealed at the head of the queue. No false refusal. Undo stays drawn but disabled while U is out. | no | `#600 I3 an undo pressed while the rating's write is out waits behind it and names its answer` (#600) |
| U2 | S fails; Undo. | U names the text S sent, which the vault never held, so the vault refuses it: nothing is written, the card stays gone, and the foot says `The note changed since that step, so it was not undone.` | no | `#600 an undo after the rating's write failed is refused, writing nothing` (#600) |
| U3 | S lands; a jot into the same note lands; Undo. | The jot named S's answer and landed, so U's base is stale and the vault refuses it: the jotted question stays, and the foot says the note changed. | yes | `#600 I4 an undo after a jot into the same note is refused, keeping the question` (#600) |
| U4 | S lands; another pane or the disk writes the note; Undo. | Refused, `409`: nothing is written, the card is not put back, and the foot says the note changed, not that it could not be written. | yes | `#600 A9 an undo over a note changed since the step writes nothing and says so` (#600) |
| U5 | S lands; Undo; U fails on the network. | Nothing is restored; the foot says `The note could not be written:` and the reason. The step is gone either way, one step being all Undo holds. | no | `#600 I5 an undo the network fails restores nothing and says why` (#600) |
| U6 | U out; rate, suspend, turn or jot, by key or button, the card on screen or one in another note. | All held until U answers: the buttons are greyed and the keys do nothing, so U's landing, which puts back the queue and the count as they stood before S, cannot ask a card twice or drop one. Jot it and Check are disabled; a question typed into an open jot line stays in it, and the next submit after U answers sends it, into the note of the card the line was opened on. A focused button stays focused, so the pane's keys work once U answers. | yes | `#600 B1 nothing rates, parks, turns or jots the next card while an undo is out`, `#600 B2 a jot sent while an undo is out stays in its line and goes once the undo lands`, `#600 B4 a jot held through an undo lands in the note it was opened on`, `#600 B5 Jot it and Check are disabled while an undo is out, their text kept`; review-pane: `#600 B6 a header button clicked before u keeps the focus, and the keys, in the pane` (#600) |
