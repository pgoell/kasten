---
type: Reference
title: "HTTP API: cards"
description: Routes that find flashcard lines, read the review limits, and import Anki decks, from a file or a link.
resource: backend/src/kasten_backend/routes/
tags: [api, backend, openapi]
status: stable
---

# HTTP API: cards

The routes that find flashcard lines, read the review limits, and import Anki decks, from a file or a link.

## GET /api/cards

Finds every line in the vault that could be part of a flashcard. Takes an
optional `archive` and answers with at most 100,000 matches, in the shape
`GET /api/search` returns.

```json
[{ "path": "03 Flashcards/aws.md", "line": 5, "text": "What does S3 stand for?::Simple Storage Service" }]
```

One `rg` pass, carrying the same flags search carries. Nothing is indexed and
Postgres is not consulted, for the reason search does not consult it.

It matches five shapes:

* a line holding `::`, or a line that is exactly `?`, which are
  [the two ways a card is written](/reference/flashcard-format/writing-cards-and-decks.md#the-two-ways-to-write-a-card)
* a line holding `<!--SR:!`, which is a card's schedule, or `<!--SR:c1!`, which
  is a cloze number's
* a line opening `!suspended`, which is
  [the token parking a card](/reference/flashcard-format/reviewing-cards.md#parking-a-card)
* a line holding `#flashcards` or `#review`, which is what makes a note a deck
* a line opening `sr-due:` or `sr-suspended:`, which are the due date and the
  parked state of a note that is itself the card

Nothing here parses a card. The endpoint hands the lines over whole, because the
browser has to parse the format anyway to draw one and two parsers in two
languages drift. Which note is a deck, which line is a question and which card
is due are all read on the client.

The `::` branch is deliberately loose and matches `std::vector` too. That costs
a line in this answer and never a card on screen: the deck tag decides which
notes are asked at all, so a note nobody tagged contributes nothing however many
colons are in it. Tightening the pattern here would mean reading every note that
matched.

A `std::vector` in a code block in a deck comes back too, and the client is what
skips it. It reads each deck note whole and asks the editor's markdown parser
where the code blocks and comments are, so a fence of tildes, an indented block
and a fence in a list item or a quote all hold no card. No line pattern here
could tell it that, so the scan sends no fence lines.

The cap is 100,000 rather than search's 2,000, for the reason `GET /api/todos`
carries that number: a backstop against one generated file, not a limit on how
many cards a person can own. An imported Anki deck is a real four-figure case.

`archive` walks the archive folder too, and is off by default. That is the whole
of [filing a deck away](/reference/flashcard-format/reviewing-cards.md#filing-one-away): moving
the note into the archive takes it out of the review and changes nothing else.

A vault directory that does not exist reads as an empty one.

## GET /api/review/limits

Names the daily limits a deck falls back on where
[`decks.md`](/reference/flashcard-format/reviewing-cards.md#daily-limits) sets none, read off
[`KASTEN_REVIEW_NEW_PER_DAY`](/reference/configuration.md#kasten_review_new_per_day)
and [`KASTEN_REVIEW_REVIEWS_PER_DAY`](/reference/configuration.md#kasten_review_reviews_per_day).
`null` means no limit.

```json
{ "new_per_day": 20, "reviews_per_day": null }
```

Only the default. The limits per deck live in a note the client reads like any
other, so the vault holds them and its history shows each change.

## POST /api/anki

Turns an Anki export into one markdown note per deck. Takes the `.apkg` bytes as
the raw request body, the way `POST /api/assets/{path}` takes a book, and
answers 201 with what was written.

The body is counted as it arrives. Past the upload cap it is refused with 413
at the chunk that crosses it, and nothing after that chunk is read.

With `?upload=<id>` and no body, it imports the file sent in pieces through
[`POST /api/uploads`](/reference/http-api/assets-and-books.md#post-apiuploads) instead, and deletes that upload
whether the import lands or is refused.

```json
{
  "notes": ["03 Flashcards/AWS.md"],
  "cards": 412, "media": 17,
  "added": 5, "updated": 3, "kept": 380, "removed": 2
}
```

`notes` names every deck's note, written or not. `added`, `updated`, `kept` and
`removed` count marker lines, so a cloze counts once there however many
numbers it asks; `cards` counts each number. A first import counts every card
as added.

Every card ends in `<!--anki:NID:ORD:HASH-->` after its last line: its Anki note
id, its template ord (a cloze's lowest), and the first 8 hex digits of the
sha256 of the lines the import wrote for it. A rating writes its schedule after
or under that marker and never touches it. When the deck's note already exists,
the import merges into it by marker, and finds each card's lines as the ones
ending at the marker whose hash matches:

* A card whose text is what the import would write now is kept untouched.
* A card whose lines no longer match the hash was edited in kasten, and is
  kept untouched, counted as `kept`, whatever Anki now holds.
* A card whose text Anki changed is written anew, its schedule comments and
  `!suspended` token carried into its new shape.
* A card `srs.ts` reads as part of another card is kept untouched, counted as
  `kept`, whatever Anki now holds: one under a `?` line with nothing between
  that ends a back (no blank line, heading, tag line, token or schedule), and a
  `?` card with no schedule under its marker and a line there that ends no
  back.
* A card the note lacks goes on the end.
* A card the export lacks stays in the note and is counted as `removed`.
* A line without a marker, the tag line, a card of your own, prose, comes
  through byte for byte.
* A note the merge would leave unchanged is not written at all.

`?carry=true` writes Anki's schedule onto every card the import adds that
Anki holds in review (card `type` 2): the due date is `col.crt` plus `due`
days, the interval `ivl`, the ease `factor` divided by ten, as the
`<!--SR:!…-->` a rating would write, one `<!--SR:cN!…-->` per number on a
cloze. A card new or in learning in Anki gets none, and a card already in the
note keeps kasten's schedule. Off by default.

The export is read with `zipfile`, `sqlite3` and `compression.zstd`, all of them
in the standard library on Python 3.14, so importing a deck adds no dependency.
Both the current collection format and the older one are read.

Each card Anki made from a note becomes one kasten card. The question is the
note type's front template filled in and the answer its back template, so a
field lands on the side its template puts it, and a note type with two
templates gives two cards per note. `{{FrontSide}}` on the back adds nothing, so
the answer holds only what the back adds. Conditional sections follow Anki, and
a card whose front shows no field with text in it is not made, as Anki does not
make it. A card whose back adds nothing is written as `question::`, a
[parked question](/reference/flashcard-format/reviewing-cards.md#parking-a-card), and a card
whose question is empty once flattened is left out. A question holding `::` is
written over three lines, question, `?` and answer, so the first `::` does not
cut it short. Each `::` of the question outside a code span is written
`:&#58;`, which the review shows as `::`, so the question line does not read as
a card of its own; the answer keeps its `::`. Such a card is left out when its
answer is empty or `?`, or when either side is a heading, a line of only tags
or a line opening with `!suspended`, or its answer holds a whole schedule
comment, any of which would end the card.
A question ending in `:` is written `question ::answer`, so the colon stays on
the question, and a side that would open its line with three backticks gets a
backslash in front, so it opens no code block.
`cards` counts the cards the notes hold, not those Anki made. A cloze note gives
one [cloze](/reference/flashcard-format/writing-cards-and-decks.md#as-a-cloze) line, its marks and hints
kept, written over three lines with `?` when its Back Extra holds text, and
counts one card per number it marks. Each card goes to the
deck its own Anki card sits in, HTML is flattened to one line, and a nested deck
becomes a nested folder under
[KASTEN_FLASHCARDS_PATH](/reference/configuration.md#kasten_flashcards_path).

Images and sounds come with their deck. Each file a card names in an `<img>` or
a `[sound:]` is written to a folder beside the deck's note,
`03 Flashcards/AWS media/cat.png` for the note `03 Flashcards/AWS.md`, and the
card links it as `![](03%20Flashcards/AWS%20media/cat.png)`, a vault path
percent-encoded the way the editor encodes one, with `:`, `(` and `)` encoded
too. The editor draws a link to a sound as a player. Both forms of the media map
are read: the JSON one of an older export and the zstd-compressed protobuf of a
current one, whose files are zstd-compressed too. A file two decks name is
written once into each. `media` counts the files written.

A file goes through the checks `POST /api/assets/{path}` makes: a suffix the
vault takes as an image or a sound, bytes that start the way the suffix says,
and the 100MiB cap. A name that is not one plain file name (empty, hidden, holding
a slash, or over 241 bytes, which leaves room for the temp file it is streamed
into) is refused too. If a write fails partway, the files the import already
wrote are taken back out. A refused file, and one the export
lists but does not hold, is not written, and the card loses the reference as if
it had never been there; the import still lands. A card whose question was only
such a file has nothing left to ask and is left out.

### What an import refuses

* A body that is not a zip, or a zip holding no collection, answers 400.
* A collection kasten cannot read answers 400 with a `detail` saying the export
  is unreadable: a `collection.anki21b` that is not zstd, a deck with no name
  or a name that is not text, a note whose fields are not text, or a media map
  that cannot be read.
* A deck name that would climb out of the flashcards folder answers 400.
* A collection with no note types answers 400, because without templates there
  is nothing to make a card from.
* A deck whose note already exists but holds no `<!--anki:NID:ORD:HASH-->` marker,
  one imported before the cards carried their ids, answers 409, and **nothing
  is written at all**, not even the decks in the same export that would have
  been fine. Every path is resolved and every collision found before the first
  write.
* A deck holding a card the import would add whose marker already sits in
  another note, outside the export's own notes and the archive, answers 409
  the same way, with a `detail` naming those notes and saying to join them
  into the deck's note. A merge goes into one note, so the card would land
  there a second time.
* A media file whose path is already taken answers 409 the same way for a deck
  imported the first time. A deck merged into its note keeps the file it finds
  and does not count it.
* With `carry`, a collection whose `col` row holds no creation time answers 400.
* A body over 1GiB answers 413 `That file is over the 1 GiB limit`.
* With `upload`, an id no upload holds answers 404 `No such upload`, and one
  whose pieces do not yet add up to its size answers 409
  `That upload is not finished`.
* An export that holds more than 50,000 files, whose collection or media map
  unpacks past 1GiB, or whose files unpack past 2GiB together, answers 400
  with a `detail` starting `Anki export too large`. The bytes are counted as
  they unpack, and nothing is written. The files are counted from the zip's
  directory before it is read, so an export of millions of empty files is
  refused before it takes the memory to list them.
* A zip whose member cannot be read answers 400 with a `detail` starting
  `unreadable Anki export: <member>:`, and nothing is written. That is a
  corrupt or cut-short stream, a bad CRC, an encrypted member, or a method
  Python cannot read, such as deflate64. A media file whose zip stream cannot
  be read refuses the whole deck too, while one whose contents are not what
  its name says, bad zstd or the wrong type, is left out of the card as
  before. A member whose local header says its name is utf-8 when it is not
  answers 400 the same way. A zip written in a version past what Python
  reads, or whose directory holds such a name, answers 400 the same way,
  without a member name.

[Import an Anki deck](/how-to/import-an-anki-deck.md) is the runbook.

## POST /api/anki/link

Fetches the deck a link names and imports it as `POST /api/anki` imports a
file: the same merge, the same `?carry=true`, the same 201 body and the same
400 and 409 refusals, word for word. The body is JSON:

```json
{"url": "https://ankiweb.net/shared/info/2109889812"}
```

The link is a plain https address of an `.apkg`, or an AnkiWeb shared deck's
page, `https://ankiweb.net/shared/info/<id>`. For the page, the backend looks
for a link on it to an `.apkg` or to AnkiWeb's `download-deck` path and fetches
that. It never builds a download address from the id and never calls
AnkiWeb's `/svc` API. AnkiWeb serves a server a JavaScript shell with no link
in it today, so a page link is refused with the browser message below.

Every hop, redirects included, goes through the checks `GET /api/fetch` makes
on the address, and one more on the scheme:

* A link that is not https, or a redirect to http, answers 400
  `Only https links`. So does text that is no link at all.
* An address off the internet, loopback, private, link-local, the metadata
  address `169.254.169.254` and the rest `GET /api/fetch` refuses, answers 400
  `That address is not on the internet`, on any hop. The socket opens to the
  address checked, so a name that answers otherwise a second time changes
  nothing.
* A deck over 100MiB answers 413 `That file is over the 100 MiB limit`. The
  bytes are counted as they arrive and reading stops at the cap, whatever
  `content-length` says. A file sent from the browser may weigh 1GiB; a link
  keeps the lower cap because the backend, not the reader, pays for the fetch.
* A fetch that takes over two minutes in all answers 504
  `That link took too long to answer`.
* A web page or other bytes that are not a zip answer 400
  `That link is a web page, not an Anki deck` or `That link is not an Anki deck`.
* A 404 or 410 answers 502 `That deck is gone: the link answered 404`.
* A 401, a 403, or a redirect to an `/account/login` page answers 502 with a
  message to download the `.apkg` in a browser.
* A page that asks for a captcha or carries Cloudflare's challenge answers 502
  saying kasten does not get past it.
* An AnkiWeb page with no download link answers 502
  `AnkiWeb's page needs a browser: open it there, press Download, and import the .apkg here`.
* Any other status of 400 or more answers 502 `That link answered N`.

A refused or failed link writes nothing to the vault.

