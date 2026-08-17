---
type: Reference
title: Flashcard format
description: The two ways a card is written, the comment holding its schedule, the tags that put a note and a single card in a deck, how a deck sits inside another, the frontmatter a whole note under review carries, and the keys a sitting takes.
resource: frontend/src/lib/srs.ts
tags: [vault, review, flashcards, format, frontend]
status: stable
---

# Flashcard format

A flashcard is text in a note, and the note is the whole record: the question,
the answer and the date it comes back are all in the file, so a vault read by
Obsidian, by another editor or by `cat` carries every card and every schedule.

The format is [obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition)'s,
borrowed for the reason [the todo line](todo-format.md) borrows obsidian-tasks.
One rule is read differently and it is named where it comes up:
[a card's own tag adds a deck](#a-card-in-a-second-deck) rather than replacing
the note's. Everything else here is theirs.

## The smallest deck that works

```markdown
#flashcards/aws

What does S3 stand for?::Simple Storage Service
```

Two rules: the note carries a `#flashcards` tag, and a card is a line holding
`::`. Everything below is optional.

## What makes a note a deck

The tag. `#flashcards` anywhere in the note makes every card in it a card, and
`#flashcards/aws` puts them in a deck called `aws`. A card in no deck is no
card, whatever is written in it.

That rule is load-bearing rather than decorative. `::` is a common thing to
type, in C++, in YAML and in prose, and reading every one of them as a question
would fill the queue with code samples. The tag is what makes the loose match
safe, which is why there is no way to write a card nothing has tagged.

A deck named by a bare `#flashcards` is called after its note, so
`03 Flashcards/Terraform drills.md` is the deck `Terraform drills`.

## A deck is not a note

The same tag in two notes is one deck holding what both of them hold. A deck is
the tag, so `#flashcards/aws` in three notes is one row in the overview and one
sitting, and the sitting reads all three notes and writes each rating back into
the note that card is in.

## A card in a second deck

Tags at the head of a card's own line are that card's, and they add a deck
rather than replacing the note's.

```markdown
#flashcards/databases

What is a stored procedure?::A named block of SQL run by name.

#flashcards/dbt How does dbt relate to stored procedures?::The same pattern with Git and tests.
```

The first card is in `databases`. The second is in `databases` and in `dbt`,
because a card about two things is asked under both, and one card wanting a
second deck should not make you move it out of the note it belongs in.

The tags go at the head, before the question, on the first line of the card.
That is the only place they can sit without landing inside an answer, and on a
card written over several lines it is the first line of the front:

```markdown
#flashcards/dbt What does dbt render?
?
Jinja templates into SQL text, which the adapter hands to the warehouse.
```

They are not part of the question. The card is asked without them.

A card carrying tags of its own needs no tag on the note at all, which is how
one question in a note that is not a deck becomes a card: tag that line and
nothing else in the note is asked.

This is the one place kasten reads the borrowed format differently.
obsidian-spaced-repetition takes a card's own tags as the whole of its filing,
so it files the card above under `dbt` alone, and it reads a tag on a line of
its own as governing the cards under it until the next one, where here that tag
is the whole note's. Both readings ask the same cards; they disagree only about
which deck one of them lands in.

## A deck inside a deck

The slashes in the tag are a path. `#flashcards/databases/postgres` makes a deck
called `postgres` under a deck called `databases`, and the overview draws both
rows, the child indented under its parent and called by its last part.

```markdown
#flashcards/databases/postgres

What is MVCC?::A row per version, so a reader never blocks a writer.
```

Every card counts twice over: once in the deck it names, and once in each deck
above it. A sitting of `databases` asks everything under `databases`, a sitting
of `databases/postgres` asks that deck alone, and a card tagged with both is
still asked once.

Nothing has to declare the parent. A deck exists because a card names it, so
`databases` is a row the moment one card is filed under `databases/postgres`,
and no note anywhere carries the bare `#flashcards/databases` tag.

An [imported Anki deck](/how-to/import-an-anki-deck.md) nests for free: Anki
spells its subdecks `Japanese::Kanji` and the import writes that as
`#flashcards/Japanese/Kanji`.

## The two ways to write a card

### On one line

```markdown
What does S3 stand for?::Simple Storage Service
```

Everything before the first `::` is the question, everything after it the
answer. A second `::` in the answer stays in the answer.

### Over several lines

```markdown
The three storage classes worth knowing
?
Standard, Infrequent Access, Glacier
```

A `?` on a line of its own divides them. The question runs back to the blank
line or heading above, the answer forward to the blank line or heading below, so
both sides can be as long as you like.

A `::` inside a fenced code block is not a card, and neither is a `?` in one.

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

## A whole note for review

Some things are not a question and an answer. A note you want to re-read every
few weeks carries `#review` instead, and its schedule goes in the frontmatter:

```markdown
---
id: 019fd761-2599-71ba-b6d0-7b0d8e0a7367
sr-due: 2026-08-20
sr-interval: 4
sr-ease: 270
---
# How TLS actually works

…
```

The note is shown whole, without its frontmatter, and rated the same four ways.
`sr-due` written by hand is enough; the other two are filled in on the first
rating. A note carrying both `#flashcards` and `#review` is read as a deck of
cards, the cards being the more specific claim.

A note like this has no line to hang a token on, so `sr-suspended: true` in the
same block parks it, beside the schedule it already keeps there.

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

## Sitting one

Two places, the same session in both:

* `/review` is a page of its own, sized for a phone. Every action is a button,
  nothing listens for `Escape`, and the whole of it works with a thumb.
* `<leader>gs` opens the same thing in a pane, with keys over the same buttons.

| Key in the pane | What it does |
| --- | --- |
| `j`, `k` | Walk the decks on the overview, or the rows on the parked list |
| `l` | Start the sitting on the deck under the cursor |
| `p` | Open the parked list |
| `h` | Leave the sitting or the parked list, back to the decks |
| `Space`, `Enter` | Show the answer |
| `1` `2` `3` `4` | Again, Hard, Good, Easy |
| `s` | Park the card on screen |
| `n` | Jot a new question into the note the card came from |
| `u` | Put the parked row under the cursor back |
| `o` | Open the note the parked row is written in |
| `q` | Close the pane |

The leader still works inside the pane, so `<leader>o` and the rest reach the
other panes mid-sitting.

### The parked screen

The third screen lists every [parked](#parking-a-card) card, its deck and why it
is parked. `p` opens it at a desk and the `N parked` count in the header opens it
on a phone, which has no key to press.

A row does two things. Putting it back takes the token off and returns the card
to its deck on the schedule it already held; only a card carrying a token gets
that control, a question with no answer having none to remove. Opening the row
puts its note in a pane at a desk and on the page on a phone, which is how a
question written mid-sitting gets its answer.

### A question you think of mid-sitting

`s` parks the card in front of you and moves on without rating it. `n` opens a
line for a question the card just reminded you of: what you type lands at the end
of the note that card came from, written `Question::` and waiting on the parked
screen until you answer it. The card on screen and the rest of the queue are
untouched, because a card added at the end is last in line order and every card
already in the queue keeps its place.

A deck tag typed at the head of the question files it elsewhere, the way
[a card in a second deck](#a-card-in-a-second-deck) does:
`#flashcards/terraform What is a moved block?` goes into the terraform deck
whatever note it is written in.

Cards come due first and new second, each in its note's order and the notes in
the order the deck found them. Nothing is shuffled: a deck written in an order
was written in that order on purpose.

## Typing the answer

`Type` in the header swaps the reveal button for a text field. Submitting it
shows the answer along with whether what you typed matched, and then the four
ratings as usual. The comparison forgives case, spacing and a trailing full
stop, and forgives nothing else.

A mismatch never refuses a rating. The verdict is a note to yourself, not a mark.

The toggle is kept in the browser, not in the vault: it is a preference about
how you like to be asked, not a fact about the notes.

## Filing one away

Move the note into `98 Archive`. The scan walks past that folder, so the cards
in that note leave the overview and nothing else about the note changes. A deck
another note still carries the tag of stays, holding what that other note holds.
That is the whole of archiving here, and it is
[the archive](/explanation/the-archive.md) doing the work rather than anything
this format knows about.

Archiving is no longer the only way to take a card out of the review. It moves a
whole note; [parking](#parking-a-card) takes one card and leaves the note where
it is.

## What is not read

* **Reversed cards.** `:::` and `??` ask the same pair backwards in
  obsidian-spaced-repetition. Here they are ordinary text. Write the reverse as
  a second card.
* **Cloze.** `==text==` is a card in obsidian-spaced-repetition and prose here.
  [An imported Anki deck](/how-to/import-an-anki-deck.md) keeps its cloze marks
  so nothing is lost, and nothing asks them yet.
* **A daily limit on new cards.** Every new card in a deck is offered, except
  the ones [parked](#parking-a-card).

## See also

* [Import an Anki deck](/how-to/import-an-anki-deck.md) - turning an `.apkg` into notes
* [Spaced repetition](/explanation/spaced-repetition.md) - why the schedule is in the file
* [Editor keys](editor-keys.md) - every binding, including `<leader>gs`
* [Todo format](todo-format.md) - the other borrowed format
* [HTTP API](http-api.md) - the endpoints a sitting reads and writes
