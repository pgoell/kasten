---
type: Reference
title: Flashcard format
description: The two ways a card is written, the comment holding its schedule, the tag that makes a note a deck, the frontmatter a whole note under review carries, and the keys a sitting takes.
resource: frontend/src/lib/srs.ts
tags: [vault, review, flashcards, format, frontend]
status: stable
---

# Flashcard format

A flashcard is text in a note, and the note is the whole record: the question,
the answer and the date it comes back are all in the file, so a vault read by
Obsidian, by another editor or by `cat` carries every card and every schedule.

The format is [obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition)'s,
borrowed whole for the reason [the todo line](todo-format.md) borrows
obsidian-tasks. Nothing here is kasten's invention.

## The smallest deck that works

```markdown
#flashcards/aws

What does S3 stand for?::Simple Storage Service
```

Two rules: the note carries a `#flashcards` tag, and a card is a line holding
`::`. Everything below is optional.

## What makes a note a deck

The tag. `#flashcards` anywhere in the note makes every card in it a card, and
`#flashcards/aws` puts them in a deck called `aws`. A note carrying neither
holds no cards, whatever is written in it.

That rule is load-bearing rather than decorative. `::` is a common thing to
type, in C++, in YAML and in prose, and reading every one of them as a question
would fill the queue with code samples. The tag is what makes the loose match
safe, which is why there is no way to write a card in an untagged note.

A deck named by a bare `#flashcards` is called after its note, so
`03 Flashcards/Terraform drills.md` is the deck `Terraform drills`.

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
| `Space`, `Enter` | Show the answer |
| `1` `2` `3` `4` | Again, Hard, Good, Easy |
| `q` | Close the pane |

The leader still works inside the pane, so `<leader>o` and the rest reach the
other panes mid-sitting.

Cards come due first and new second, each in the note's order. Nothing is
shuffled: a deck written in an order was written in that order on purpose.

## Typing the answer

`Type` in the header swaps the reveal button for a text field. Submitting it
shows the answer along with whether what you typed matched, and then the four
ratings as usual. The comparison forgives case, spacing and a trailing full
stop, and forgives nothing else.

A mismatch never refuses a rating. The verdict is a note to yourself, not a mark.

The toggle is kept in the browser, not in the vault: it is a preference about
how you like to be asked, not a fact about the notes.

## Filing one away

Move the note into `98 Archive`. The scan walks past that folder, so the deck
leaves the overview and nothing else about the note changes. That is the whole
of archiving here, and it is [the archive](/explanation/the-archive.md) doing
the work rather than anything this format knows about.

## What is not read

* **Reversed cards.** `:::` and `??` ask the same pair backwards in
  obsidian-spaced-repetition. Here they are ordinary text. Write the reverse as
  a second card.
* **Cloze.** `==text==` is a card in obsidian-spaced-repetition and prose here.
  [An imported Anki deck](/how-to/import-an-anki-deck.md) keeps its cloze marks
  so nothing is lost, and nothing asks them yet.
* **A daily limit on new cards.** Every new card in a deck is offered.

## See also

* [Import an Anki deck](/how-to/import-an-anki-deck.md) - turning an `.apkg` into notes
* [Spaced repetition](/explanation/spaced-repetition.md) - why the schedule is in the file
* [Editor keys](editor-keys.md) - every binding, including `<leader>gs`
* [Todo format](todo-format.md) - the other borrowed format
* [HTTP API](http-api.md) - the endpoints a sitting reads and writes
