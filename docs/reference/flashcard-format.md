---
type: Reference
title: Flashcard format
description: The two ways a card is written and the cloze, the comment holding its schedule, the tags that put a note and a single card in a deck, how a deck sits inside another, the frontmatter a whole note under review carries, the keys a sitting takes, its Undo and Center, and the daily limits on new cards and reviews.
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
[The schedule](#the-schedule). An
[imported Anki deck](/how-to/import-an-anki-deck.md) is written this way.

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
| `za` | Fold or unfold the deck under the cursor; on a deck with none under it, fold the deck above |
| `p` | Open the parked list |
| `h` | Leave the sitting or the parked list, back to the decks |
| `Space`, `Enter` | Show the answer |
| `1` `2` `3` `4` | Again, Hard, Good, Easy |
| `s` | Park the card on screen |
| `n` | Jot a new question into the note the card came from |
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
interval of 1 or 4 was new. Two cases read wrong: a new card asked a second time
in its first sitting, after an `Again`, counts as a review, and a review that
lands back on ease 250 with an interval of 1 or 4 counts as new.

The overview shows what today's sitting will ask, its limit less what was
answered today, and the sitting asks exactly that. A deck with nothing left
under its limits reads `0` due and `0` new and cannot be sat. A [parked](#parking-a-card) card counts against no limit and
the parked count does not change. A [whole note for review](#a-whole-note-for-review)
takes no limit.

A sitting keeps the limits it started with. A change to `decks.md` applies from
the next sitting.

## Typing the answer

`Type` in the header swaps the reveal button for a text field. Submitting it
shows the answer along with whether what you typed matched, and then the four
ratings as usual. The comparison forgives case, spacing and a trailing full
stop, and forgives nothing else. The answer is compared without the backticks
of its code spans, so you type ``a::b`` for ``{{c1::`a::b`}}``.

A mismatch never refuses a rating. The verdict is a note to yourself, not a mark.

The toggle is kept in the browser, not in the vault: it is a preference about
how you like to be asked, not a fact about the notes.

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

## What is not read

* **Reversed cards.** `:::` and `??` ask the same pair backwards in
  obsidian-spaced-repetition. Here they are ordinary text. Write the reverse as
  a second card.
* **An imported card's Anki id.** `<!--anki:1700000000001:0:5d41402a-->` at the end of
  a card's last line is what [a re-import](/how-to/import-an-anki-deck.md#import-a-newer-version-of-a-deck)
  finds the card by. The review takes it off both sides and never shows it,
  and a rating writes its schedule after it.

## See also

* [Import an Anki deck](/how-to/import-an-anki-deck.md): turning an `.apkg` into notes
* [Spaced repetition](/explanation/spaced-repetition.md): why the schedule is in the file
* [Editor keys](editor-keys.md): every binding, including `<leader>gs`
* [Todo format](todo-format.md): the other borrowed format
* [HTTP API](http-api.md): the endpoints a sitting reads and writes
