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

A question that holds `::` itself, such as `What does std::move do?`, would be
cut at its first `::` on one line, so it is written
[over three lines](/reference/flashcard-format.md#over-several-lines) instead,
with a blank line above and below:

```markdown
What does std::move do?
?
casts to an rvalue
```

The tag cannot hold a space, so a deck called `AWS Certification` is tagged
`#flashcards/AWS-Certification`. The folder keeps the space.

A subdeck stays a subdeck. `Trivia::Geography` is tagged
`#flashcards/Trivia/Geography`, and the review draws it
[under `Trivia`](/reference/flashcard-format.md#a-deck-inside-a-deck), which
asks it along with everything else filed there.

`03 Flashcards` is
[KASTEN_FLASHCARDS_PATH](/reference/configuration.md#kasten_flashcards_path).

## Importing the same deck twice is refused

A deck whose note already exists answers 409 and writes nothing, not even the
decks in the same file that would have been fine. The note it would land on may
have fifty cards you have answered, and their schedules are in it.

To import a newer version of a deck, rename the old note first and merge by
hand, or export the new cards to a deck under another name.

## How a note becomes cards

Anki makes cards from a note through its note type's card templates, and the
import reads the same templates. Each card Anki made becomes one card: the
front template filled in is the question, and the back template filled in is
the answer. A field lands on the side its template puts it, wherever it sits in
the note, so an audio field in third place goes where you heard it in Anki.
"Basic (and reversed card)" gives two cards per note, and a note type with three
templates gives three. A note with a single field is imported as long as its
template gives it a front.

Each card goes to the deck its own Anki card sits in. A reverse card you moved
to another deck lands in that deck's note, not beside its forward card.

`{{FrontSide}}` on the back adds nothing, because the question is already on the
line. The answer holds only what the back adds to it. A card whose back adds
nothing is written as `question::`, which kasten reads as
[a parked question](/reference/flashcard-format.md#parking-a-card), so it waits
for an answer rather than vanishing. The exception is a question holding `::`
whose back adds nothing: it is left out, because a `?` with nothing under it is
no card.

A conditional section, `{{#Field}}` or `{{^Field}}`, shows or hides as it does in
Anki. A card whose front shows no field with text in it is not made, since Anki
does not make it either. A field holding only spaces, `<br>` or empty `<div>`
tags counts as empty.

## What does not survive

Three things, and the import says so rather than hiding them.

**Media.** Images and sounds are dropped, and the count of cards that referenced
one is reported, so a reversed note with an image counts two. The media map in a
current `.apkg` is zstd-compressed protobuf, which the standard library cannot
read without the schema. A card whose question was only a picture or a sound,
common in Japanese decks, has nothing left to ask and is left out; it counts
among the dropped media. Put the images back by hand with
[an image in a note](/reference/editor-keys.md), or keep those decks in Anki.

**Cloze.** An Anki cloze note arrives as one card, with its Text field the
question and Back Extra the answer, and its marks kept, so `{{c1::Paris}}`
becomes `==Paris==`. The text is all there and nothing asks the marks:
[cloze is not a card](/reference/flashcard-format.md#what-is-not-read) here.

**What a template does beyond its fields.** A filter such as `{{text:Field}}` or
`{{kanji:Field}}` gives the field as it is stored. `{{type:Field}}` gives nothing
on the front, and a `{{tts ...}}` tag gives nothing. The special fields
`{{Tags}}`, `{{Deck}}`, `{{Card}}`, `{{Type}}` and `{{Subdeck}}` give nothing,
and a `<script>` or `<style>` in a template adds nothing.

Formatting inside a field is flattened to one line: `<br>` and the end of a
`<div>` or `<p>` become spaces, every other tag is stripped, and entities are
unescaped.

## What arrives ready to use

Every imported card is new, so the deck shows its whole size under **new** in
the overview and the first sitting starts at the top.
[The schedule](/reference/flashcard-format.md#the-schedule-kasten-writes) starts
from there.

## See also

* [Flashcard format](/reference/flashcard-format.md): what an imported note is written in
* [Spaced repetition](/explanation/spaced-repetition.md): why the import writes markdown rather than rows
* [Configuration](/reference/configuration.md): the setting naming the folder
