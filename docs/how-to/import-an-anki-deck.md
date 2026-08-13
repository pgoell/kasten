---
type: How-to Guide
title: Import an Anki deck
description: Turn an .apkg export into markdown notes in the vault, and know what does not survive the trip.
tags: [vault, review, flashcards, anki, import]
status: stable
---

# Import an Anki deck

You have decks in Anki and you want them in the vault, where they are markdown
like everything else.

## Export from Anki

In Anki, **File → Export**, choose **Anki Deck Package (\*.apkg)** and pick the
deck. Leave scheduling out: kasten does not read Anki's schedules, and a fresh
start is what the import gives you. Both the current export format and the older
one are read, so no compatibility option needs setting.

## Import it

Open `/review`, either on a phone or through `<leader>gs` in the app, and press
**Import an Anki deck**. Pick the `.apkg`.

The line beside the button says what arrived: how many decks, how many cards,
and how many cards referred to media that did not come with them.

## Where it lands

One note per deck, under `03 Flashcards`:

```
03 Flashcards/AWS Certification.md
03 Flashcards/Trivia/Geography.md
```

A nested Anki deck becomes a nested folder. Each note opens with its deck tag
and holds one `front::back` line per card:

```markdown
#flashcards/AWS-Certification

What is a VPC?::A virtual private cloud
Which region is cheapest?::us-east-1 usually
```

The tag cannot hold a space, so a deck called `AWS Certification` is tagged
`#flashcards/AWS-Certification`. The folder keeps the space.

`03 Flashcards` is
[KASTEN_FLASHCARDS_PATH](/reference/configuration.md#kasten_flashcards_path).

## Importing the same deck twice is refused

A deck whose note already exists answers 409 and writes nothing, not even the
decks in the same file that would have been fine. The note it would land on may
have fifty cards you have answered, and their schedules are in it.

To import a newer version of a deck, rename the old note first and merge by
hand, or export the new cards to a deck under another name.

## What does not survive

Three things, and the import says so rather than hiding them.

**Media.** Images and sounds are dropped, and the count of cards that referenced
one is reported. The media map in a current `.apkg` is zstd-compressed protobuf,
which the standard library cannot read without the schema. A card that was a
picture arrives as its caption. Put the images back by hand with
[an image in a note](/reference/editor-keys.md), or keep those decks in Anki.

**Cloze.** An Anki cloze note arrives with its marks kept, so
`{{c1::Paris}}` becomes `==Paris==`. The text is all there and nothing asks it:
[cloze is not a card](/reference/flashcard-format.md#what-is-not-read) here.

**Everything but the first two fields.** A card is a question and an answer. A
note type with six fields contributes its first two, and a note with fewer than
two is skipped.

Formatting inside a field is flattened to one line: `<br>` and the end of a
`<div>` or `<p>` become spaces, every other tag is stripped, and entities are
unescaped.

## What arrives ready to use

Every imported card is new, so the deck shows its whole size under **new** in
the overview and the first sitting starts at the top.
[The schedule](/reference/flashcard-format.md#the-schedule-kasten-writes) starts
from there.

## See also

* [Flashcard format](/reference/flashcard-format.md) - what an imported note is written in
* [Spaced repetition](/explanation/spaced-repetition.md) - why the import writes markdown rather than rows
* [Configuration](/reference/configuration.md) - the setting naming the folder
