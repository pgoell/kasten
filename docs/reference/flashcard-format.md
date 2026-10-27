---
type: Reference
title: Flashcard format
description: The two ways a card is written and the cloze, the comment holding its schedule, the tags that put a note and a single card in a deck, how a deck sits inside another, the frontmatter a whole note under review carries, the keys a sitting takes, its Undo and Center, and the daily limits on new cards and reviews.
resource: frontend/src/lib/review/srs.ts
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
[a card's own tag adds a deck](/reference/flashcard-format/writing-cards-and-decks.md#a-card-in-a-second-deck) rather than replacing
the note's. Everything else here is theirs.

Each topic has its own page:

* [Writing cards and decks](/reference/flashcard-format/writing-cards-and-decks.md): the one-line, several-line and cloze cards, the tags that make a deck, and whole notes for review
* [Reviewing cards](/reference/flashcard-format/reviewing-cards.md): the sitting and its keys, typing the answer, parking and filing a card, the schedule, and the daily limits

## See also

* [Import an Anki deck](/how-to/import-an-anki-deck.md): turning an `.apkg` into notes
* [Spaced repetition](/explanation/spaced-repetition.md): why the schedule is in the file
* [Editor keys](editor-keys.md): every binding, including `<leader>gs`
* [Todo format](todo-format.md): the other borrowed format
* [HTTP API](http-api.md): the endpoints a sitting reads and writes
