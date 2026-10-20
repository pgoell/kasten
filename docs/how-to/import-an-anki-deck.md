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
deck. Tick **Include scheduling information** if you want kasten to carry on
from Anki's schedule; leave it out for a fresh start. Both the current export
format and the older one are read, so no compatibility option needs setting.

## Import it

Open `/review`, either on a phone or through `<leader>gs` in the app, and open
**Import** above the decks; it stays closed until you do. To carry Anki's
schedule, tick **Carry Anki's schedule** first; it is off by default. Press
**Import an Anki deck** and pick the `.apkg`.

The line under the buttons says what arrived: how many decks and cards, how many
the import added, updated and kept, how many Anki no longer has, and how many
image and sound files came with them.

## From a link

Beside **Import an Anki deck**, the field takes a link instead of a file. Paste
it and import; kasten fetches the deck and imports it as it would the file,
with the same summary and the same **Carry Anki's schedule**.

Two kinds of link work:

* A plain https address of an `.apkg`, such as a GitHub release asset. A
  redirect to another https host is followed.
* An AnkiWeb shared deck's page, `https://ankiweb.net/shared/info/<id>`. kasten
  looks for the download the page offers and fetches it.

AnkiWeb draws that page in JavaScript, and what it sends a server today holds
no download link, so kasten answers that the page needs a browser. Open the
page in a browser, press **Download**, and import the `.apkg` here as a file.
kasten does not get past a captcha or a login either: it tells you which one
the link asked for, and the way round is the same.

kasten refuses a link that is not https, a redirect to http, and any address
that is not on the internet, such as `localhost` or the box's own network,
whichever hop it shows up on. It refuses a deck over 100MB, a fetch that takes
over two minutes, a link that answers with a web page or anything else that is
not a deck, and a deck that is gone. A refused link writes nothing.

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

What is a VPC?::A virtual private cloud <!--anki:1700000000001:0:5d41402a-->
Which region is cheapest?::us-east-1 usually <!--anki:1700000000002:0:7d793037-->
```

The comment at the end of a card's last line is its Anki note id and template,
and a short hash of the text the import wrote.
It is how a later import of the same deck finds the card; the review never
shows it, and a rating writes its schedule after it. Leave it in place.

A question that holds `::` itself, such as `What does std::move do?`, would be
cut at its first `::` on one line, so it is written
[over three lines](/reference/flashcard-format.md#over-several-lines) instead,
with a blank line above and below:

```markdown
What does std::move do?
?
casts to an rvalue
```

A question ending in a colon, such as `Ratio 1:`, is written with a space
before the `::`, so the colon stays on the question. A side that would open its
line with three backticks or three tildes has them escaped, `` \`\`\`js `` or
`\~~~`, so it opens no code block that would hide the cards below it.

A side running over several lines, a list or a field with line breaks in it,
is written over three lines the same way, each side keeping its lines:

```markdown
Name three primary colours
?
- red
- yellow
- blue
```

A side never holds a blank line, since a blank line ends the card: a paragraph
and a `<br>` both become one line break, and a run of them becomes one. A
question over several lines whose answer is empty is written on one line as
`question::`, its breaks spaces, because a `?` with nothing under it is no card.

The tag cannot hold a space, so a deck called `AWS Certification` is tagged
`#flashcards/AWS-Certification`. The folder keeps the space.

A subdeck stays a subdeck. `Trivia::Geography` is tagged
`#flashcards/Trivia/Geography`, and the review draws it
[under `Trivia`](/reference/flashcard-format.md#a-deck-inside-a-deck), which
asks it along with everything else filed there. `Trivia` starts folded, so
press the arrow beside it, or `za` in the pane, to see `Geography`.

`03 Flashcards` is
[KASTEN_FLASHCARDS_PATH](/reference/configuration.md#kasten_flashcards_path).

## Images and sounds

The images and sounds a deck's cards use land in a folder beside its note:

```
03 Flashcards/Japanese.md
03 Flashcards/Japanese media/kanji.mp3
03 Flashcards/Japanese media/paste-1234.png
```

The card links each file where its field had it, as a markdown image:

```markdown
![](03%20Flashcards/Japanese%20media/kanji.mp3)::漢字 Chinese characters
```

A sound is drawn as a player. A card whose question is only a sound, common in
Japanese decks, is a card like any other. `.png`, `.jpg`, `.jpeg`, `.gif`,
`.webp`, `.mp3`, `.m4a`, `.ogg` and `.wav` come through. A file two decks share
is written into each deck's folder.

On a first import, if a file in that folder already exists, the whole import is
refused. A re-import keeps the files already there and writes the new ones.

## Import a newer version of a deck

Export the deck from Anki again and import it the same way. The import merges
into the deck's note, card by card, using the comment at the end of each card:

* A card Anki has not changed stays as it is.
* A card you edited in kasten keeps your text, even when Anki changed it too.
  The hash in the comment no longer matches, and the import leaves the card
  alone. One exception: kasten 0.49.2 and older wrote a schedule comment in a
  cloze answer bare, and rating the card rewrote it there. Where that rating
  is the only change, the import writes the answer escaped and moves the
  rated schedule after the comment.
* A card whose text Anki changed gets the new text and keeps the schedule and
  the parking you gave it in kasten.
* A card new in Anki goes on the end of the note.
* A card you deleted in Anki stays in the note, schedule and all, and the
  import counts it as removed. Delete the line yourself if you want it gone.
* Every line without the comment, cards you wrote yourself and notes between
  cards, stays as you left it.

A re-import that changes nothing does not touch the note.

**Carry Anki's schedule** applies only to the cards an import adds. A card
already in the note keeps the schedule kasten has for it.

A deck imported before kasten wrote the comment cannot be merged, because
nothing in it says which card is which. Importing it again is refused and
writes nothing. Rename the old note first and import into a fresh one.

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
no card. The count the import reports is of the cards the notes hold, so it
leaves such a question out too.

A line of a side that kasten would read as part of the format gets a backslash,
so it reads as the text it was and the card keeps it: a heading such as
`\# of elements`, a line of nothing but tags such as `\#pragma`, a line of `\?`
alone, a line opening with `\!suspended`, and a schedule comment, written
`<!--SR\:!2026-08-20,4,270-->`.

A cloze note arrives as [a cloze](/reference/flashcard-format.md#as-a-cloze),
its marks and hints as Anki had them, one line however many cards Anki made
from it:

```markdown
The capital of {{c1::France}} is {{c2::Paris::a city}}.
```

kasten asks that line once per number, `c1` apart from `c2`, with the hint
shown in the blank, as Anki does. A note whose Back Extra holds text is written
[over three lines](/reference/flashcard-format.md#as-a-cloze), the cloze, `?`
and the Back Extra, with a blank line above and below, so the extra shows under
the answer, over as many lines as it holds. The cloze itself stays one line,
its line breaks spaces, because a second line holding a mark would be another
cloze. Marks in the Back Extra, and in a note
of any other type, become highlights, `==Paris==`, since Anki shows them as
typed there and asks no card of them. So does a mark kasten does not read, one
holding a lone brace such as MathJax's `{{c1::\(x^{2}\)}}` or one with no text,
`{{c1::}}`. Kasten draws no math, so a MathJax mark's backslashes are kept as
text: `{{c1::\(x^{2}\)}}` becomes `==\\(x^{2}\\)==`, which shows `\(x^{2}\)`.
A brace written as an entity, `&#123;` or `&lbrace;`, counts as the
brace it shows, so `{{c1::&#123;}}` becomes `=={==` as `{{c1::{}}` does. A
colon is the other way round: Anki divides the answer from the hint only at a
`::` typed as such, so a pair written as entities, `a&#58;&#58;b`, or split by
a tag is part of the answer. Where such an answer holds `::`, or ends in a
colon before its hint, its colons are written `&#58;`, which kasten shows and
takes from a typed answer as `:`, so `{{c1::a&#58;&#58;b}}` asks `a::b` with
no hint. A field whose text shows `&#58;` itself, written `&amp;#58;`, is
written `\&#58;` on any side outside code, which kasten shows as the text
`&#58;` as Anki does. That holds where a tag splits it too: `a&amp;#<b></b>58;b`
shows `a&#58;b` and is written `a\&#58;b`. A backslash in a cloze answer is doubled as anywhere
else, so an answer Anki shows as `a\::b` is written `{{c1::a\\&#58;&#58;b}}`. A
schedule comment in a cloze answer or hint takes its backslash as on any line,
in code too, so `{{c1::&lt;!--SR:c1!2026-01-01,1,250--&gt;}}` is written
`{{c1::<!--SR\:c1!2026-01-01,1,250-->}}`, and review never reads it as the
schedule of `c1`. In an answer whose colons are written `&#58;`, the comment's
colon is too, `<!--SR&#58;c1!…-->`, with no backslash, and so is the colon of
the import's own marker, `<!--anki&#58;7&#58;0-->`, which review shows as
`<!--anki:7:0-->`. A nested mark, `{{c1::a {{c2::b}}}}`, stays as Anki had it, and an inner mark
kasten does not read is its text alone, so `{{c1::a {{c2::}}}}` becomes
`{{c1::a }}`. Where no mark is kept, a mark never closed runs to the end of the
field, so its `::` cannot split the line. A cloze
note holding no mark kasten reads is written as `Text::Back Extra`. The count
takes a cloze as one card per number, nested marks among them, so the line
above counts two.

A conditional section, `{{#Field}}` or `{{^Field}}`, shows or hides as it does in
Anki. A card whose front shows no field with text in it is not made, since Anki
does not make it either. A field holding only spaces, `<br>` or empty `<div>`
tags counts as empty.

## Formatting

A field's formatting arrives as markdown:

| In Anki | In the note |
|---|---|
| bold, and underline | `**bold**`, there being no markdown underline |
| italic | `*italic*` |
| a link | `[text](address)` |
| a bulleted or numbered list | a `- ` or `1. ` line per item |
| `<code>` | `` `code` `` |
| a `<pre>` block | a line of `` `code` `` per line, since cards inside a fence are skipped |
| ruby, `<ruby>漢字<rt>かんじ</rt></ruby>` | the same tags, drawn with the reading over the word |

The furigana filters do what they do in Anki. `{{furigana:Reading}}` turns
`漢字[かんじ]` into the ruby above, `{{kanji:Reading}}` gives `漢字` and
`{{kana:Reading}}` gives `かんじ`. A field shown with no filter keeps its
brackets, as Anki shows it.

Text that markdown would read as formatting gets a backslash, so it reads as
text: `2\*3`, `snake\_case`, `` \` ``, `\[note]` and `\=\=`. A backslash the
field shows is written `\\`, so `a\-b` stays `a\-b` and is no escape. A line
opening with three backticks or three tildes is written `` \`\`\` `` or `\~~~`,
so it opens no code block. So is one where the fence opens a list item or a
quote, `` - \`\`\` `` or `> \~~~`, since markdown reads a fence there too.
Inside code, `<code>` or a line of a `<pre>`, only a schedule comment and the
import's own marker get a backslash, because kasten reads those in code too.
Review shows and types them without it, as Anki shows them.
Nothing else does, since kasten shows a code span as written: `<code>a\-b</code>` is `` `a\-b` `` and a
`<code>` showing `&#58;` is `` `&#58;` ``. Every entity but that one colon
arrives as the text Anki shows, `&copy;` as `&copy;`.

Kasten reads no cloze mark and no `!suspended` inside a code span, so a cloze
mark Anki reads inside `<code>` or a `<pre>` line is written with the code
moved inside it: `<code>{{c1::a&#58;&#58;b}}</code>` becomes ``{{c1::`a::b`}}``,
and `<code>x {{c1::a\b}} y</code>` becomes ``` `x` {{c1::`a\b`}} `y` ```. The
answer in the code is as Anki shows it, with no backslash and no `&#58;`, since
kasten reads a code span in a mark whole. A mark in code that becomes a
highlight is written ``==`a`==``.

## What does not survive

Two things.

**Some media.** A file in another format, such as a video or an `.svg`, is
dropped from its card, and so is one whose bytes are not what its name says or
whose name is not a plain file name. The card keeps its text, and the import
still lands. A card whose question was only such a file has nothing left to ask
and is left out.

**What a template does beyond its fields.** A filter other than the three
furigana ones, such as `{{text:Field}}` or `{{hint:Field}}`, gives the field as
it is stored. `{{type:Field}}` gives nothing on the front, and a `{{tts ...}}`
tag gives nothing. The special fields `{{Tags}}`, `{{Deck}}`, `{{Card}}`,
`{{Type}}` and `{{Subdeck}}` give nothing, and a `<script>` or `<style>` in a
template adds nothing. A cloze note is written from its fields and not its
template, so a filter there does nothing either.

Formatting beyond the table above, colour, font size, a heading, a table, is
dropped and its text kept. Entities are unescaped. A cloze mark is written flat,
`{{c1::France}}` from `{{c1::<b>France</b>}}`, so a typed answer can match it.
Only ruby stays inside a mark, and the typed answer to it is the word without
its reading: `漢字` for `{{c1::<ruby>漢字<rt>かんじ</rt></ruby>}}`.

## What arrives ready to use

Without **Carry Anki's schedule**, every imported card is new, so the deck shows
its whole size under **new** in the overview and the first sitting starts at
the top. [The schedule](/reference/flashcard-format.md#the-schedule-kasten-writes)
starts from there.

With it, a card Anki has in review arrives with Anki's due date, interval and
ease in its schedule comment, so a mature deck comes due as it would have in
Anki. A card that is new or still in learning in Anki arrives new.

## See also

* [Flashcard format](/reference/flashcard-format.md): what an imported note is written in
* [Spaced repetition](/explanation/spaced-repetition.md): why the import writes markdown rather than rows
* [Configuration](/reference/configuration.md): the setting naming the folder
