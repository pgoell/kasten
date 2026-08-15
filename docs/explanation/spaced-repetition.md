---
type: Explanation
title: Spaced repetition
description: Why a card's schedule lives in the note, why the format was borrowed rather than invented, why a deck is a tag rather than a note, why a deck nests, and why the review has two front ends.
resource: frontend/src/lib/srs.ts
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
[a tag at the head of that card's line](/reference/flashcard-format.md#a-card-in-a-second-deck)
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
[Moving the note into `98 Archive`](/explanation/the-archive.md) takes it out of
the review, because the scan walks past that folder the way search does.

This is the second time that folder has paid for itself without being extended.
A deck for a certification you passed is precisely a note that is still true,
still worth keeping and no longer what you are looking for, which is what the
archive is for. Adding a concept here would have meant two ways to file
something away, and the second one would apply to decks only.

## SM-2, not FSRS

FSRS predicts recall better than SM-2. It is also a weight table and a few
hundred lines, and it wants a review history per card, which is a fourth thing
to write into the note and a much larger comment.

SM-2 is twenty lines and holds exactly the three numbers the borrowed comment
already carries. It is what Anki shipped for two decades, and the failure mode
of getting an interval slightly wrong is seeing a card a few days early.

The thing that would make this the wrong call is reviews starting to feel
mistimed, cards arriving long after they were forgotten or long before they were
at risk. That is a judgment about how it feels rather than a number to watch, so
there is no threshold written down here to trigger the swap.

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

## What is deliberately not here

Each of these is a real feature of Anki, left out on purpose:

* **Reversed cards.** One block would carry two schedules in one comment,
  doubling the parser and the writer. Write the reverse as a second card.
* **Cloze.** A second card shape with its own parse and its own blanking rules.
  [An imported deck](/how-to/import-an-anki-deck.md) keeps the text.
* **Media in an imported deck.** The media map in a current `.apkg` is
  zstd-compressed protobuf, and reading it without the schema is not a stdlib
  job. The import reports how many cards lost one rather than hiding it.
* **A daily new-card limit.** Anki has one because it assumes a queue shared
  across every deck. Add one when a 2,000 card import makes the first sitting
  absurd.
* **Interval fuzz.** Cards imported on one day come due on one day. Add it when
  the bunching is felt.
* **Undo.** A rating is written immediately, and the schedule before it is in
  the vault's history like every other edit.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md) - why the schedule is in the file
* [The archive](/explanation/the-archive.md) - the folder doing the filing
* [Flashcard format](/reference/flashcard-format.md) - what all this looks like written down
* [Import an Anki deck](/how-to/import-an-anki-deck.md) - the runbook
