---
type: Explanation
title: Spaced repetition
description: Why a card's schedule lives in the note, why the format was borrowed rather than invented, why a deck is a tag rather than a note, why a deck nests, why the review has two front ends, why a daily limit counts off the schedule, and why the review moves from SM-2 to FSRS and in what card format.
resource: frontend/src/lib/review/srs.ts
tags: [design, vault, review, flashcards]
status: stable
---

# Spaced repetition

A vault is where things you have understood go to be forgotten. Reading a note
again in a month is the cheapest way to stop that, and doing it on purpose,
rather than when something reminds you, is the whole of what this feature is.

Most of the interesting decisions here are consequences of
[the one rule](/explanation/vault-and-derived-index.md), and the rest are
consequences of the review being the one thing worth doing on a phone.

## The schedule is in the note

A card's due date, interval and ease are three numbers that change every time
you answer it. They are exactly the kind of thing that wants to be a row in
Postgres, and putting them there would be the end of the vault being the source
of truth: drop the schema and you would lose a year of scheduling with no way to
rebuild it from the files.

So they go in the file, in a comment beside the card:

```markdown
What does S3 stand for?::Simple Storage Service <!--SR:!2026-08-20,4,270-->
```

The cost is a write to a note per answer, and it is not much of a cost: the todo
pane already writes a note per keypress. What it buys is that a deck reviewed on
the phone this morning is a deck whose progress is in the git history, in the jj
repo, in the Obsidian vault, and in the backup you already have because the
vault is text.

A whole note marked `#review` keeps the same three numbers in its frontmatter
for the same reason. There is no card to hang a comment on, and there is always
a block at the top.

## The format was borrowed

Nothing about `::`, `?` and `<!--SR:!…-->` is kasten's. It is
obsidian-spaced-repetition's format, adopted whole, the way
[the todo line](/reference/todo-format.md) is obsidian-tasks'.

Inventing one would have been no more work. What it would have cost is the
second reader: the vault opened in Obsidian with that plugin installed shows the
same decks, due on the same days, and answering a card there is answering it
here. A format one program reads is a lock-in with extra steps, and this project
exists partly to not have one.

The `!` in the comment is theirs and does nothing here. It is kept because a
comment written without one would not be read back by the plugin, and a
divergence that small is exactly the kind that gets discovered a year later with
a vault full of cards on the wrong side of it.

## A deck is a tag

Three things could name a deck: a folder, a frontmatter field, or a tag.

A folder would mean deciding where cards live, which is a decision about filing
rather than about learning, and it would make a card in a project note
impossible. A field would want a writer, a reader and a migration.

A tag is already in the vault, already means "this note is one of those", and
already nests: `#flashcards/aws` names a deck in one token. It also solves a
problem the parser could not solve alone. `::` is a common thing to type, so
reading every `::` in the vault as a card would fill the queue with C++ and
YAML. The scan is deliberately loose and the tag is what makes it safe: a card
in no deck at all is no card, whatever is written in it.

The nesting is read rather than decorative. `#flashcards/databases/postgres` is
one deck under another, and a card in the child counts in the parent too, so
`databases` asks everything below it and `databases/postgres` asks the narrow
thing. A tag is a path everywhere else in the vault and taking it as a flat
string here would have been the one place it was not, which is the mistake the
overview made while it drew `databases/postgres` as a row of its own beside no
parent at all.

## A deck is not a note

A tag names a deck and any number of notes may carry it, so `#flashcards/aws` in
three notes is one deck of everything the three of them hold. The alternative,
one note one deck, would have made the name a lie: two notes tagged `aws` drew
two rows called `aws`, and which of them a card was in was a fact about filing
again.

That is also what makes a card's own tag worth having. A note about stored
procedures holds one card about dbt, and
[a tag at the head of that card's line](/reference/flashcard-format/writing-cards-and-decks.md#a-card-in-a-second-deck)
puts that card in the `dbt` deck without moving it, copying it or dragging the
other eight cards along with it.

The tag adds a deck rather than replacing the note's, which is where kasten
parts from obsidian-spaced-repetition. There a card's own tags are the whole of
its filing. Adding is the reading that answers what the tag is written for: the
card is about stored procedures and about dbt, and saying the second should not
cost you the first. The plugin still reads the vault and still asks that card;
it files it under `dbt` alone.

## Archiving is the archive

There is no "archive this deck" button, no `archived: true`, no key.
[Moving the note into the archive](/explanation/trash-and-archive/the-archive.md) takes it out of
the review, because the scan walks past that folder the way search does.

This is the second time that folder has paid for itself without being extended.
A deck for a certification you passed is precisely a note that is still true,
still worth keeping and no longer what you are looking for, which is what the
archive is for. Adding a concept here would have meant two ways to file
something away, and the second one would apply to decks only.

What the folder cannot do is take out one card. Archiving moves a note, and a
deck of two hundred cards holding one you are tired of is not a note you are
finished with. So there is a per-card state beside the folder,
[a parked card](/reference/flashcard-format/reviewing-cards.md#parking-a-card), and it is a
token on the card's own line rather than a key: the card is the thing being
parked, the note is not, and the state belongs where the card is written. The
two do not overlap. The folder files a note away, the token takes one card out
of the queue, and neither is a worse way of doing the other.

## FSRS, not SM-2

kasten schedules with SM-2 today: one short function in `srs-schedule.ts` that
holds exactly the three numbers the borrowed comment carries. The decision of
2026-11-12 (#1776) is to swap to FSRS, and #1926 builds it. Until it
lands, everything else on this page describes SM-2, as the code does.

### Why swap

Two things changed since SM-2 was picked as a stopgap.

The vault's load is ahead of it, not behind it. Counted read-only on the live
vault that day, the review holds 8,860 cards in 28 notes and ten decks (eight
Japanese, `databases` and `spark`). 456 hold a schedule, 89 were due, and
8,404 have never been asked: 6,955 of the kanji deck's 7,065 and 1,440 of
Kaishi's 1,501. Three more decks (488 cards, all unanswered) sit in the archive. The
cost of a scheduler lies in the reviews still to come, and nearly all of them
are.

And the second reader moved. obsidian-spaced-repetition 1.15 ships FSRS beside
SM-2, through ts-fsrs, with a comment format of its own. The reason SM-2 fit,
that it held the three numbers the plugin's comment held, no longer argues for
it: the plugin now writes a longer comment too, and a card answered there with
FSRS on is one today's kasten cannot read, and so leaves out of the review.

### What staying would cost

FSRS asks for fewer reviews than SM-2 for the same recall; that is the
FSRS project's claim and the reason #1776 gives. How many fewer was not
measured here, and the figure often quoted, 20 to 30 percent, was not traced
to a source for this page. Any saving is per review, so it counts against the
8,404 cards still unseen for as long as those decks are in use. This vault has
no answer log, so kasten would run the default weights, not fitted ones.

The history cannot tell how often the 456 were answered. The jj repo keeps
snapshots, not a log of answers, and a copy of its git side did not show
every answer. Many of the 456 look imported from Anki rather than answered
here: all 225 Tofugu cards hold a schedule and none is due, and the longest
interval is 51 days. That is inferred from the numbers, not read off a log.

### The card format

The plugin's own, borrowed whole a second time. This card was answered Easy
once:

```markdown
What does S3 stand for?::Simple Storage Service <!--SR:!fsrs,2026-11-20T00:00:00.000Z,8,8.30,1.00,2,1,0,0,2026-11-12T00:00:00.000Z-->
```

After `fsrs`, nine fields by comma:

1. The due day, as an ISO timestamp. The plugin writes any time of day;
   kasten writes midnight UTC of the day and reads the date part alone.
2. The interval in days, as now.
3. Stability: the days until recall falls to 90 percent. A float, written to
   two places so it reads back as written, the reason the ease is a percent.
   The plugin writes the whole float; both read either.
4. Difficulty, 1 to 10, two places.
5. The state, as ts-fsrs numbers it: 0 new, 1 learning, 2 review,
   3 relearning.
6. Answers so far.
7. Lapses, the answers of `again` after the card left learning.
8. The learning step the card is on.
9. The last answer, as a timestamp like the due day, or `-`.

A cloze keeps kasten's own name before the `!`: `<!--SR:c1!fsrs,…-->`. A
whole note marked `#review` stays on SM-2 in its frontmatter; no live note
uses one.

The extra fields pay for themselves at once. `learning()` reads the state
rather than a gap of 0, and a daily limit reads the last answer rather than
working it out from the due day, so the two misreads in
[the format](/reference/flashcard-format/reviewing-cards.md#daily-limits) go
away for any card that has the new comment.

### Converting the old cards

No rewrite. An SM-2 comment still reads, in kasten and in the plugin, and a
card moves to the new comment the first time it is answered after the build,
by the rule the plugin uses: stability is the interval, the last answer is the
due day less the interval, the ease of 130 to 370 maps onto difficulty 10 to 1,
the state is review, lapses and learning step are 0, and the answers are
log2 of the interval plus one, rounded. A card nobody answers is never written. The live vault has no card in learning to
convert.

### The Anki import

Today it carries the interval, ease and due day of each card in review. Anki
keeps FSRS state in the `data` column of `cards` as `s` and `d`, with the last
answer as `lrt`, by Anki's own source (`rslib/src/storage/card/data.rs`); no
`.apkg` with FSRS on was opened for this. Where those are there,
the import writes the new comment with them, the last answer and the card's
`reps` and `lapses`; where they are not, it writes the SM-2 comment it writes now, which
converts at the first answer.

### The library

ts-fsrs 6.0.0 (MIT), the library the plugin uses at 5.4.1, with its one dependency
`@open-spaced-repetition/srs-kit` 1.0.0 (BSD-3-Clause, whose notice has to ship
with the bundle). Both licenses were read from the files in the packages.
Default FSRS-6 weights, 90 percent recall asked, no fuzz, as now.

## Two front ends, one session

The app proper is a grid of panes driven by a leader key and a vim mode. A
phone has none of that: no escape key, no split, no `<leader>gs`.

Reviewing is the one part of a notebook worth doing standing at a bus stop, so
it gets a page of its own at `/review` where every action is a button and
nothing listens for `Escape`. It is a URL, so it goes on a home screen.

Two shells, then, but one session: `ReviewSession` holds every rule about cards,
scheduling and writing, and the two shells hold a viewport and a key map
respectively. That split is the property to keep. A rule that lived in the pane
and not in the route would be a rule that is true at a desk and false on a
phone, and the file on disk would be the thing that disagreed with itself.

## Daily limits count off the schedule

A daily limit has to know what was answered today, and the note holds no
history: three numbers per card, which obsidian-spaced-repetition reads too, so
a fourth was not on offer. A store of its own in the browser or the database
would count wrong after a reload on another device.

The three numbers are enough. Every rating writes a due date of today plus the
interval, so a card whose two agree was answered today, and a first answer
always lands on the starting ease with a gap of 1 or 4. Two rare cases read
wrong, both named in [the format](/reference/flashcard-format/reviewing-cards.md#daily-limits),
and the cost of either is one card more or less in a day's sitting.

The limits themselves live in a note, `decks.md`, rather than in settings, for
the reason the schedule does: the vault is the record, and its history shows
when a limit changed. The setting is only the default for a vault with no note.

## What is deliberately not here

Each of these is a real feature of Anki, left out on purpose:

* **Reversed cards.** One block would carry two schedules in one comment,
  doubling the parser and the writer. Write the reverse as a second card.
* **Media in an imported deck.** The media map in a current `.apkg` is
  zstd-compressed protobuf, and reading it without the schema is not a stdlib
  job. The import reports how many cards lost one rather than hiding it.
* **Interval fuzz.** Cards imported on one day come due on one day. Add it when
  the bunching is felt.
* **Undo.** A rating is written immediately, and the schedule before it is in
  the vault's history like every other edit.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md): why the schedule is in the file
* [The archive](/explanation/trash-and-archive/the-archive.md): the folder doing the filing
* [Flashcard format](/reference/flashcard-format.md): what all this looks like written down
* [Import an Anki deck](/how-to/import-an-anki-deck.md): the runbook
