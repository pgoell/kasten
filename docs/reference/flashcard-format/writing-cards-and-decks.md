---
type: Reference
title: Writing cards and decks
description: How a card is written in a note, on one line, over several lines or as a cloze, how the tags put it in a deck, how decks nest, and how a whole note is kept for review.
resource: frontend/src/lib/review/srs.ts
tags: [vault, review, flashcards, format, frontend]
status: stable
---

# Writing cards and decks

How to write cards and the decks they land in. The sitting, the schedule and the limits are on [Reviewing cards](/reference/flashcard-format/reviewing-cards.md).

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

A deck tag is a tag by [the one tag rule](/reference/tag-format.md), so it ends
where any tag ends: `(#flashcards/es)` names the deck `es`, not `es)`, and
`#flashcardsx` is another tag and names no deck. A deck tag inside an HTML
comment, on one line or several, or inside a code block names no deck. A deck
tag at the head of a card counts as the card's only when a space follows it, so
`#flashcards/es) q::a` puts the whole note in `es`, not just that card.

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

A deck with decks under it has an arrow beside its row that folds them away
and brings them back, a tap on a phone and `za` in the pane. Every deck below
the top level starts folded, and each browser keeps what you unfold. A folded
row still counts due, new and parked for everything under it.

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
answer. A second `::` in the answer stays in the answer. A `::` inside a code
span divides nothing, so a line whose every `::` sits in code is no card.

### Over several lines

```markdown
The three storage classes worth knowing
?
Standard, Infrequent Access, Glacier
```

A `?` on a line of its own divides them. The question runs back to the blank
line or heading above, the answer forward to the blank line or heading below, so
both sides can be as long as you like. A blank line, a heading or a line of
tags inside a code block ends neither side: the fence goes into the card whole,
as obsidian-spaced-repetition reads it, and the schedule under the fence stays
the card's. A fence nobody closed is the one exception: there a blank line ends
the side as it does outside code, so a card above it never reaches a card the
fence hides. A schedule comment or `!suspended` ends the answer in code too,
and the question never runs up past a schedule comment.

Nor does the question run up past a one-line card, with a schedule or without.
obsidian-spaced-repetition asks a `::` line over the question as a card of its
own and starts the question under it. Directly over the `?`, it leaves the `?`
with no question, and a `?` with nothing above it is no card. A line whose every
`::` sits in a code span, or that opens with `::`, is no card and stays part of
the question.

Two `?` cards need a blank line between them. With none, and no schedule
under the upper one yet, obsidian-spaced-repetition reads the lines as one
card: the first `?` divides it, and the second `?` and everything under it are
part of the answer. kasten reads them the same way, so the two never share a
line and a rating writes one schedule, under the last line. Once the upper card
has a schedule or `!suspended` under it, that line ends it and the card under it
is a card of its own.

A `::` inside a code block is not a card, and neither is a `?` in one. That
holds for a fence opened with backticks or tildes, one nobody closed (it runs to
the end of the note), one inside a list item or a quote, and an indented code
block as CommonMark and the editor read it, most often four spaces or a tab
after a blank line. An indented line that only goes on with a paragraph or a
list item is no code block and stays a card.

### As a cloze

```markdown
The capital of {{c1::France}} is {{c2::Paris::a city}}.
```

Anki's cloze, mark for mark. A line holding `{{cN::text}}` is a cloze, and it
is one card per number: the line above asks twice, once as `c1` and once as
`c2`, and each is rated and scheduled apart.

* The question shows the line with that number's text hidden as `[...]`, or as
  `[hint]` where the mark carries one after a second `::`. The line above asks
  `The capital of [...] is Paris.` for `c1` and
  `The capital of France is [a city].` for `c2`. An empty hint,
  `{{c1::Paris::}}`, is no hint.
* Every other number shows as its plain text, marks gone.
* The answer shows the whole line with that number's text highlighted.
* Two marks of one number are one card, hidden and shown together:
  `{{c1::H}}{{c1::O}}` asks one card with both blanks.
* Typing the answer compares against the hidden text, two marks joined with
  `, `.

A mark may hold another, as Anki reads them since 2.1.56:

```markdown
{{c1::Canberra was {{c2::founded}} in 1913}}
```

* `c1` hides the whole outer mark, inner mark and all, and asks `[...]`.
* `c2` hides only its own text and shows the rest:
  `Canberra was [...] in 1913`.
* Each level takes its own hint, after its own text. In
  `{{c1::bar {{c2::baz::h2}}::h1}}`, `c1` asks `[h1]` and `c2` asks `[h2]`.
* An inner mark of the same number is one card with the outer:
  `{{c1::outer {{c1::inner}}}}` asks one card.
* Marks nest to any depth, each number one card.
* An outer mark never closed is text: `{{c1::a {{c2::b}}` is a cloze of `c2`
  alone, with `{{c1::a` shown as typed.
* A lone brace inside a mark still makes it no mark, nested or not, so
  `{{c1::\(x^{2}\)}}` is text.
* A mark inside a code span is text: `` `{{c1::Paris}}` `` asks nothing. A
  code span inside a mark is read whole, so ``{{c1::`a::b`}}`` asks `a::b`
  with no hint. A lone backtick is text, and ``{{c1::a`b}}`` is a mark.

The cloze is read before the divider. `{{c1::Paris}}` holds a `::`, and a line
holding a cloze mark is a cloze and never a card written on one line, so the
`::` inside the braces divides nothing. A line holding a mark and a `::` outside
it is still a cloze, the whole line its text. A one-line card written before
this existed whose answer holds a mark turns into a cloze, and the plain comment
on its line no longer schedules it.

Anki's Back Extra, text shown under the answer and never on the question, is the
`?` form with the cloze as its front:

```markdown
The capital of France is {{c1::Paris}}.
?
On the Seine.
```

The front is the cloze, asked as above, and the back is shown under the answer.
The cloze is the line directly above the `?`, the way a card's own tags are:
marks on a front line further up are read as their own one-line cloze.

The marks are text everywhere else. Live preview and Obsidian show them as
typed, and a line of `==Paris==` stays a highlight: it is a cloze in
obsidian-spaced-repetition and prose here.

A card's text is markdown, so a backslash before punctuation is an escape:
`a\-b` shows `a-b`, and `a\\-b` shows `a\-b`. `&#58;` shows a colon and
`\&#58;` the text `&#58;`. A code span is code everywhere: nothing in it is an
escape or a mark, so `` `a\-b` `` and `` `&#58;` `` show as written, and a
cloze mark or `!suspended` inside one is text and asks or parks nothing. The
one exception is an escaped schedule comment or import marker, under
[The schedule](/reference/flashcard-format/reviewing-cards.md#the-schedule). An
[imported Anki deck](/how-to/import-an-anki-deck.md) is written this way.

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

## What is not read

* **Reversed cards.** `:::` and `??` ask the same pair backwards in
  obsidian-spaced-repetition. Here they are ordinary text. Write the reverse as
  a second card.
* **An imported card's Anki id.** `<!--anki:1700000000001:0:5d41402a-->` at the end of
  a card's last line is what [a re-import](/how-to/import-an-anki-deck.md#import-a-newer-version-of-a-deck)
  finds the card by. The review takes it off both sides and never shows it,
  and a rating writes its schedule after it.
