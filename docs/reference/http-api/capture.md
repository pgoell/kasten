---
type: Reference
title: "HTTP API: capture"
description: Routes that bring text into the vault from outside, through the dump, a web page, a YouTube transcript, an HTML page and the weather.
resource: backend/src/kasten_backend/routes/
tags: [api, backend, openapi]
status: stable
---

# HTTP API: capture

The routes that bring text into the vault from outside: the dump, a web page, a YouTube transcript, an HTML page and the weather.

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
[its transcript in the note](/reference/editor-keys/video-pane.md#its-transcript-in-the-note).

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
under its title; see [the weather card](/reference/editor-keys/finding.md#the-weather-card).

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
  [`<leader>gd`](/reference/editor-keys/finding.md#periodic-notes) makes it, heading,
  line of links and `## TODOs`, and a `## Dump` section is added at its end.
* A daily note with no `## Dump`: the section is added at the end of the note,
  unless the note ends inside a code fence nobody closed that holds `## Dump`.
  Then the text goes under that heading, so no second one appears.
* A `## Dump` already there: the text goes at the end of that section, which is
  before the next `#` or `##` heading outside a code fence, or at the end of the
  note when none follows. A `###` inside the dump is part of the dump. The blank
  line in front of the next heading stays where it is.

The heading is found the way the readers find it: the line reads exactly
`## Dump` once trailing spaces and tabs go, outside a fenced code block
(backtick or tilde) and below the frontmatter. A `## Dump` in a fence or the
frontmatter is skipped, so the text does not land where the readers never look.

Each capture is a paragraph of its own, a blank line apart from the one before
it, because the dump is prose rather than a list. The first sits straight under
the heading. The text is trimmed and otherwise kept as written, line breaks
included.

The note is stamped on the way through the way a save is, so a note that was
made gains its [frontmatter block](/reference/note-frontmatter.md) and one that
was there gets a fresh `modified`. The write is recorded as a `vault: <path>`
change, the way a save's is, and an editor holding the note hears about it on
[the change stream](/reference/http-api/system.md#get-apievents) like any other change on disk.

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

`POST /agent/dump` in [the Agent API](/reference/agent-api/routes.md#post-agentdump)
runs the same function behind a bearer token, so a thought from an agent lands
in the same place.

