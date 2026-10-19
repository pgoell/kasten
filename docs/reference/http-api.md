---
type: Reference
title: HTTP API
description: Every endpoint the backend serves, with its response shape.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API

The backend serves forty-two endpoints under `/api/`. Twenty-seven read,
fourteen write, and one streams. The interactive schema is at `/docs` while the backend
runs, and the machine-readable one at `/openapi.json`.

The agent's routes sit under `/agent/`, and they are documented on their own page,
[the Agent API](/reference/agent-api.md). Everything here is reached through
the login gate in front of kasten and nothing else; everything there is reached
with a bearer token and nothing else.

The OAuth consent step, `GET` and `POST /api/oauth/authorize`, sits under
`/api/` too but is left out of the count and the schema. It is documented with
the rest of [the OAuth flow](/reference/agent-api.md#get-and-post-apioauthauthorize),
including the check that refuses a cross-site `POST` with a `403`.

## GET /api/health

Reports that the process is up. It deliberately does not touch the database, so
it stays a liveness check and does not become a readiness check by accident.

```json
{ "status": "ok" }
```

## GET /api/version

Names the code that is answering. In production that is the release, read off
the installed package; in development it is the seven-character commit the
working tree is on, read out of `.git/HEAD` beside the source. A route of its
own rather than a field on `/api/health`, which the deploy polls and which says
nothing but whether the process is up.

```json
{ "backend": "0.8.0" }
```

The frontend's own half of that reading is not here and cannot be: a bundle in
a browser has no repo to ask, so `vite.config.ts` stamps it in at build time.
[Two environments](/explanation/environments.md#which-one-you-are-looking-at-and-what-it-is-running)
says what the status bar does with the pair.

## GET /api/layout

Names the folders the vault keeps things in, each a path from the vault root,
read off the [folder settings](/reference/configuration.md#the-vaults-folders).

```json
{
  "inbox": "00 Inbox",
  "periodic": "01 Periodic",
  "archive": "98 Archive",
  "images": "99 Misc/02 Assets/01 Images",
  "config": "99 Misc/01 Config"
}
```

The editor makes notes and images by itself, so it has to know where they go.
It asks once when the page loads and keeps the answer. Until the answer
arrives it uses the defaults above, so a vault on the defaults sees no change
at all.

## GET /api/files

Lists every note in the vault as a relative POSIX path, sorted.

```json
["daily/2026-08-05.md", "index.md", "projects/kasten.md"]
```

The list is flat and the server keeps it that way. Folders are not modelled
anywhere in the backend; the frontend folds the paths into a tree. Hidden files
and directories are skipped, which keeps `.git` and editor dotfiles out, and a
hidden directory is skipped without being walked into, so the jj repo beside the
notes costs nothing. A vault directory that does not exist reads as an empty
one, so a fresh checkout still serves.

A directory is walked and never listed, whatever its name ends in. Reading one
is a `404`, so a folder called `notes.md` would otherwise be a row in the tree
that answered nothing when you opened it.

The walk costs 15.9ms at 10,000 notes in 842 folders. See [the load
side](/reference/ranking-performance.md) for what that used to be and what a
cold open spends the rest of its time on.

## GET /api/images

Lists every image in the vault as a relative POSIX path, sorted.

```json
["99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png"]
```

The same walk `/api/files` makes, filtered on the image suffixes instead of
`.md`: `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`, in any case, so
`PHOTO.PNG` is listed. A note's `.md` is matched exactly, so `NOTES.MD` is not a
note. Hidden files and directories are skipped the same way, and a vault that
does not exist reads as an empty one.

Its own listing rather than rows in `/api/files`, which the tree, the finder,
search and the link rewrite all read: an image is not a note and has no business
in any of those. The editor reads this one to complete the path inside a `![](`,
which is the only thing in the app that asks.

## GET /api/html

Lists every HTML page in the vault as a relative POSIX path, sorted.

```json
["00 Inbox/research/spec-driven-development/report.html"]
```

The same walk `/api/images` makes, filtered on `.html` in any case. `.htm` is not
listed. The file tree reads this to draw a page as a row beside the notes.

## GET /api/html/{path}

Reads one HTML page out of the vault, as `text/html`, for the frame the HTML
pane draws it in. `path` is a vault-relative POSIX path ending in `.html`.

The page goes out with a policy of its own in `Content-Security-Policy`:

| Directive | Why |
| --- | --- |
| `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox` | The page runs in an origin that is nobody's, so its script reads no cookie and no storage of kasten's, even opened in a tab of its own |
| `script-src 'unsafe-inline' https:` | A slide deck draws itself with inline script; a chart library comes off a CDN |
| `style-src 'unsafe-inline' https:` | A report carries its own styles, and fonts off Google Fonts |
| `img-src 'self' data: blob: https:` | Pictures, inline or linked |
| `connect-src 'none'`, `form-action 'none'` | The page cannot send a request to kasten, a write included |

A short script is added after the page, which sends a link to another site to
a new tab: the app's own `frame-src` keeps the frame on kasten. Added after
rather than before, so the doctype stays first and the page keeps its
standards mode. The file itself is not changed.

Anything that is not a readable `.html` file inside the vault is a `404`, on
the rules the note read follows. There is no write: a page gets into the vault
from a terminal or an agent with a shell.

## GET /api/terminals

Names every herdr session a terminal pane could attach to, sorted. Takes
nothing and answers with a JSON array of strings.

```json
["agent-kasten", "notes"]
```

This is the one endpoint that reads nothing of the vault. The shell container
keeps one directory per named session under its own home, and this lists that
directory through a read-only mount of the same volume. So the backend runs no
herdr, holds no socket, and cannot start, stop or read into a session; the
worst it can do is name one.

It says what exists rather than what is running, because a directory is all it
looks at. That costs nothing in practice: `herdr --session <name>` attaches to
a stopped session and starts a missing one alike, so the two are the same
request from the browser's side.

An absent directory is not an error and answers `[]`. The mount is optional and
the shell container need not be up for the notebook to work, so the terminal
prompt falls back to a bare input that takes a name typed by hand.

## GET /api/fetch

Reads one web page off the internet and hands it back unchanged. Takes one
query parameter, `url`, and answers with the markup and the address the page
finally came from.

```json
{ "url": "https://example.com/2025/post", "html": "<!doctype html>…" }
```

One of the endpoints that touch nothing of the vault, and one of the three that
go outside the machine; `GET /api/transcripts/{video_id}` below asks YouTube
alone, and `GET /api/weather` asks Open-Meteo alone. It writes nothing: turning the markup into a note is
[defuddle](https://github.com/kepano/defuddle) running in the browser, and the
note is made through `POST /api/files/{path}` like any other.

The extraction has to be there and the fetch has to be here. defuddle reads a
DOM and the browser is where the DOM is; a second extractor in Python would
read the same pages differently. The browser, meanwhile, will ask another
origin for a page and then refuse to let a script read the answer, so the
request goes out from the server.

`url` must be `http` or `https`. That check is the trust boundary and it runs
before anything is opened: `file:///etc/passwd` would otherwise read the
container's disk and hand it to the browser. Anything else is a `400`.

The host must also be on the public internet. Every address its name resolves
to is checked, and one that is loopback, private, link-local, shared (CGNAT,
which Tailscale uses), multicast, reserved or unspecified is a `400`, in IPv4
or IPv6, with an IPv4 address inside an IPv6 one checked as the IPv4 address.
The backend shares a docker network with the database and the shell, and this
is not a way to reach them.

The check runs inside the connection rather than in front of the request. The
name is looked up once, and the socket opens to the address that passed, so a
name that answers a public address and then `127.0.0.1` has no second lookup
to answer. TLS still checks the certificate against the name.

Redirects are followed, at most twenty, and every hop connects the same way. A
public page that redirects to the box itself is the obvious way round a check
made once. A redirect to anything but `http` or `https` is a `502`.

The address that comes back is the one after redirects, because a page's
relative links are relative to that and the client resolves them.

Four refusals beside the address, and each says which it is, because the reader
is looking at the address they pasted and is the one who can fix it:

* `415` when the answer is not HTML, which is what a link to a PDF gets
* `502` when the name does not resolve, or the page redirects more than twenty
  times
* `502` with the number when the page answered `400` or worse
* `502` when the page is bigger than 8 MB, counted as the bytes arrive rather
  than believed off `content-length`, or when it did not answer inside twenty
  seconds

A page that answers `404` is a `502` here rather than a `404`, which would say
this endpoint is missing rather than that the page is.

The request goes out under a browser's user agent string. A great many sites
answer an unfamiliar agent with a challenge page, and this is one page asked
for by hand, by somebody who could have opened it in a tab.

## GET /api/transcripts/{video_id}

Reads the captions of one YouTube video. The path takes the video's eleven
character id, and the answer names the track and holds every caption with the
second it appears at.

```json
{
  "language": "en",
  "generated": false,
  "lines": [
    { "start": 0.0, "text": "We&#39;re no strangers to love" },
    { "start": 3.2, "text": "You know the rules\nand so do I" }
  ]
}
```

`language` is the track's language code. `generated` is `true` when YouTube's
speech recognition wrote the track rather than a person. `lines` is the text as
YouTube serves it, entities and line breaks included: the editor turns it into
prose when it writes it into a note, under
[its transcript in the note](/reference/editor-keys.md#its-transcript-in-the-note).

A track written by a person in English is taken first, then YouTube's generated
English, then the first track the video has in any language. Any region counts
as English, `en-GB` as much as `en`.

The id must match `[A-Za-z0-9_-]{11}`, the alphabet YouTube writes ids in, and
anything else is a `422` before YouTube is asked. That check is what keeps the
route from being turned into a fetch of an address someone chose. The captions
are read with [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api),
which is synchronous, so the request runs on a worker thread and leaves the
event loop free.

Two refusals, each with one sentence in `detail`:

* `404` when the video has no transcript, has them turned off, is not
  available, or is age-restricted or unplayable
* `502` when YouTube refuses the request, which is what it does to an address
  it takes for a bot, or the request to YouTube fails

## GET /api/weather

The weather on one day, hour by hour, for each town in
[`KASTEN_WEATHER_PLACES`](/reference/configuration.md#kasten_weather_places).
Takes one query parameter, `date`, as `YYYY-MM-DD`. The daily note draws it
under its title; see [the weather card](/reference/editor-keys.md#the-weather-card).

```json
[
  {
    "place": "Gelnhausen",
    "sunrise": "07:32",
    "sunset": "18:48",
    "hours": [
      { "time": "00:00", "temperature": 12.5, "rain_chance": 0, "rain": 0.0, "code": 0 }
    ]
  }
]
```

Times are local to the town. `rain_chance` is a percentage, `rain` is
millimetres in the hour, and `code` is the
[WMO weather code](https://open-meteo.com/en/docs#weather_variable_documentation).
An hour Open-Meteo has no temperature for is left out, so a day can hold fewer
than 24.

The answer comes from the [Open-Meteo](https://open-meteo.com) forecast API,
which needs no key. The browser cannot ask it directly, because the app's
`connect-src 'self'` refuses every other origin. Only the date and the towns'
coordinates leave the machine. The backend keeps a day's answer for 30 minutes.

| Status | When |
| --- | --- |
| `404` | the day is more than 92 days back or 15 days ahead, which Open-Meteo's forecast does not reach |
| `502` | Open-Meteo did not answer, or answered with an error |

An empty `KASTEN_WEATHER_PLACES` answers `[]` and asks nobody.

## GET /api/search

Finds every line in the vault holding `q`, ignoring case. Takes `q` and an
optional `archive`, and answers with at most 2,000 matches.

```json
[{ "path": "projects/kasten.md", "line": 4, "text": "Postgres holds a derived index." }]
```

Nothing is indexed and Postgres is not consulted. `rg` reads the notes on every
query, which over a 10,000 note vault costs about 17ms and cannot go stale,
because the files it reads are the source of truth themselves.

The match is literal. `q` is not a regex, so `index.` finds the end of a
sentence rather than any five letters followed by one more, and a half-typed
`[[like` is a query instead of an error. It is not a fuzzy match either: a
query read as a subsequence finds most of a vault whatever you type, which is
measurably useless over prose. Ranking the answer is the client's job, and
[The note search](/reference/editor-keys.md#the-note-search) is where that
happens.

Search sees exactly what `GET /api/files` lists, and this is the property to
keep. Markdown only, hidden files and directories skipped, and a `.gitignore`
inside the vault deliberately ignored, because git being told to overlook a
file says nothing about whether the note exists. A vault directory that does
not exist reads as an empty one.

A blank or whitespace-only `q` answers with nothing rather than everything. An
empty literal matches every line there is, which would make the query nobody
has finished typing the most expensive one the vault can answer.

`archive` defaults to false, which walks past the folder
[KASTEN_ARCHIVE_PATH](/reference/configuration.md#kasten_archive_path) names.
This matters more than it looks next to the cap below: an archive that grows
without bound would eventually push live notes out of the answer rather than
merely lengthening it. `archive=true` walks it.

The cap of 2,000 is about what crosses the wire, not what the machine can do:
`rg` reads the whole vault in about the same time whatever the cap. Because the
client ranks everything it is handed and cuts afterwards, the rows on screen
are the best of the match set rather than the head of it, and 2,000 is the
whole match set for anything but the most common word in a vault.

## GET /api/mentions

Finds the unlinked mentions of one note: every place another note names it in
plain text without linking to it. Takes `path`, the note's vault path, and an
optional `archive`, and answers with at most 1,000 mentions, sorted by path,
then line, then place on the line. A note that does not exist is a `404`.

```json
[{ "path": "journal.md", "line": 3, "text": "Read Borges today.", "start": 5, "end": 11, "name": "Borges" }]
```

The names are the note's title, its file name without `.md`, and each of its
[aliases](/reference/note-frontmatter.md#every-other-field-is-yours). `name`
says which one matched, spelled as the note spells it. A match ignores case and
counts only whole: no letter or digit may touch it on either side,
so `borges` finds `Borges,` and not `borgesian`, and `C++` and `2026-W32` still
match.

A name inside a `[[wikilink]]` or `![[embed]]`, inside a markdown link (its
text or its address), inside code (fenced or inline) or inside the block at the
top of a note is not a mention, because a link does not go there. The note
itself is never listed. Two mentions on one line are two entries.

A `#tag` holding a name and an address written out bare, `https://x.org/borges`,
are skipped too, since a link inside either would break it. An underscore does
not join a word, so `_Borges_` is a mention.

`text` is the whole line as `GET /api/files/{path}` serves the note, where a
`\r\n` ends a line as `\n` does, so it matches that line of what the client
read. `start` and `end` count UTF-16 code units into it, which is how the
browser slices a string, so `text.slice(start, end)` is the mention as written.

`rg` picks the notes holding any of the names, and the backend then reads those
to find where. `archive` works as it does on a search. The cap is the list the
pane shows: nothing ranks it afterwards, and a title like `Week` can be named
on most lines of a large vault.

## GET /api/history

Lists the jj changes that touched one note, newest first. Takes `path`, the
note's vault path, which need not exist now. A path the vault would not take
is a `404`.

```json
{ "versioned": true, "changes": [{ "commit": "3c7719c83cbe41108baa7c74f7ba464c69df1d02", "change": "kvlnznonukvs", "time": "2026-10-17T17:40:13+02:00", "description": "vault: reading/borges.md", "path": "reading/borges.md" }] }
```

`commit` is the 40-digit commit id, `change` the short change id `jj log`
shows, `time` the committer timestamp with its offset, and `description` the
first line of the change's description.

The list follows the note through moves. Where a change renamed it from another
path, the older changes are those that touched that path, and `path` says
where the note was in each. Only a rename jj itself records counts, which
it finds when the text stayed similar, as a kasten move keeps it. A note added
while another was removed is not followed. A rename out of `.trash`, which a restore is, is
not followed. The walk stops after 20 renames.

The working-copy change is listed like any other, as of the last snapshot,
which every save takes. No call here snapshots or writes to the repo: each
passes `--ignore-working-copy`.

A vault that is not a jj repo, or a box with no jj, answers
`{ "versioned": false, "changes": [] }`. A jj that fails or runs over ten
seconds is a `503`.

## GET /api/history/version

Reads one note's full text at one change. Takes `path`, the path that change
lists, and `commit`, its commit id.

```json
{ "content": "# Borges\n" }
```

A `commit` that is not 40 lowercase hex digits is a `422`. A commit jj does
not know, or a note that is not at that path in it, is a `404`, and so is a
path the vault would not take. A jj that fails or runs too long is a `503`.

## GET /api/tags

Lists every tag written anywhere in the vault, once each, sorted.

```json
["#databases", "#dbt", "#flashcards/databases"]
```

A tag is what the [tag rule](/reference/tag-format.md) calls one, the rule the
editor, the todo board and the graph read by too. So `#!/bin/sh`, `#1984` and
`note#2` are no tags, and nor is a hash inside a code span, a fenced code block,
a `[[wikilink]]` or a `[text](url)`. The same tag written outside those anywhere
is still offered.

Two `rg` passes carry the same flags search carries. One matches every span and
every hash that could open a tag, and each match is read as the todo board reads
a line. The other names the notes holding three backticks or tildes, and the
backend reads each of those whole, since only the whole note says where a fenced
block opens and closes. Only the tags come back, never the lines
holding them. Which note holds a tag is a search, and this answers what the
editor completes an open `#` from.

It takes no `archive`, unlike the scans below. What is filed away is out of a
search because it is not what is being looked for; a tag is a word you are
trying to spell the way you spelled it last time, and archiving the note that
taught you the spelling does not unteach it.

## GET /api/graph

Answers with the notes as a graph: every note a node, every link between two an
edge. Takes an optional `q`, `around`, `depth` and `archive`.

```json
{
  "nodes": [
    { "path": "ideas/rag.md", "name": "rag", "type": "Concept", "tags": ["#ai"], "missing": false },
    { "path": "Ghost.md", "name": "Ghost", "type": null, "tags": [], "missing": true }
  ],
  "edges": [
    { "source": "ideas/rag.md", "target": "Ghost.md", "relation": "depends-on", "line": 7 }
  ],
  "columns": [],
  "rows": [],
  "truncated": false
}
```

`q` is a filter or a pattern in the language [Graph query](/reference/graph-query.md)
states, read here and nowhere else. The graph pane sends it as typed. A filter
answers with empty `columns` and `rows`; a pattern fills them, and the nodes and
edges are what its rows matched.

`relation` is the typed relation's name, or null for a plain link. `line` is the
first line of the source note the edge is written on. `type` is the note's
frontmatter `type`, or null. `missing` marks a note a link names and nobody has
written.

`around` names a note, resolved the way a link is, and keeps only what is within
`depth` edges of it, either way along an edge. `depth` runs from 0 to 5 and is 1
when not given. It is the local graph.

Nothing is indexed. Two `rg` passes read the lines holding `[[` and the
frontmatter fences with the `type` between them, with the flags search carries,
so the graph sees exactly the notes `GET /api/files` lists. A node's tags are
read the way `GET /api/tags` reads them, by the
[tag rule](/reference/tag-format.md). The prod vault, 312 notes and 1,181
edges, answers in about 50ms.

`archive` defaults to false for the reason it does on a search. A link from a
live note to an archived one is then dropped rather than drawn as a note nobody
wrote.

A query it cannot read is a `400` whose `detail` says why, and so is an
`around` naming a note not in the graph.

## GET /api/cards

Finds every line in the vault that could be part of a flashcard. Takes an
optional `archive` and answers with at most 100,000 matches, in the shape
`GET /api/search` returns.

```json
[{ "path": "03 Flashcards/aws.md", "line": 5, "text": "What does S3 stand for?::Simple Storage Service" }]
```

One `rg` pass, carrying the same flags search carries. Nothing is indexed and
Postgres is not consulted, for the reason search does not consult it.

It matches six shapes:

* a line holding `::`, or a line that is exactly `?`, which are
  [the two ways a card is written](/reference/flashcard-format.md#the-two-ways-to-write-a-card)
* a line holding `<!--SR:!`, which is a card's schedule, or `<!--SR:c1!`, which
  is a cloze number's
* a line opening a fenced code block, which is how the client tells a card from a
  `std::vector`
* a line opening `!suspended`, which is
  [the token parking a card](/reference/flashcard-format.md#parking-a-card)
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

The fence branch is what a tagged note needs instead. A `std::vector` inside a
code block in a note that is a deck would be counted as a card, the lines around
it matching nothing that reaches the client, so the markers come over and the
client skips what sits between them.

The cap is 100,000 rather than search's 2,000, for the reason `GET /api/todos`
carries that number: a backstop against one generated file, not a limit on how
many cards a person can own. An imported Anki deck is a real four-figure case.

`archive` walks the archive folder too, and is off by default. That is the whole
of [filing a deck away](/reference/flashcard-format.md#filing-one-away): moving
the note into the archive takes it out of the review and changes nothing else.

A vault directory that does not exist reads as an empty one.

## GET /api/review/limits

Names the daily limits a deck falls back on where
[`decks.md`](/reference/flashcard-format.md#daily-limits) sets none, read off
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
[parked question](/reference/flashcard-format.md#parking-a-card), and a card
whose question is empty once flattened is left out. A question holding `::` is
written over three lines, question, `?` and answer, so the first `::` does not
cut it short, and is left out when its answer is empty or `?`, or when either
side is a heading, a line of only tags or a line opening with `!suspended`, or
its answer holds a whole schedule comment, any of which would end the card.
A question ending in `:` is written `question ::answer`, so the colon stays on
the question, and a side that would open its line with three backticks gets a
backslash in front, so it opens no code block.
`cards` counts the cards the notes hold, not those Anki made. A cloze note gives
one [cloze](/reference/flashcard-format.md#as-a-cloze) line, its marks and hints
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
and the 100MB cap. A name that is not one plain file name (empty, hidden, holding
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
* A media file whose path is already taken answers 409 the same way for a deck
  imported the first time. A deck merged into its note keeps the file it finds
  and does not count it.
* With `carry`, a collection whose `col` row holds no creation time answers 400.
* A body over 100MB answers 413.
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
* A deck over 100MB answers 413 `That deck is too big`. The bytes are counted
  as they arrive and reading stops at the cap, whatever `content-length` says.
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

## GET /api/todos

Finds every line in the vault that could be a todo. Takes an optional
`archive` and answers with at most 100,000 matches, in the shape
`GET /api/search` returns plus a `project` on each.

```json
[{ "path": "02 Projects/kasten/plan.md", "line": 12, "text": "- [/] wire up the pane 📅 2026-08-14 ⏫", "project": "02 Projects/kasten" }]
```

One `rg` pass, carrying the same flags search carries, so this and
`GET /api/files` cannot disagree about which notes the vault holds. Nothing is
indexed and Postgres is not consulted, for the reason search does not consult
it: the files are the source of truth.

It matches two shapes and nothing else:

* a checkbox list item at any indent, in any of
  [the seven states](/reference/todo-format.md#the-seven-states): `- [ ]`,
  `- [/]`, `- [r]`, `- [x]`, `- [X]`, `- [b]`, `- [w]` or `- [-]`
* a running session line, `- 14:03- …`, with no end time on it

`[X]` is matched because another editor writes it that way, and `[R]` is not,
because nothing does. `[` is not one of
the state characters, which is what keeps `- [[borges]]` out, and the `- `
anchor is what keeps `1. [ ] ordered` out. The done log's `- ✅` line does not
match either, which is
[the whole reason it is not a checkbox](/reference/todo-format.md#the-done-log).

A closed session line, `- 09:12-10:32 …`, is deliberately not matched. The pane's
`t` writes both spellings into the
[time log](/reference/todo-format.md#the-time-log), and a running one comes back
in the same pass as the todos because the view wants to know what is going. A
closed one says nothing the task line does not already carry, the total being on
it, and the closed ones are the half of that log that piles up. A stop reads them
through `GET /api/search` on the todo's id instead, which is one narrow pass at
the press rather than a growing answer on every fetch.

The endpoint serves no todo's state or fields. It hands the lines over whole,
because the editor has to parse a line anyway and two parsers in two languages
drift. Whether one of them is open or overdue is read on the client, off the
same module the editor draws a todo with. That is also how the client tells a
session line from a todo, which is why one endpoint can answer both. The one
thing the backend works out is `project`, below, and to find the words it reads
a project from, it takes the fields off a line the way the editor does.

### The project

`project` is the project folder a todo belongs to, as a path from the vault
root, `"02 Projects/FDE"`, or `null` for none. The board draws its lanes by it,
and an agent reading this endpoint sees the same lanes. The first of these that
answers wins:

1. A `#p/x` tag on the todo, else on the nearest todo above it that it is a part
   of and that carries one.
2. The note's project folder: a folder directly under `02 Projects` or
   `03 Areas`, with the note at any depth inside it. A note directly in one of
   those two, or outside them, has none.
3. The first `[[link]]` on the line that lands on a note that exists, in a
   folder under `02 Projects`. Areas do not count here.
4. The project of the todo it is a part of, by this same rule.
5. `null`.

Tags and links are read off the todo's words, as the editor parses them: a
link inside a field's value, such as `👤 2026-10-01 [[Vendor]]` or
`🔁 every week [[Vendor]]`, files nothing.

A part is a todo indented under another: its parent is the nearest todo above
it in the same note with a smaller indent, a tab counting as one, with prose in
between ending nothing. A session line is no todo, has `project: null` and is
nobody's parent, and so is a line the editor does not read as a todo, such as
one holding a lone `\r`, U+2028 or U+2029. Done, rejected and archived todos
follow the same rule.

How a tag names a folder:

* A tag is read as Obsidian reads one: a letter or `_`, then letters, digits,
  `_`, `/` and `-`, with no letter, digit, `_` or `/` straight before the `#`.
  So `#p/fde.` at the end of a sentence is `#p/fde`. Inside a `[[link]]` or a
  code span counts too, as it does for the board's own tags.
* `#p/` matches with case ignored, so `#P/FDE` counts.
* `#p/x/y` names `x`, and `#p/` alone names nothing.
* `x` names a folder directly under `02 Projects` that holds at least one note.
  Case is ignored, and a `-` or `_` on either side stands for a space:
  `#p/japan-honeymoon-2027` names `02 Projects/Japan Honeymoon 2027`.
* A tag that names no folder is passed over. Of two tags, the first, left to
  right, that names a folder wins.

A link lands when it resolves, by the rule `GET /api/files` and the editor
share, to a note in that listing, which holds the archive too.

The cap is 100,000 rather than search's 2,000, and the two numbers are doing
different jobs. Search guards a query that can match anything in the vault. This
one is a backstop against a single generated file with a million list items in
it, and nothing else: reaching it truncates the answer silently, which is why it
sits where nothing written by hand reaches it.

`rg` matches a line rather than a parse tree, so a `- [ ]` inside a fenced code
block in a note about markdown comes back as a hit. The client cannot tell from
the line alone either, and it costs a wrong row in the todo pane. Dropping it
would mean reading every note that matched.

A vault directory that does not exist reads as an empty one, so a fresh
checkout still serves.

## GET /api/events

Reports every change to the vault as server-sent events, one `data:` line per
change. The response stays open until the client goes away.

```
retry: 30000

data: {"path": "daily/2026-08-05.md", "change": "written", "digest": "3fda1d2d4bdf392f4939d3d3d02a091bf16144d45b4cf691ae4c2f7662f14674"}
```

Each event names a path, what happened to it, and a digest of what is on disk
now. There are three kinds:

* `written`: the note is on disk, and `digest` is the sha256 of its bytes.
* `removed`: the note is gone, and `digest` is `null`.
* `listing`: the shape of the vault moved. `path` is empty, `digest` is `null`,
  and the client rereads `GET /api/files`.

`listing` is how a folder move arrives. `PATCH /api/folders/{path}` is a single
rename, so the kernel names the directory and stops: no note under it fires at
all, and without this the client would keep drawing rows for notes that had
moved. One per batch whatever moved, because there is one file list to reread.

There is no kind for a note that is new. A write renames a temp file over the
note, Linux reports that as a move into place, and a note kasten has held for
weeks would announce itself as new on every save. Whether a note is new is a
question about the file list the client already holds, so the client answers it
there.

Nothing under a dot-directory is ever reported, which is the rule
`GET /api/files` lists by. That is what keeps the vault's own jj repo off the
stream: every write the backend makes touches `.jj`, and a save that reported
its own bookkeeping would say more about the repo than about the note.

The stream carries no note text, only the path, the kind and the digest. A
client that wants the new content reads the note the way it always does. The
digest is what lets it tell its own write coming back from someone else's:
kasten's writes are reported like any other, and nothing here tries to know
which was which.

Two lines are not events. A `retry:` field goes out first, telling the browser
to wait 30 seconds before opening the stream again, and a comment line goes out
every 30 seconds so that a quiet connection does not read as a dead one to the
proxies in front of it. `EventSource` swallows both before any handler sees
them.

Changes are gathered over a 100ms window, so an agent rewriting forty notes
costs a handful of messages rather than forty. A vault directory that does not
exist reads as one nothing ever happens in, so a fresh checkout still serves.

The stream must not be compressed on the way out. A proxy that gzips it buffers
the whole response, and the client then holds a connection that never delivers
a byte and never errors either.
[Two environments](/explanation/environments.md#constraints-the-box-imposes)
gives the Caddy fix.

## GET /api/vault-assets

Lists every image, sound and book in the vault as a relative POSIX path, sorted.

```json
["00 Inbox/plan.pdf", "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png"]
```

The same walk `/api/images` makes, filtered on every suffix an upload takes:
`.epub`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.mp3`, `.m4a`,
`.ogg` and `.wav`, in any case. `/api/images` leaves the sounds out, so `![](`
completes pictures only. The editor reads it to draw `[[plan.pdf]]` as live when the vault holds the file,
and as dead when it does not.

Not `/api/assets`, whose `GET` with a path serves one file. A listing at the
same URL would make it mean two things.

## GET /api/assets/{path}

Reads one book, image or sound out of the vault and answers with the bytes.
`path` is a vault-relative POSIX path ending in one of eleven suffixes, in any case, so
`Plan.PDF` is served as a pdf. A slash inside it may be sent raw or
percent-encoded.

| Suffix | Answered with |
| --- | --- |
| `.epub` | `application/epub+zip` |
| `.pdf` | `application/pdf` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.webp` | `image/webp` |
| `.mp3` | `audio/mpeg` |
| `.m4a` | `audio/mp4` |
| `.ogg` | `audio/ogg` |
| `.wav` | `audio/x-wav` |

The reply is the file, and the content type comes off the suffix. Nothing here
opens what it sends: this resolves a path, checks the suffix and streams a file,
so a `.epub` holding anything at all is served unchanged and the reader in the
browser is what decides whether it is a book. `Range` comes free with the file
response and nothing uses it, the client asking for the whole file once.

Anything that is not a readable file of one of those suffixes inside the vault
is a `404`, on the same rules the note read follows: a path that climbs out with
`..` or an absolute one, a symlink pointing outside, a hidden segment, a `.md`
path, a directory whose name ends in `.epub`, and a file that is not there. A
suffix the table does not hold is a `404` too, `.svg` among them: an SVG is
markup a browser runs, and the way to keep one out of a page is to keep it out
of the vault.

## POST /api/assets/{path}

Puts one book, image or sound into the vault at `path`, and never over one
already there. `path` follows the same rules the read above follows, the eleven
suffixes included.

The body is the file itself, raw. Not multipart: one file and no fields, so
nothing has to parse a boundary at either end. No response body comes back,
only the status, because the client already knows the path it sent to.

The endpoint takes any legal path and decides nothing about where a book or an
image belongs. On the default layout, `<leader>cb` sends
`00 Inbox/02 Books/<the file's own name>.epub` and writes the note beside it
afterwards; a pasted image goes to
`99 Misc/02 Assets/01 Images/<today>-<eight hex digits>.png`. Both are choices
made in the client and not rules of this endpoint.

| Status | Means |
| --- | --- |
| `201` | The file is at that path |
| `400` | `The vault will not take that path`, or `That file is not what its name says` |
| `409` | `Something is already there` |
| `413` | `That book is too big` |

There is no overwrite. A path already holding a file is a `409`, and what is on
disk is untouched; the way to replace it is the shell pane, or for an image the
delete below and a second upload.
That refusal is decided by the filesystem rather than by a check in front of
the transfer: the bytes land in a hidden temp file beside the target and are
hard linked into place, so a path is taken by whichever request gets the link,
not by whichever asked first.

The cap is 100MiB for either kind, counted off the bytes as they arrive rather
than read off `content-length`. One cap because the cap is about what a request
may cost and not about what a format usually weighs. In production Cloudflare
sits in front of everything with a body limit of its own near that number, so a
real oversize upload is usually refused by Cloudflare's own page before kasten
sees it. The `413` is a backstop for dev, for the LAN and for a client that did
not check its file first.

The bytes must start the way the suffix says they will: `PK\x03\x04` for a
`.epub`, which is what a zip starts with, `%PDF-` for a `.pdf`, and the matching
magic for each of the five image formats. A sound has more than one way to
start: an `.mp3` opens with `ID3` or an MPEG frame header, an `.m4a` with `ftyp`
behind the four bytes of its box size, an `.ogg` with `OggS`. `.webp` and `.wav`
are checked on their `RIFF` alone, four bytes they share with each other and
with avi, a short check per suffix being worth more here than the exactness.
**This is a usability check and not a security one.** The shell pane
drops a file straight into the vault without coming near this endpoint, so
nothing downstream can rely on it having run. It earns its place because there
is no delete: a PDF renamed `.epub` and sent by mistake would squat on the
sidecar path until you open a terminal.

Every refusal leaves the path as it found it. Where the path was free it stays
free, with no temp beside it, and the next upload to it succeeds. That holds for
a client that hangs up mid-body too. Where the path was taken, what was already
there is untouched.

Nothing here writes history. Books are ignored by jj, so a change bracketing
this would be empty, and [The file beside a note](/explanation/books-in-the-vault.md)
covers why. Images are not ignored: they are part of what a note says, and the
next save's snapshot sweeps in any untracked file under a megabyte, which most
screenshots are.

## DELETE /api/assets/{path}

Takes one image or sound out of the vault and holds it in the trash, answering
with the entry it became.

```json
{
  "entry": "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png@2026-08-12T16-18-41.995729",
  "path": "99 Misc/02 Assets/01 Images/2026-08-12-a1b2c3d4.png",
  "deleted": "2026-08-12T16:18:41.995729Z"
}
```

The note delete's route read for an image, down to the entry: the trash names an
entry after where it came from, so an image sits in there beside the notes, and
[the restore](#patch-apitrashentry) puts it back with no rule of its own. The
folder the image emptied goes with it, the way a note's delete takes the one it
emptied.

Images alone. A book is a `404` like any other path this does not serve,
whichever of the two suffixes it ends in: a book travels with the note beside it, and which of the pair a delete should take
is a decision nothing here has made. The file tree, which is what this route
serves, lists images and no books.

| Status | Means |
| --- | --- |
| `200` | The image is in the trash, and the body says where it came from |
| `404` | No image at that path, a book, a `.md` and a directory included |

The notes referencing the image are left alone, for the reason a delete leaves
`[[link]]`s alone: rewriting them to say the picture is gone would be the one
edit a restore could not take back. The editor draws a reference to a file that
is not there as a picture that will not load.

## GET /api/books/{path}

Reads the book filed beside one note and answers with the bytes. `path` is the
**note's** path, `20 Literature/DDIA.md`, and never the book's.

The pair is a convention rather than a record, a book being its note's path with
the suffix swapped, so the vault is the only thing that can resolve it. A client
working from the note alone would have to ask for one suffix, read the `404` and
ask for the next, which is a request per format and a guess about the order they
should be tried in. Here it is one question.

`.epub` first and `.pdf` second, so a note with both beside it is answered with
the epub, which is the one that reflows. Which of the two came back is in a
header rather than in the body, the body being the book:

| Header | Carries |
| --- | --- |
| `X-Book-Path` | The vault-relative path of the file that came back, percent-encoded |

The encoding is not optional to reverse. A header goes down the wire as latin-1,
so `Grundzüge.pdf` arrives as `Grundz%C3%BCge.pdf` and the client is what puts
the name back together, `decodeURIComponent` being the whole of it.

| Status | Means |
| --- | --- |
| `200` | The bytes, with `X-Book-Path` naming which of the pair they are |
| `404` | `No book beside that note` |

The `404` covers a note with neither format beside it, a note that is not there
at all, and every path the vault refuses: one that climbs out with `..`, an
absolute one, a symlink pointing outside, a hidden segment. Nothing here asks
whether the note exists, because the book is what was asked for and a stem with
no book beside it answers the same either way.

[The file beside a note](/explanation/books-in-the-vault.md) is why the path is not
stored anywhere.

## GET /api/files/{path}

Reads one note. `path` is a vault-relative POSIX path, exactly as it appears in
the list above. A slash inside it may be sent raw or percent-encoded.

```json
{ "path": "daily/2026-08-05.md", "content": "# 2026-08-05\n" }
```

`content` is the file's text, the
[frontmatter block](/reference/note-frontmatter.md) included, with every CRLF
read as an LF.

Anything that is not a readable markdown file inside the vault is a `404`:

* a note that is not there
* a path that climbs out of the vault with `..`, or an absolute path
* a symlink whose target sits outside the vault
* a file that is not `.md`, a directory, or a hidden file

Every refusal reads the same, because telling a typo apart from an attempt to
climb out is worth nothing to the one user and something to everyone else.

## PUT /api/files/{path}

Writes one note back to the vault. The body carries the new text, the URL
carries the path:

```json
{ "content": "# 2026-08-05\n\nEdited.\n" }
```

The reply is the same shape `GET` returns, so the client can see what landed:

```json
{ "path": "daily/2026-08-05.md", "content": "# 2026-08-05\n\nEdited.\n" }
```

The text is stamped on the way through: the note's `modified` date is set to
now, and a note without a
[frontmatter block](/reference/note-frontmatter.md) gains one. Nothing below the
block is touched, because the vault is the source of truth. What comes back is
what landed on disk rather than what arrived, and it is the only copy to
believe: the client's own is a save behind from the moment it sends it.

Only a note that is already there can be written. Everything the read refuses
is refused here for the same reasons, and a note that does not exist is a `404`
as well: a path with no file behind it is not created. Making one is the `POST`
below.

The write goes to a hidden temp file beside the target and is then renamed over
it. The rename is atomic, so a crash halfway through leaves the old note whole
rather than half a new one.

A note that holds a CRLF on disk keeps CRLF: the client was served LF, so every
LF in what it sends lands as a CRLF, the restamped `modified:` line included.
The reply and the `base` stay on the LF text the client saw. A note with only
LF on disk is written as sent.

A body may also carry `base`, the hex SHA-256 of the text the client believes
is on disk, with the frontmatter's `modified:` line set aside:

```json
{ "content": "# 2026-08-05\n\nEdited.\n", "base": "9f86d081…" }
```

When the note on disk, its `modified:` line set aside the same way, no longer
hashes to `base`, the write is refused with `409` and `Changed on disk`, and
the note stays as it was. `modified` is set aside because every `PUT` restamps
it, so a client still waiting on its last answer can name the text it sent as
the base of the next. The editor's autosave sends a base, so a quiet write in
the air when somebody else wrote the note no longer lands over their text. A
body without `base` is written whatever is on disk, and the last write wins.

The base may also name the text before the server stamped it: the note on disk
with the `id:`, `created:` and `type:` lines the stamp wrote at the head of the
block set aside, or with the whole block set aside when it holds nothing else
but `modified:`. A page-hide keepalive typed behind a quiet write names the text
that write sent, and the stamp it landed with is no other writer's change. The
body and every block line the stamp did not write must match exactly, or the
answer is `409`.

A stale `base` is not refused when the disk already holds the text being sent,
`modified` again set aside: the answer is `200` with the note as it stands, and
nothing is written. A page-hide keepalive and the quiet write it repeats can
land in either order, and the second one is no conflict.

What a note edited by hand or by `git pull` costs is settled a layer up, over
[the change stream](#get-apievents). The browser is told when the vault changes
under it: a note nobody is typing into takes the new text, and a note holding
unsaved edits stops autosaving and says `Changed on disk` rather than writing
over what landed. A client that does not read the stream overwrites the way it
always did, and the history below is what gets the old text back either way.

### What the write records

If the vault is a jj repo, the write is bracketed by two jj commands: a change
is started before it and a snapshot taken after. Changes are one per note, not
one per save, and named `vault: <path>`, so `jj log` reads as the list of notes
you worked on while `jj op log` still holds every individual save.

A body may carry `restored_from`, the short id of the change whose text it
restores, in jj's change-id letters `k` to `z`, or the answer is `422`. The
change is then named `vault: <path> (restored from <id>)`, so the restore gets
a change of its own and the text it replaced stays in the change before it.

A vault that is not a jj repo is written to just the same and no history is
kept. jj failing, or missing from the box, never fails a save: the note matters
more than the record of it. See
[Recover an earlier version of a note](/how-to/recover-an-earlier-version.md).

## POST /api/files/{path}

Starts a new note. The URL carries the path. The body is optional and carries
the note's text, in the shape `PUT` takes:

```json
{ "content": "\n# 2026-08-09 Sunday\n" }
```

The reply is the note the vault wrote:

```json
{
  "path": "reading/borges.md",
  "content": "---\nid: 019fd761-258e-75da-b109-7bb369317960\ncreated: 2026-08-06T14:01:35+00:00\nmodified: 2026-08-06T14:01:35+00:00\n---\n"
}
```

The status is `201` and the shape is the one `GET` returns, so the client can
open what it just made.

The note always holds its [frontmatter block](/reference/note-frontmatter.md),
so it has an id from the moment it exists. Sent text goes under that block and
is stamped on the way through the way a save's text is, so a body carrying a
block of its own keeps the fields in it.

Send no body and the note is the block and nothing else. That is what a note
made from the prompt or by following a `[[link]]` gets: the file name is the
note's title in a vault with wikilinks, so a `# Borges` heading would say it
twice, and anything else would be a word in the vault the user did not type.

The body exists for the client that already knows the text. The five periodic
keys do, and without it they had to save straight over the note they had just
made. That second write is a second event on `/api/events` a moment after the
note opens, and typing into the note before it arrives makes the reader's own
keystrokes look like another writer: the editor stops autosaving and reads
`Changed on disk`, cleared with `:w`.

`path` in the reply is the vault's spelling, not the URL's, which is the one
place this differs from `PUT`. `ideas/./kasten.md` comes back as
`ideas/kasten.md`. The client navigates to what it gets back, and two spellings
of one note must not end up in the address bar.

The folders on the way are made, the vault directory included, so a note names
its folders into being and a fresh checkout takes its first note with no
`mkdir` first.

Each folder made here gets an `index.md` as it is made, listing what it holds:
the folder's name as a `#` heading, then a bullet per thing in it, folders
first with a trailing slash, notes without their `.md`, any other file by its
full name, and hidden files, `index.md` and `log.md` left out. No bullet has a
description, because only a person can write one. A folder that was already
there keeps whatever it had, an index or none, and its index does not gain the
new note.

The outermost folder made is added to the index of the folder above it, as
`* [name](name/)` at the end, but only when that index already reads as a
listing, holding a bullet with a markdown link. An index written as prose, or
with wikilinks alone, is left as it is. The folders an image upload or a
restore from the trash makes get no index.
[Moving a note](/explanation/moving-notes.md#why-a-folder-kasten-makes-gets-an-index)
says why.

### What a create refuses

It answers `409` or `400` where the read and the write answer `404` to
everything:

* `409` when a note is already at that path. Its text is left alone.
* `400` when the vault will not take the path at all: a climb out with `..`, an
  absolute path, a symlink whose target sits outside the vault or one that
  loops back on itself, a suffix that is not `.md`, a hidden name, an embedded
  null byte, an ancestor that is a file rather than a folder, or a path segment
  over 255 bytes.

The user is about to retype the path and has to know which of the two it was.
The two answers separate "a note is already there" from "the vault will not
have that path" and no more: every entry in the `400` list reads the same, so a
typo still cannot be told from an attempt to climb out. All the `409` adds is
that one note exists, which `GET /api/files` hands the same reader anyway.

Both refusals return before anything is written, so a create that bounced
leaves no folder and no jj change behind.

A create that lands is recorded the way a save is, a change started before it
and a snapshot after, so a new note arrives as its own `vault: <path>` change.
A vault that is not a jj repo takes the note just the same and keeps no
history.

## POST /api/dump

Adds one paragraph to the `## Dump` section of a day's daily note. The body
carries the text and the day:

```json
{ "text": "answer Jonas about the flat", "date": "2026-09-29" }
```

`date` is the sender's own date, `YYYY-MM-DD`, never the server's. The server's
clock may keep another timezone, and a thought typed at half past midnight
belongs to the day the person typing it is in. The note is
`00 Daily/<date>.md` in the periodic folder, `01 Periodic` unless
[`KASTEN_PERIODIC_PATH`](/reference/configuration.md#the-vaults-folders) names
another.

The body may also carry an `id`, a UUID the client mints when the thought is
typed and sends again with every retry. The server writes each id once: a post
with an id it has already written adds nothing and answers `200` with the note
as it is now, so a phone that resends a queued capture after a lost answer
leaves one paragraph, not two. The server keeps the last 1000 ids in
`dump-receipts.json` beside the token store
([`KASTEN_TOKENS_PATH`](/reference/configuration.md#kasten_tokens_path)), outside the vault and
the database. A post without an id is written every time. `POST /agent/dump`
takes no `id`.

The reply is the note as it landed, in the shape `GET /api/files/{path}`
returns, and the status is `200` whether the note was made or was already
there:

```json
{ "path": "01 Periodic/00 Daily/2026-09-29.md", "content": "---\nid: …" }
```

Where the text goes:

* No daily note for that day: it is made exactly as
  [`<leader>gd`](/reference/editor-keys.md#periodic-notes) makes it, heading,
  line of links and `## TODOs`, and a `## Dump` section is added at its end.
* A daily note with no `## Dump`: the section is added at the end of the note.
* A `## Dump` already there: the text goes at the end of that section, which is
  before the next `#` or `##` heading, or at the end of the note when none
  follows. A `###` inside the dump is part of the dump. The blank line in front
  of the next heading stays where it is.

Each capture is a paragraph of its own, a blank line apart from the one before
it, because the dump is prose rather than a list. The first sits straight under
the heading. The text is trimmed and otherwise kept as written, line breaks
included.

The note is stamped on the way through the way a save is, so a note that was
made gains its [frontmatter block](/reference/note-frontmatter.md) and one that
was there gets a fresh `modified`. The write is recorded as a `vault: <path>`
change, the way a save's is, and an editor holding the note hears about it on
[the change stream](#get-apievents) like any other change on disk.

The read and the write happen under one hold of the vault's write lock, which
is why this is a route rather than a read and a `PUT` from the client: a phone
and an editor autosaving the same note could otherwise interleave, and one of
the two paragraphs would vanish.

The daily template has two copies. `frontend/src/lib/periodic.ts` builds it for
the periodic keys and the todo prompt, and `backend/src/kasten_backend/periodic.py`
builds it here. Both suites read `frontend/tests/fixtures/daily-notes.json`, so
editing one copy and not the other fails a test.

### What a capture refuses

* `422` with `Nothing to capture` when the text is empty once trimmed.
* `422` when `date` is missing or is not a real day, `2026-02-30` included.
* `400` when the vault will not take the daily note's path, which only happens
  when something that is not a folder stands where `00 Daily` in the periodic
  folder should be.

`POST /agent/dump` in [the Agent API](/reference/agent-api.md#post-agentdump)
runs the same function behind a bearer token, so a thought from an agent lands
in the same place.

## PATCH /api/files/{path}

Gives a note a new path. The URL says where it lives now, the body where it
should live from here on.

```json
{ "path": "reading/2026/borges.md" }
```

The reply is the note at its new path, in the shape `GET` returns.

```json
{ "path": "reading/2026/borges.md", "content": "# Borges\n" }
```

The book beside the note goes with it, `20 Literature/DDIA.epub` following
`20 Literature/DDIA.md`, because the pair is a convention rather than a record
and a note that moved alone would stop having a book. Both formats travel, and
each is weighed on its own: one stays where it is when the new path already
holds a book of that name, the note moving anyway, because nothing here
overwrites a book. The reply says nothing either way, the client asking
[the books route](#get-apibookspath) about the path it moved the note to.

One route, not two: renaming a note and moving it between folders are the same
thing, a change to the path. `PATCH` rather than `/rename` because the path is
the note's identity, so `POST` starts a note, `PUT` replaces its text, and this
changes where it lives.

`path` in the reply is the vault's spelling of the body's, the way `POST`
answers. The client navigates to it.

`content` is read off disk after the move rather than carried over from the
client. The move does not need the read; the answer does. Both the URL and the
client's cache key change here, and filling the new one from disk is what stops
a note edited outside kasten arriving stale on the other side.

The folders on the way to the new path are made, the way a create makes them,
each with [its listing](#post-apifilespath).

### What a move does to the links

Every `[[link]]` in the vault that named the note is rewritten to name it at its
new path. A link keeps the spelling it had: one that spelled the path out gets
the new path, and one that named the note gets the new name. So a move between
folders leaves `[[borges]]` alone, because a bare name follows the note on its
own, and a change of name rewrites it. The note being moved is read like any
other, which carries its links to itself along with it.

The books that travel with the note are moved files too, and a link to one
follows the same way: `[[inbox/borges.pdf]]` becomes `[[reading/borges.pdf]]`,
and on a rename a bare `[[borges.pdf]]` becomes `[[kafka.pdf]]`. A markdown
link to it follows as well, `[the book](inbox/borges.pdf)` becoming
`[the book](reading/borges.pdf)`. A book held
back because its landing is taken keeps its links, since it is still where they
point.

A link inside code is left as written, because there it is an example of the
syntax and not a link. Code is a fenced block as a CommonMark parser reads it,
so a fence inside a blockquote or a list item counts, and a fence nobody closed
runs to the end of the quote, the item or the note that holds it; and an inline span, a run of backticks closed by a run of the same
length on the same line. A backtick after a backslash or inside a `[[link]]`
opens no span. Where the text could be read either way it counts as text, so a
real link is never left behind. A block indented by four spaces is not read as
code. Markdown links in code are left alone the same
way.

The rule a target is read by is the editor's, so what a rename follows is what
`gf` opens: a target with a slash is a path, a bare name is looked for anywhere
in the vault, and the note at the vault root wins a tie. A link the vault
already answers with another note is therefore left alone. Where nothing answers
the two part: the editor puts the note it is about to make in the inbox, and a
rename leaves the name where it stands, there being no note to follow. The rule is written
out twice, in `backend/src/kasten_backend/links.py` and in
`frontend/src/lib/wikilink.ts`, which is what the editor resolving a link
without asking the server costs. `backend/tests/link_paths.json` holds the cases
both test suites read, so the two copies cannot drift apart unnoticed.

The rewrite runs before the note is moved, because a bare name only names the
note while the note is still where the links were written to find it, and inside
the same jj change, so the rewritten links are part of the move rather than an
edit that happened to follow it.

Which notes get read is rg's answer, not the whole vault. Every link to a note
carries the note's name, a bare `[[borges]]` being the name and a path
`[[reading/borges]]` ending in it, so the name is a query no link to it can
escape. rg names the notes holding it and only those are read and reparsed. It
matches far more than it rewrites, every mention in prose included, which costs
nothing: the parse decides.

Relative markdown links follow too, in every note and not only the one moving.
A plain `[text](href)` is read from the folder of the file holding it, so two
things break one: its target moving, and the file holding it moving to another
folder. Either one rewrites it. A link between two files that moved together is
left alone, which is what keeps a moved folder's own `index.md` working. An
embed, `![alt](href)`, is read from the vault root, the way the editor draws
it, so only its target moving rewrites it, and a move of the note holding it
leaves it as written.

A plain link that changes is written the short way from the folder of the file
holding it, an embed as its new vault path, both keeping a trailing slash and a leading `./` where it had them, and
keeping a `#fragment` or `?query`. `%`, a space, `(`, `)`, `#` and `?` are
escaped as `%25`, `%20`, `%28`, `%29`, `%23` and `%3F`, and nothing else, so
`plan #2.pdf` is not cut at its `#` and an accented name reads as
itself in the raw file. A link that still lands where it did keeps its
spelling. Skipped: an href with a scheme, `https:` or `mailto:`, one starting
with `/`, `#` or `{`, and one that climbs out of the vault.

The name narrows the read for these too. A markdown link to a note holds its
name, raw, with its spaces escaped, or escaped the way the editor's encodeURI
writes it, so `Über` as `%C3%9Cber`, and rg is asked for all three, ignoring
case, so `%c3%9c` is found as well. The note moving
is read whatever it holds, because its own links break by its moving.

At 10,000 notes a move costs 29ms, against 315ms for the walk over every note it
replaced. 9ms of that is the directory listing, which resolving a bare name
needs and which `GET /api/files` pays on every page load anyway. A folder's move
costs 45ms, the difference being the notes it carries and their links to each
other.

Unlike search, an rg that cannot read the whole vault is an error here rather
than an empty answer, and the move fails with nothing written. A search that
came up short shows fewer rows; a rewrite that comes up short leaves a link
pointing at nothing.

### What a move does to the indexes

When the note moves to another folder and the old folder's `index.md` has an
entry for it, the entry goes with it. An entry is a bullet line holding a
markdown link to the note. The line is cut from the old index, description and
all, its link respelled from the new folder, and added at the end of the new
folder's `index.md`. A new folder with no index gets one made as
[a create makes it](#post-apifilespath), and the plain line that listing wrote
for the note is replaced by the one carried, so the note is listed once.

An old index that never listed the note adds nothing anywhere: an index is
curated, and an entry nobody wrote is not one to invent at the other end. A
note that stays in its folder, and an `index.md` or `log.md` that moves, carry
nothing. [Moving a note](/explanation/moving-notes.md#why-an-entry-moves-only-when-it-was-listed)
says why.

### What a move leaves behind

Nothing, where it can. The folders the note came out of are removed as far up
as they are empty, stopping at the vault root and at the first folder that
still holds anything, a hidden file included. Folders exist here only as the
prefix of a note, so a folder the move emptied is one nothing would ever show
again.

A folder holding its `index.md` and nothing else counts as empty, and the index
goes with it. Its text is in jj, in the change before the move. The entry for
each folder removed this way is taken out of the index of the folder above it,
where there is one.

### What a move refuses

* `404` when there is no note at the path in the URL. Everything `GET` and
  `PUT` refuse is refused here too, so a note you cannot open is a note you
  cannot move.
* `409` when a note is already at the new path. Both notes are left alone.
* `400` when the vault will not take the new path at all. The list is the one
  [a create refuses](#what-a-create-refuses).

The `409` and the `400` are named for the reason the create names them: the
user is about to retype the path.

Every refusal returns before anything is written, so a move that bounced leaves
no folder, no half-moved note and no jj change behind.

A move that lands is recorded the way a save is, a change started before it and
a snapshot after, named `vault: <new path>`. jj matches the content across the
move and records it as a rename rather than a delete and an add, so the note
stays reachable at the path it left.

## PATCH /api/folders/{path}

Gives a folder a new path, and every note under it a new path with it. The URL
says where it lives now, the body where it should live from here on.

```json
{ "path": "reading/2026" }
```

The reply is the folder, and only the folder:

```json
{ "path": "reading/2026" }
```

No content comes back. A folder is the prefix of the notes under it and holds
nothing of its own, so there is nothing else to answer with. The notes moved but
did not change, and the client works out where each one went by swapping the old
prefix for the new.

Its own route rather than the one above, because a folder is not a note.
`/api/files/inbox` cannot mean the folder on a `PATCH` and nothing at all on a
`GET`.

One rename does it, not a walk over the notes. A folder is a directory on disk,
so renaming it renames everything under it at once and there is no half-moved
subtree to find a way back from.

`path` in the reply is the vault's spelling of the body's, the way `POST`
answers.

The folders on the way to the new path are made, and the ones the move emptied
are taken away, both exactly as [a note's move](#what-a-move-leaves-behind) does
them. The folder's entry in its old parent's `index.md` moves to the new
parent's, by [the rule a note's entry](#what-a-move-does-to-the-indexes) moves
by. The folder's own `index.md` travels inside it. When its first line is
`# <old name>`, the heading becomes `# <new name>`; a heading written any other
way stays as it was.

### What a folder move refuses

* `404` when there is no folder at the path in the URL. A note at that path is a
  `404` too: `PATCH /api/files/{path}` is the one way to move a note, and
  answering here would be a second way with none of the note's rules. So is the
  vault root, which is not a folder the vault will move.
* `409` when anything is already at the new path, a folder or a note. Merging
  two folders is a different operation, with a different way of failing partway
  through, and this is not it.
* `400` when the vault will not take the new path at all. The list is the one
  [a create refuses](#what-a-create-refuses), minus the `.md` suffix, which a
  folder does not carry. A new path inside the folder being moved is a `400`
  as well: a folder cannot hold itself.

Every refusal returns before anything is written, so a move that bounced leaves
no folder, no half-moved subtree and no jj change behind.

Links follow, the way [a note's move](#what-a-move-does-to-the-links) makes them
follow, and by the same rules read over every note the folder carries at once. A
link that spelled the old folder out gets the new one, and a bare `[[borges]]`
is left alone, the note's name being unchanged. A page of HTML, an image and a
book in the folder move with it, and `[[reading/report.html]]`,
`![[reading/plan.pdf]]` and `[[reading/plan.pdf|Plan]]` follow the same way.

The folder is matched as a whole path segment, so moving `reading/` takes
`reading/borges.md` and leaves `readings.md` where it is. The subtree's own
links are rewritten with the rest: a `[[reading/kafka]]` inside
`reading/borges.md` becomes `[[archive/kafka]]` when the folder lands at
`archive/`.

Markdown links follow by [the note's rules](#what-a-move-does-to-the-links):
a link from outside into the folder is rewritten, a link from inside the folder
to outside it is rewritten, and a link between two files inside it is left
alone.

The folder's name is the rg query that picks the notes to read, raw, with its
spaces escaped, and escaped by encodeURI, so a link the editor wrote to
`Bücher/x.png` as `B%C3%BCcher/x.png` follows the folder too. A path into the folder runs through its name, so a link
that spelled the path out, wikilink or markdown, holds it. The notes inside the
folder are read whatever they hold.

A move that lands is recorded the way a save is, named `vault: <new path>/`.
The trailing slash is what tells it from the change a note's move leaves, which
would otherwise read the same. jj matches the content across each note, so the
change reads as the renames it is rather than one subtree deleted and another
added.

## GET /api/move-preview

Says which files a move would rewrite, and writes nothing. Both paths go in the
query:

```
GET /api/move-preview?source=reading/borges.md&target=reading/2026/borges.md
```

```json
{ "rewrites": ["reading/2026/index.md", "reading/index.md", "today.md"] }
```

`rewrites` is every file whose links the move would change, by the path it has
today, sorted. That is every note holding a link [the move](#what-a-move-does-to-the-links)
rewrites, plus the new folder's `index.md` when
[an entry will be carried](#what-a-move-does-to-the-indexes) there, which may
not exist yet. It leaves out the smaller writes that follow the move: a listing
for a folder the move makes, the line naming that folder in the index above it,
and a folder's index heading taking its new name.

`source` is a note or a folder, whichever the vault holds there, and the answer
is the one `PATCH /api/files/{path}` or `PATCH /api/folders/{path}` would act
on. A `GET` beside the two rather than a flag on them, because it changes
nothing and answers with something neither of them does. The file tree asks it
before a drop, so [the confirm](/reference/editor-keys.md#the-file-tree) can
list how far the move reaches.

It works out the plan the move itself writes, from the same function, so the
list and the move cannot disagree.

### What a preview refuses

* `404` when nothing is at `source`.
* `400` when the vault will not take `target`, by
  [the create's list](#what-a-create-refuses), or when a folder would land
  inside itself.

A target already taken is not refused here. The move will say so, and the
question here is only about links.

## DELETE /api/files/{path}

Takes one note out of the vault and holds it in the trash.

```json
{
  "entry": "00 Inbox/borges.md@2026-08-11T14-03-02.481337",
  "path": "00 Inbox/borges.md",
  "deleted": "2026-08-11T14:03:02Z"
}
```

`entry` is where the note now sits under `.trash`, and it is the name
[the restore](#patch-apitrashentry) takes. `path` is where it lived, which is
where a restore puts it back. `deleted` is the moment in the entry's own name.

A `DELETE` that keeps the note is not a contradiction. What these routes answer
about is what the vault holds, and the note stops being one of them the moment
it moves: nothing lists it, nothing searches it, and no path in a URL reaches
it, because every route refuses a hidden folder. Why it waits there rather than
going is [Deleting a note](/explanation/deleting-a-note.md).

The trash mirrors the vault. A note keeps its path and its leaf takes the moment
it went, so the name is the whole record: where it came from, when, and no way
to collide with a note deleted from the same path later.

The folders the note came out of go with it, exactly as
[a move](#what-a-move-leaves-behind) takes them, a folder left holding its
`index.md` alone included. Unlike a move, a delete leaves the entries in the
index above alone.

Links pointing at the note are left alone. A `[[link]]` names a note rather than
a place, the editor already draws one nothing answers to as missing, and
rewriting the vault to say a note is gone would be the one edit a restore could
not take back.

### What a delete refuses

* `404` when there is no note at the path in the URL. Everything `GET` and `PUT`
  refuse is refused here too, so a note you cannot open is a note you cannot
  delete.

A delete that lands is recorded the way a save is, named
`vault: .trash/<entry>`. The entry rather than the note, so a delete never
amends the change holding the edit before it and the text you last typed stays
reachable. jj matches the content across the move and records it as a rename.

## DELETE /api/folders/{path}

Takes one folder out of the vault, and every note under it with it.

```json
{
  "entry": "reading@2026-08-11T14-03-02.481337",
  "path": "reading",
  "deleted": "2026-08-11T14:03:02Z"
}
```

One entry, not one per note. The folder goes in one rename and comes back in
one, so what you get back is the folder you deleted rather than a list of notes
to put back yourself.

Its own route rather than the one above, for the reason
[the folder move](#patch-apifolderspath) has one.

### What a folder delete refuses

* `404` when there is no folder at the path in the URL. A note at that path is a
  `404` too, so the one way to delete a note stays the route above, and so is
  the vault root.

## GET /api/trash

Everything the trash is holding, newest first.

```json
[
  {
    "entry": "00 Inbox/borges.md@2026-08-11T14-03-02.481337",
    "path": "00 Inbox/borges.md",
    "deleted": "2026-08-11T14:03:02Z"
  }
]
```

Read off the names in `.trash` rather than out of a list somebody has to keep in
step with it. The name of an entry is the record, so a note moved out of the
trash by hand stops being on this list by the same act.

Newest first because the entry anyone wants back is usually the last one they
deleted, and `<leader>du` takes the first row without asking.

## PATCH /api/trash/{entry}

Puts one entry back where it was deleted from.

```json
{ "path": "00 Inbox/borges.md" }
```

`PATCH` and no body, for the reason [a move](#patch-apifilespath) is a `PATCH`:
this changes where something lives, and where it should live is already written
in the entry's own name.

The folders on the way back are made, the way a create makes them, because the
delete took the empty ones with it.

### What a restore refuses

* `404` when the trash has no such entry. A path that climbs out of the trash is
  a `404` too, the entry going through the same rule a note's path does.
* `409` when something has taken the path since. The entry is left in the trash.
* `400` when the vault will not take the path at all, which by then means
  something is standing where one of its folders has to go.

A restore that lands is recorded the way a save is, named `vault: <path>`.

## GET /api/tokens

Lists every [agent token](/reference/agent-api.md) the vault holds.

```json
[{ "name": "laptop", "created": "2026-08-18T09:00:00+00:00" }]
```

Never a digest and never a secret. Only the digest is kept at all, so there is
no way back to a secret from here even by mistake.

## POST /api/tokens

Mints one agent token and hands back the only copy of its secret.

```json
{ "name": "laptop" }
```

```json
{
  "name": "laptop",
  "created": "2026-08-18T09:00:00+00:00",
  "secret": "kasten_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

`201`, and the one moment the secret exists outside its holder. It is not
recoverable: the store keeps a SHA-256 digest and nothing else, so a lost secret
is replaced rather than found.

A name already taken is a `409`, the create's answer, because the user is about
to retype it and has to know which it was.

This route is under `/api/`, which means it inherits the login gate and carries
no authentication of its own. That does put minting inside the internal trust zone,
and [The agent boundary](/explanation/the-agent-boundary.md) says why that grants
the shell container nothing it does not already have.

## DELETE /api/tokens/{name}

Revokes one agent token, and answers `204`.

The next request carrying that token is refused. Nothing is held between
requests, so there is no window in which a revoked token still works.

A name the store has not got is a `404`.

## Related

* [Deleting a note](/explanation/deleting-a-note.md): why a delete keeps the note
* [Moving a note](/explanation/moving-notes.md): why a move rewrites links and carries index entries
* [Regenerate the API types](/how-to/regenerate-the-api-types.md): push a change here through to the frontend
* [Configuration](/reference/configuration.md): which directory `/api/files` reads
* [Agent API](/reference/agent-api.md): the routes a token reaches, and the ones it never does
* [Capture from your phone](/how-to/capture-from-your-phone.md): the page and the share sheet that post to `/api/dump`
