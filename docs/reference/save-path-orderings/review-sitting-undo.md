---
type: Reference
title: Save path orderings: the review sitting's writes and undo
description: Which line a grade writes to, and the orders in which the review sitting's writes and undo can meet the write queue of its own rating, jot and suspend writes, including a write the restart drops and goes again and the parked list's reads around its writes, what must hold in each, and whether getting it wrong loses typed text.
resource: frontend/src/lib/review/use-sitting-writes.ts
tags: [editor, saving, autosave, frontend, tests]
status: stable
---

# Save path orderings: the review sitting's writes and undo

Part of [save path orderings](/reference/save-path-orderings.md). The columns are explained in [How to read the table](/reference/save-path-orderings.md#how-to-read-the-table).

## The review sitting's undo

The review sitting writes each rating, suspend and jot through a write queue of
its own, `frontend/src/lib/review/use-sitting-writes.ts`, one note at a time, each
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
| U5 | S lands; Undo; U fails on the network for about a minute. | Nothing is restored after the minute of tries; the foot says `The note could not be written:` and the reason. The step is gone either way, one step being all Undo holds. | no | `#600 I5 an undo the network fails restores nothing and says why` (#600) |
| U6 | U out; rate, suspend, turn or jot, by key or button, the card on screen or one in another note. | All held until U answers: the buttons are greyed and the keys do nothing, so U's landing, which puts back the queue and the count as they stood before S, cannot ask a card twice or drop one. Jot it and Check are disabled; a question typed into an open jot line stays in it, and the next submit after U answers sends it, into the note of the card the line was opened on. A focused button stays focused, so the pane's keys work once U answers. | yes | `#600 B1 nothing rates, parks, turns or jots the next card while an undo is out`, `#600 B2 a jot sent while an undo is out stays in its line and goes once the undo lands`, `#600 B4 a jot held through an undo lands in the note it was opened on`, `#600 B5 Jot it and Check are disabled while an undo is out, their text kept`; review-pane: `#600 B6 a header button clicked before u keeps the focus, and the keys, in the pane` (#600) |

## Which line a grade writes to

A rating writes its schedule to the line the sitting's cards name for the card. A grade no longer parses the deck note again to find those lines (#1379): it shifts the cards it holds. The graded card takes the schedule it wrote; where the schedule went on a line of its own, the card and the other numbers of its cloze end a line lower and every card under it moves down one. The write's landing keeps the cards where the vault's answer differs from what was sent only in its `modified` stamp, and a landing, undo or read that differs in more is parsed again, on the main thread, as before. The worker of #1359 parses only the open, so a worker that fails mid-sitting changes nothing here; one that fails at the open leaves that parse to the main thread, and the grades after it shift the same. A parse that throws breaks the screen as it did before. G is a grade. The tests are in `frontend/tests/review-queue/grade-lines.test.tsx` unless they name `regraded.test.ts` beside it.

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| G1 | G on a card, then G on every later card, in one sitting. | Each schedule lands on its own card's line, the shifted cards equal to a parse of the new text for every card shape. | no | `#1379 A4 three grades in one sitting each write the card's own line, with the vault stamping every answer`; `regraded.test.ts`: `#1379 A3 grading each card of question mark shifts to the parse, on the first grade and every later one` and the other shapes |
| G2 | G1 out; G2 on the next card before G1 lands. | G2 waits behind G1, names its answer, and lands on its own card's line. | no | `#1379 A5 a second grade before the first write lands goes to the second card's line` |
| G3 | G lands; the vault's answer differs only in `modified`. | The cards carry over with no parse, and the next grade lands on its line. | no | `#1379 A4 three grades in one sitting each write the card's own line, with the vault stamping every answer` |
| G4 | G lands; the answer adds lines (a first stamp of `id` and `created`). | The note is parsed again, and the next grade lands on its line. | no | `#1379 I2 a stamp that adds lines is read again, and the next grade lands on its line` |
| G5 | The note is edited elsewhere while the sitting is open; G. | G is refused, the note is read and parsed again, as before, and the next grade lands on its line in the edited text. | no | `#1379 A6 a note edited under the open sitting is read again, and the next grade lands on its line` |
| G6 | G lands; Undo lands; G again. | The undo puts back the cards from before G with no parse, and the next grade lands on its line. | no | `#1379 I1 an undo after a grade puts the cards back, and the next grade lands on its line` |

## A write the restart drops

The backend restarts now and then. A write sent in that gap gets a 502, 503 or 504, or no answer at all. The review sitting then sends the same write again, with the same text over the same base, one try after another for about a minute. The resend is safe. Its base is stale once an earlier try has landed and moved the note on, but the disk already holds the text being resent, so the vault answers with the note as it stands and writes nothing. A base the note moved past for any other reason is a 409, and the write fails at once. A write made meanwhile waits behind the one that retries. A retry goes on even when the screen unmounts. The tests are in `frontend/tests/use-sitting-writes-retry.test.tsx`.

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| R1 | S gets a 502, 503 or 504; S goes again and lands. | S goes again with the same text and base, lands once, and no error shows. | no | `#1135 A1 a rating whose write gets a 502 and then lands keeps the rating`, `#1135 A2 a 503 is retried the same way and the rating keeps`, `#1135 A2 a 504 is retried the same way and the rating keeps` |
| R2 | S fails with a network error; S goes again and lands. | S goes again the same way and lands once. | no | `#1135 A3 a write that fails with a network error is retried the same way` |
| R3 | S keeps getting a 502 for a minute. | S stops after about a minute, the foot says the note could not be written, and the note is read again. | no | `#1135 A4 a write the backend drops for a minute fails then, and the note is read again` |
| R4 | S gets a 409. | S fails at once with one write, as before. | no | `#1135 A5 a refusal from the vault fails at once with one write, as before` |
| R5 | S gets a 502, then a 409 on the next try. | S fails at once on the 409 and sends nothing more. | no | `#1135 A6 a retry the vault refuses because the note moved on fails at once and sends nothing more` |
| R6 | A write for the same note is made while S retries (a jot, or an undo). | It waits behind S and names S's answer as its base; both land, in order. | yes | `#1135 I1 a write made while one retries waits behind it and names its answer as the base`, `#1135 I2 an undo pressed while a write retries waits behind it and settles as landed`, `#1135 I2 an undo pressed while the rating's write retries lands after it and brings the card back` |
| R7 | The screen unmounts while S retries. | S keeps going and lands once the backend is back. | no | `#1135 I4 a write still retrying when its component unmounts keeps going and lands` |

## The parked list's reads around its writes

The parked list writes each put-back through the same queue, and reads its notes again whenever the scan of the cards changes, which every landed write sets off. A note with a put-back out keeps the text on screen over that read, and so does a note whose put-back landed while the read was out, so a read from before the write never shows the card as parked again. A put-back that failed left the vault as it was, so the read's text stands. A note with nothing out takes the read's text. A read that gets a 502, 503 or 504, or no answer, goes again for about a minute; the landing it checks against is counted from when it first left, as in P2. No test yet makes a read retry while a put-back lands. The writes and their order are as above. P is a put-back. The tests are in `frontend/tests/review-parked-refetch.test.tsx`.

| # | Ordering | Must hold | Loses typed text if wrong | Test |
|---|---|---|---|---|
| P1 | P in note A retries; a put-back in note B lands and the notes are read again. | A's row stays put back. | no | `#1142 A3 a put-back retrying in one note stays put back when another note's put-back lands and the notes are read again` |
| P2 | A read leaves; P goes out and lands; the read answers with A's text from before P. | A's row stays put back. | no | `#1142 I5 a read that left while a put-back was out and answers after it landed keeps the row put back` |
| P3 | P fails at last; or a read leaves while P is out, P fails, its own read again fails too, and the first read answers. | A shows the vault's text, so its row shows parked, and the error shows. | no | `#1142 I6 a put-back that fails at last reads its note again and shows the row parked with the error`, `#1142 B1 a put-back that fails at last while its re-read fails too shows the vault's text from a read that left before` |
| P4 | A read answers for a note with no put-back out. | The note takes the read's text, so a card parked elsewhere shows up. | no | `#1142 I7 a note with no put-back out takes the read's text, so a card parked elsewhere shows up` |
| P5 | Two put-backs in A, a read between them. | Both rows stay gone, and both land in order. | no | `#1142 I8 two put-backs in one note with a read between them both stay gone and land in order` |
