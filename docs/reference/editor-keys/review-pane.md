---
type: Reference
title: Editor keys, the review pane
description: The review pane's keys for a sitting, its folds, parking, new questions and undo.
tags: [editor, keyboard, review, flashcards, frontend]
status: stable
---

# Review and flashcards

## The review pane

`<leader>gs` fills the focused pane with every deck the vault holds and how much
of each is waiting. Picking one starts a sitting, one card at a time.

| Key | What it does |
| --- | --- |
| `j`, `k` | Walk the decks on the overview, or the rows on the parked list |
| `l` | Start the sitting on the deck under the cursor |
| `za` | Fold or unfold the deck under the cursor |
| `p` | Open [the parked list](/reference/flashcard-format/reviewing-cards.md#parking-a-card) |
| `h` | Leave the sitting or the parked list, back to the decks |
| `Enter` | Show the answer. Once it shows, grade the card Good, unless a button or link in the pane has the focus; then the key does nothing here, and that button or link takes it. A focused `Try again`, under a deck or daily limits that could not be read, takes it too. On the decks and the parked list, Enter presses the deck or parked row under the cursor and nothing else. On a whole note, which shows from the start, it does nothing |
| `Space` | Open [the which-key panel](/reference/editor-keys/leader.md), on every screen, a card on it or not, so the other panes stay one key away mid-sitting |
| `1` `2` `3` `4` | Rate the card Again, Hard, Good, Easy |
| `s` | Park the card on screen, before or after the answer, as the Park this card link does |
| `n` | Write a new question into the note the card came from, as the Write a new question link does, or put the open jot line away unwritten |
| `r` | Play the sounds of the side showing again: the question's before the answer, the answer's after |
| `u` | In a sitting, undo the last rating or suspend; on the parked list, put the row under the cursor back |
| `o` | Open the note the parked row is written in |
| `q` | Close the pane |

A held key does not repeat. `Enter` and `1` to `4` act once per press,
so holding one down rates or reveals a card once and no more.

`j` and `k` move the focus itself rather than a highlight of their own, so
Enter on the deck they reach opens it, and `l` is the same press under the
finger vim leaves it on. Enter on a parked row opens its note, as `o` does. A
deck with nothing waiting is skipped: its row is disabled and cannot be sat, and
a deck holding nothing but parked cards is one of those, its row saying how many
so a `0 new` is never a mystery.
A deck [under another](/reference/flashcard-format/writing-cards-and-decks.md#a-deck-inside-a-deck) is
one row like any other, so `j` walks parents and children alike, and skips the
rows a fold hides. `za` on a deck with decks under it folds or unfolds them, and
on a deck with none it folds the deck above and moves the cursor up to it, the
way `za` inside a fold closes it in vim. A `z` followed by any other key is
dropped, and that key does what it always does. `l` on a folded deck sits
everything under it.

A parent whose daily limit leaves it nothing to offer can still hold a subdeck
with cards. Its row is disabled, so `j` and `k` stop on its fold arrow instead,
where `za` and `l` both fold and unfold and the cursor stays on the arrow. On a
deck with none under it whose parent row is disabled, `za` moves the cursor to
that arrow.

Each of the three screens scopes its own keys. `j` and `k` walk deck rows on the
overview and parked rows on the parked list, and neither can reach the other's.

`h` is the way out of one deck into another and the way off the parked list: it
ends the sitting and draws the decks again, where `q` closes the whole pane from
any screen. A sitting left halfway keeps every rating it took, each one having
been written to its note as it was given, so the deck you come back to is the
deck you left.

`s` parks the card in front of you without rating it, before the answer is shown
as well as after: a card you want out of the deck is one you recognised from its
question alone. `n` opens a line for a question you thought of mid-sitting, which
is written at the end of the note the card came from and waits on the parked list
until you answer it. While that line has the cursor the pane's own keys stand
down, so a `1` in a question is a digit and not a rating.

`u`, or the Undo button in the header, takes back the last rating or suspend: the
note gets back the text it held before, and the card comes back revealed at the
head of the queue, its answer off today's count. It works on the done screen
too, so a misclick on the last card is not the end of it. One step only: after
an undo there is nothing more to take back. Until the undo has been written, the
keys and buttons that rate, park, turn or jot wait. Where the note changed since the
step, in another pane, on disk or by a jot of this sitting, the undo writes
nothing and the foot of the pane says so. `u` on the parked list puts a row back
instead, each screen scoping its own keys.

The Center button in the header puts the card in the middle of the pane, across
and down, and the browser keeps the choice for the next sitting. It has no key.

Everything the keys reach is also a button, because the same two components draw
`/review`, which is [the phone's way in](/reference/flashcard-format/reviewing-cards.md#sitting-one)
and has no keyboard to bind. `Escape` is deliberately not bound here for the same
reason: a phone has no escape key, so nothing this feature does may need one.

A card is rendered the way the editor renders a note, so a table on a card is
asked as a table and a `[[link]]` reads as its name. The answer side is the one
in the accent colour.

A card side that holds sounds, `![](word.mp3)` and the like, plays them in order
when it shows: the question's when the card comes up, the answer's when you turn
it. Rating, parking or leaving the sitting stops them. `r`, or the Replay button
in the header, plays them again. A phone refuses the first card's sounds because
no tap started them, and Replay is how you hear that card there.

The leader still works inside the pane, so `<leader>o` and the rest reach the
other panes mid-sitting.

[Flashcard format](/reference/flashcard-format.md) is what a card is written in.
