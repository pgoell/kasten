---
type: Reference
title: "HTTP API: finding"
description: Routes that search the vault, list its tags and mentions, draw its link graph, and name the folder layout.
resource: backend/src/kasten_backend/routes/
tags: [api, backend, openapi]
status: stable
---

# HTTP API: finding

The routes that search the vault, list its tags and mentions, draw its link graph, and name the folder layout.

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

## GET /api/search

Finds every line in the vault holding `q`, ignoring case. Takes `q` and an
optional `archive`, and answers with at most 2,000 matches.

```json
[
  {
    "path": "projects/kasten.md",
    "line": 4,
    "text": "Postgres holds a derived index.",
    "date": "2026-10-07",
    "tags": ["#kasten"]
  }
]
```

Nothing is indexed and Postgres is not consulted. `rg` reads the notes on every
query, which over a 10,000 note vault costs about 17ms and cannot go stale,
because the files it reads are the source of truth themselves.

The match is literal. `q` is not a regex, so `index.` finds the end of a
sentence rather than any five letters followed by one more, and a half-typed
`[[like` is a query instead of an error. It is not a fuzzy match either: a
query read as a subsequence finds most of a vault whatever you type, which is
measurably useless over prose. Ranking the answer is the client's job, and
[The note search](/reference/editor-keys/finding.md#the-note-search) is where that
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

Each hit also carries `date` and `tags`, which the search histogram counts and
filters by. Both belong to the hit's note and not to the line. `date` is the
day the note counts on, taken from the first of these that holds:

1. the note's file name starts with a real date, as a daily note
   `2026-10-07.md` or a dated note `2026-09-18 Enablement.md` does. This is a
   calendar day, `YYYY-MM-DD`, which needs no zone;
2. the note's `created` field in its frontmatter, as written. kasten writes it
   in UTC with its offset, so the value is an instant such as
   `2026-10-18T22:30:00+00:00`. A bare `YYYY-MM-DD` is a calendar day and comes
   back as it is. A time with no offset comes back as written, and a browser
   reads it in the reader's own zone. Any other form, such as a week date, is
   skipped;
3. the file's modification time, as an instant in UTC with its offset.

So `date` is a calendar day or an instant. The client reads a plain day by its
shape and every other value as an instant. The instant is not cut to a day here because the day depends on
whose clock reads it. A note written at 00:30 in Berlin is stamped on the day
before in UTC, and the server cannot know the reader's zone. The client
converts the instant to the reader's zone and takes the day there.

The note's own date stands for every line in it because a line's date would
need a `jj annotate` of each note on each query. `created` comes before the
modification time because the histogram counts when things were written, and a
note edited today would otherwise count as written today. `date` is None when
the note can no longer be read.

`tags` is every tag the note holds, each with its hash and sorted, read as
`GET /api/tags` reads them: inline tags and the frontmatter's `tags` field.
`tags` is None when the note can no longer be read.

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

## GET /api/tags

Lists every tag written anywhere in the vault, once each, sorted.

```json
["#databases", "#dbt", "#flashcards/databases"]
```

A tag is what the [tag rule](/reference/tag-format.md) calls one, the rule the
editor, the todo board and the graph read by too. So `#!/bin/sh`, `#1984` and
`note#2` are no tags, and nor is a hash inside a code span, a fenced or indented
code block, an HTML comment, a line a `<!--` opens and the block it starts,
the frontmatter, a `[[wikilink]]` or a
`[text](url)`. The same tag written outside those anywhere is still offered. The
frontmatter's `tags` field adds its values, as Obsidian reads them.

Two `rg` passes carry the same flags search carries. One matches every span and
every hash that could open a tag, and each match is read as the todo board reads
a line. The other reads each note whole and names those holding three backticks
or tildes, a comment left open at the end of its line, a hash on a line indented
four spaces or a tab, or a frontmatter with a hash or a `tags` field in it. The
backend reads each of those whole, since only the whole note says where a block
opens and closes. Most notes carry a frontmatter of an id and dates and none of
the rest, so the first pass alone reads them. Only the tags come back, never the
lines holding them. Which note holds a tag is a search, and this answers what the
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

