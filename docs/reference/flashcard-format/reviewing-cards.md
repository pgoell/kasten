---
type: Reference
title: Reviewing cards
description: The sitting and the keys it takes, its Undo and Center, the parked screen, typing the answer, parking and filing a card away, the schedule kasten writes, and the daily limits on new cards and reviews.
resource: frontend/src/lib/srs.ts
tags: [vault, review, flashcards, format, frontend]
status: stable
---

# Reviewing cards

How a sitting asks the cards, rates them and keeps the schedule. How to write the cards and decks is on [Writing cards and decks](/reference/flashcard-format/writing-cards-and-decks.md).

## Sitting one

Two places, the same session in both:

* `/review` is a page of its own, sized for a phone. Every action is a button,
  nothing listens for `Escape`, and the whole of it works with a thumb.
* `<leader>gs` opens the same thing in a pane, with keys over the same buttons.

| Key in the pane | What it does |
| --- | --- |
| `j`, `k` | Walk the decks on the overview, or the rows on the parked list |
| `l` | Start the sitting on the deck under the cursor |
| `za` | Fold or unfold the deck under the cursor; on a deck with none under it, fold the deck above |
| `p` | Open the parked list |
| `h` | Leave the sitting or the parked list, back to the decks |
| `Enter` | Show the answer; once it shows, grade the card Good, unless a button or link in the pane has the focus, which then takes the key itself. On a whole note, which shows from the start, it does nothing. A held key acts once per press |
| `Space` | Open the which-key panel, a card on screen or not |
| `1` `2` `3` `4` | Again, Hard, Good, Easy |
| `s` | Park the card on screen, as Park this card does |
| `n` | Write a new question into the note the card came from, as Write a new question does |
| `u` | In a sitting, undo the last rating or suspend; on the parked list, put the row under the cursor back |
| `o` | Open the note the parked row is written in |
| `q` | Close the pane |

Undo, `u` in the pane and a button in the header in both places, takes back
the last rating or suspend, the last card of the deck included. The note gets
back the text it held before, so the schedule or the `!suspended` token is gone
and the card counts against [today's limits](#daily-limits) as it did before
you answered it. The card comes back revealed at the head of the queue, and a
cloze's other numbers that a suspend took out come back with it. Undo holds one
step. It writes nothing where the note changed since that step, in another
pane, on disk or by a jot, and says so at the foot.

Center, a toggle in the header, puts the front and the back in the middle of
the pane, across and down. The browser keeps it, so it holds across sittings
and reloads. Off draws the card at the top left.

On a phone, a tap on the question shows the answer, and a swipe grades it: right
for Good, left for Again. The card follows the finger, and a stamp fades in on
the side it names. A swipe grades only past 38 % of the card's width, counting
how fast the finger leaves, so a shorter one springs back and grades nothing.
Each swipe that grades gives one short buzz where the phone can buzz. A mouse
drag does not swipe, and the four buttons stay under the card for every rating.
On a phone the four grade buttons sit in one row, each at least 64 px tall, and
Show the answer fills the foot of the card.
A swipe that starts on a button, a field, a sound player or another control does
not swipe, and one that starts on a link still grades. A tap on a link, a button,
a field or a player does not show the answer.

The leader still works inside the pane, so `<leader>o` and the rest reach the
other panes mid-sitting.

### The parked screen

The third screen lists every [parked](#parking-a-card) card, its deck and why it
is parked. `p` opens it at a desk, and the `N parked cards` link at the foot of the
decks opens it on a phone, which has no key to press.

A row does two things. Putting it back takes the token off and returns the card
to its deck on the schedule it already held; only a card carrying a token gets
that control, a question with no answer having none to remove. Opening the row
puts its note in a pane at a desk and on the page on a phone, which is how a
question written mid-sitting gets its answer.

### A question you think of mid-sitting

`s` parks the card in front of you and moves on without rating it. `n`, or the
Write a new question link under the card, opens a line for a question the card just reminded you of: what you type lands at the end
of the note that card came from, written `Question::` and waiting on the parked
screen until you answer it. The card on screen and the rest of the queue are
untouched, because a card added at the end is last in line order and every card
already in the queue keeps its place.

A deck tag typed at the head of the question files it elsewhere, the way
[a card in a second deck](/reference/flashcard-format/writing-cards-and-decks.md#a-card-in-a-second-deck) does:
`#flashcards/terraform What is a moved block?` goes into the terraform deck
whatever note it is written in.

Cards come due first and new second, each in its note's order and the notes in
the order the deck found them. Nothing is shuffled: a deck written in an order
was written in that order on purpose.

## Typing the answer

`Type` in the header swaps the reveal button for a text field. Submitting it
shows the answer along with whether what you typed matched, and then the four
ratings as usual. The comparison forgives case, spacing and a trailing full
stop, and forgives nothing else. The answer is compared without the backticks
of its code spans, so you type ``a::b`` for ``{{c1::`a::b`}}``.

A mismatch never refuses a rating. The verdict is a note to yourself, not a mark.

The toggle is kept in the browser, not in the vault: it is a preference about
how you like to be asked, not a fact about the notes.

## Parking a card

A parked card stays in the note and leaves the queue. Nothing asks it, and the
deck's row counts it under `parked` rather than under `due` or `new`. Two shapes
park a card, and only one of them is written by hand.

`!suspended` beside the schedule parks a card you are finished with for now. On
a one-line card the token goes after the answer:

```markdown
What is Direct Connect?::A private link !suspended <!--SR:!2026-08-20,4,270-->
```

On a card written over several lines it goes at the head of the line the
schedule sits on, or on a line of its own where the card has no schedule yet:

```markdown
The three storage classes worth knowing
?
Standard, Infrequent Access, Glacier
!suspended <!--SR:!2026-08-20,4,270-->
```

A cloze takes the token the same two ways, on the end of its line or at the head
of the line under a `?` back, and it parks every number the cloze holds.
Parking one number parks them all, and putting one back puts them all back.

The token and the schedule are separate things. Parking a card never touches the
three numbers, so putting it back returns it on the date it already held.

A question with no answer under it is parked by its shape and carries no token:

```markdown
What is a moved block?::
```

That is a question written down to answer later. It is not a card missing half
of itself and it is not an error: nothing asks it until the answer is there, and
[the parked screen](#the-parked-screen) is where it waits. A line opening with
the divider and no question in front of it is prose, and no card at all.

## Filing one away

Move the note into the archive, `98 Archive` unless
[`KASTEN_ARCHIVE_PATH`](/reference/configuration.md#kasten_archive_path) names
another. The scan walks past that folder, so the cards
in that note leave the overview and nothing else about the note changes. A deck
another note still carries the tag of stays, holding what that other note holds.
That is the whole of archiving here, and it is
[the archive](/explanation/the-archive.md) doing the work rather than anything
this format knows about.

Archiving is no longer the only way to take a card out of the review. It moves a
whole note; [parking](#parking-a-card) takes one card and leaves the note where
it is.

## The schedule

```markdown
What does S3 stand for?::Simple Storage Service <!--SR:!2026-08-20,4,270-->
```

An HTML comment, so it renders as nothing and reads as nothing. It holds the
date the card is next due, the days between this answer and that date, and the
ease as a percent. A card carrying no comment has never been answered.

On a one-line card the comment goes on the end of the line. On a longer one it
goes on its own line under the answer:

```markdown
The three storage classes worth knowing
?
Standard, Infrequent Access, Glacier
<!--SR:!2026-08-14,1,230-->
```

kasten writes this line and nothing else. Every other line of the note is
byte-identical after a rating, because a rating is not licence to reflow a note.

A cloze keeps one comment per number, named by it after the colon:

```markdown
The capital of {{c1::France}} is {{c2::Paris}}. <!--SR:c1!2026-08-20,4,270--> <!--SR:c2!2026-08-15,1,250-->
```

They go where any schedule goes: on the end of a one-line cloze, or on the line
under the back of a `?` cloze. A number with no comment has never been answered,
so rating `c2` first adds its comment and leaves `c1` with none. Rating one
number rewrites its own comment and no other. The name is what makes the order
free, and it is kasten's: obsidian-spaced-repetition's `<!--SR:!` does not
match these comments.

A comment written with a backslash, `<!--SR\:c1!2026-01-01,1,250-->`, is text
and no schedule, wherever it sits on the line, a cloze answer or a code span
included. The schedule is only a comment without one. Review shows and types
such a comment without its backslash, in a code span too. There, it and the
import's `<!--anki\:` are the only escapes kasten reads.

## The schedule kasten writes

SM-2, the algorithm Anki used for twenty years, with four ratings.

| Rating | A card nobody has answered | A card with an interval |
| --- | --- | --- |
| Again | tomorrow | half the interval, ease down 20 |
| Hard | tomorrow | interval × 1.2, ease down 15 |
| Good | tomorrow | interval × the ease |
| Easy | in four days | ease up 15, then interval × the ease × 1.3 |

Every interval is at least a day and the ease never falls below 130. A card
rated `Again` is asked again before the sitting ends, whatever date was written.

## Daily limits

A deck can cap how many new cards and how many reviews a day's sitting asks.
One note holds the limits, `decks.md` in the config folder, which is
`99 Misc/01 Config/decks.md` unless
[`KASTEN_CONFIG_PATH`](/reference/configuration.md#the-vaults-folders) names
another. One line per deck:

```markdown
- trivia: 20 new, 200 reviews
- trivia/geography: 5 new
- aws: 50 reviews
```

The name is the deck's as the overview writes it, a subdeck with its full path.
Either half may go, and so may the `- `. A line that does not read this way is
skipped and the rest still count, so the note can carry frontmatter and a
sentence about why. A vault with no `decks.md` has no limits per deck, and no
error says so.

Each half of a deck's limit is its own line's, else that of the nearest deck
above it that sets one, else the default
[`KASTEN_REVIEW_NEW_PER_DAY`](/reference/configuration.md#kasten_review_new_per_day)
or [`KASTEN_REVIEW_REVIEWS_PER_DAY`](/reference/configuration.md#kasten_review_reviews_per_day),
else no limit. Above, `trivia/geography` takes 5 new cards and 200 reviews.

A sitting is bound by the limit of the deck you sat and by no other. Sitting
`trivia` asks at most 20 new cards across everything under it, whatever the
subdecks set; sitting `trivia/geography` asks at most 5. The cards answered
today count against the deck you sit, across every card under it.

The count of what was answered today comes off the schedule in the note, so a
reload and a second device read the same number. A card whose due date is today
plus its interval was answered today, and one that also sits on ease 250 with an
interval of 0, 1 or 4 was new.

A new card answered `Again` goes into learning: it is written due today with an
interval of 0, `<!--SR:!2026-10-24,0,250-->`, and comes round again in that
sitting. A reload or a later sitting the same day asks it again too, first and
past the review limit, because its new slot was spent on its first answer. Each
answer it gets in learning is scheduled as a first answer, so the one that
passes it sets its first gap, the way Anki's learning steps do. Two cases read
wrong: a review that lands back on ease 250 with an interval of 1 or 4 counts as
new, and so does a card left in learning yesterday and passed today.

The overview shows what today's sitting will ask, its limit less what was
answered today, and the sitting asks exactly that. A deck with nothing left
under its limits reads `0` due and `0` new and cannot be sat. A [parked](#parking-a-card) card counts against no limit and
the parked count does not change. A [whole note for review](/reference/flashcard-format/writing-cards-and-decks.md#a-whole-note-for-review)
takes no limit.

A sitting keeps the limits it started with. A change to `decks.md` applies from
the next sitting.
