---
type: Reference
title: Agent routes
description: The routes an agent outside the box reaches the vault with, what each one answers, and how a write is checked against the digest the caller read.
tags: [api, agent, backend]
status: stable
---

# Agent routes

## GET /agent/openapi.json

This prefix, described as OpenAPI, for a caller that has a token and a curl
rather than an MCP client.

```json
{
  "openapi": "3.1.0",
  "info": { "title": "kasten agent API", "version": "0.17.0" },
  "paths": { "/agent/notes": {}, "/agent/search": {} }
}
```

It names the routes on this page, itself included, and nothing else. `/openapi.json` at the root
is a different document: it describes the browser's API, it is behind the
login gate, and no token reaches it.

Built from this router's own routes rather than by filtering the whole
application's schema, so the models it defines are the ones these routes use and
no others. That is deliberate rather than tidy. A token holder cannot reach
anything under `/api/`, and handing one the map of those thirty-five routes
would give it away for nothing.

An agent over MCP needs none of this: `tools/list` describes the same eight
capabilities and the finance reads with the same argument shapes, less the raw
upload, which no tool call can carry.

## GET /agent/notes

Lists every note in the vault as a relative POSIX path, sorted.

```json
["daily/2026-08-18.md", "index.md", "projects/kasten.md"]
```

An optional `folder` narrows it to one folder and everything under it:

```
GET /agent/notes?folder=projects
```

A folder the vault does not hold, and one that climbs out of it, both answer
with an empty list. Every refusal here reads as absent.

## GET /agent/search

Finds every line in the vault holding `q`, ignoring case, up to 2,000 matches.

```
GET /agent/search?q=forking&archive=false
```

```json
[{ "path": "borges.md", "line": 3, "text": "The garden of forking paths." }]
```

The match is literal rather than a regex or a fuzzy one, the same rg pass
`GET /api/search` makes. `line` is 1-based.

The archive folder is walked past unless `archive=true`. Which folder that is
comes from `KASTEN_ARCHIVE_PATH` rather than a hardcoded `98 Archive`, so a
vault that files things differently is searched correctly. A blank `q` answers
with nothing rather than with everything.

## GET /agent/graph

The notes as a graph of the links between them, narrowed by a filter or asked a
pattern. The MCP tool is `query_graph`, taking `query` for `q` and the other
three under the same names.

```
GET /agent/graph?q=?paper supports [[GraphRAG]]; ?paper type:Source
```

```json
{
  "nodes": [
    { "path": "sources/edge.md", "name": "edge", "type": "Source", "tags": ["#ai"], "missing": false },
    { "path": "concepts/GraphRAG.md", "name": "GraphRAG", "type": "Concept", "tags": [], "missing": false }
  ],
  "edges": [
    { "source": "sources/edge.md", "target": "concepts/GraphRAG.md", "relation": "supports", "line": 7 }
  ],
  "columns": ["?paper"],
  "rows": [{ "?paper": "sources/edge.md" }],
  "truncated": false
}
```

It runs the same function as
[`GET /api/graph`](/reference/http-api/finding.md#get-apigraph) and answers the same shape, so the graph
the browser draws and the one an agent reads come from one parser. What `q` may
say is [the graph query](/reference/graph-query.md). A filter such as
`type:Concept -tag:#draft rel:depends-on is:orphan` narrows the notes and leaves
`columns` and `rows` empty. A pattern, one or more clauses holding a
`?variable`, answers in `rows`, one binding of every column per row, and
`truncated` says more rows matched than came back. A blank `q` is the whole
vault.

`around` names a note and `depth` how many links out from it to reach, `0` to
`5` and `1` unless given. The neighbourhood is taken first and `q` applied
inside it, and the note named stays in `nodes` whatever the filter says. Prefer
`around` or a pattern to the whole graph, which lists every note in the vault.

`missing` marks a note that a link names and nobody has written. `relation` is
the name of a typed relation, or `null` for a plain `[[link]]`, and `line` is
the first line of `source` that writes it.

The archive folder is left out unless `archive=true`, as in a search.

A query it cannot read is `400`, with a sentence saying why:

```json
{ "detail": "That pattern matches too much to answer. Name a note, a type or a relation" }
```

So is an `around` naming a note the graph does not hold. The MCP tool reports
the same sentence as a tool error.

## GET /agent/notes/{path}

Reads one note, with the digest a conditional write presents back.

```json
{
  "path": "daily/2026-08-18.md",
  "content": "---\nid: 019...\n---\n\nThe note.\n",
  "sha": "3b1f...c7"
}
```

`path` is the canonical spelling of the path rather than the one in the URL, so
`ideas/./kasten.md` comes back as `ideas/kasten.md`.

`sha` is the SHA-256 hex of the bytes on disk, not of the `content` string as
some other encoding would render it. The two agree, because the read does not
translate anything: a note written with CRLF line endings comes back with them
intact and its digest matches the file. That is what makes a read-then-write
round trip leave a Windows note alone instead of rewriting every line of it.

Anything that is not a readable markdown file inside the vault is a `404`,
including a path that climbs out of it. Every refusal reads as absent, so a typo
and an attempt to escape the vault answer the same way.

## PUT /agent/notes/{path}

Writes one whole note, creating it when there is none there.

```json
{ "content": "---\ntype: Note\n---\n\nThe whole note.\n", "sha": "3b1f...c7" }
```

`sha` is the digest of the note the caller read, and it is required, not
optional:

| The note on disk | `sha` | Answer |
| --- | --- | --- |
| absent | omitted or `null` | `200`, the note is created |
| absent | given | `409`, with `current` null |
| present | omitted or `null` | `409`, with the current digest |
| present | not the digest on disk | `409`, with the current digest |
| present | the digest on disk | `200`, the note is written |

The comparison happens inside the same lock as the write, so nothing can slip
between them. What that closes, and what it deliberately does not, is in
[The agent boundary](/explanation/the-agent-boundary.md#why-the-write-is-conditional-in-one-direction).

The answer is the same shape a read gives: the path, the content that landed and
its digest.

A note that holds a CRLF on disk keeps CRLF, whether the text sent carries CRLF
or LF. The append below does the same.

A note created here makes the folders on the way, and each folder it makes gets
an `index.md` listing what it holds, the way
[a create in the browser](/reference/http-api/notes.md#post-apifilespath) does. The
append below does the same when it creates.

## POST /agent/notes/{path}/append

Adds a line to the end of one note, creating it when there is none there.

```json
{ "text": "A line to file.", "sha": null }
```

`sha` is optional here and checked when it is given. An append with no digest
races nothing, because the read and the write happen under one acquisition of
the write lock, which is the point of having an append at all rather than
telling every caller to read, concatenate and save.

An existing note gets exactly one blank line between what was there and what
arrives, and a trailing newline is added when the text lacks one. A note that
does not exist yet is created with the text as its whole body and no leading
blank line, exactly as a note created in the browser is.

## POST /agent/dump

Adds a paragraph to the `## Dump` section of the user's daily note for `date`,
the section the user reads at the end of the day to plan the next one. The MCP
tool is `dump`, taking the same two arguments.

```json
{ "text": "answer Jonas about the flat", "date": "2026-09-29" }
```

`date` is the user's local date, `YYYY-MM-DD`, and it is required. The process
has no notion of the vault's timezone to fall back on, and a guess made in UTC
files an evening's thought under tomorrow.

It runs the same function as
[`POST /api/dump`](/reference/http-api/capture.md#post-apidump), so everything that
page says about where the text lands holds here: the daily note is made where
there is none, exactly as `<leader>gd` makes it, the section is made where the
note has none, and the text goes at the end of the section as a paragraph of
its own. No `sha`, for the reason an append needs none.

The answer is the shape a read gives: the path, the note as it landed and its
digest. Text with nothing in it once trimmed is `422` with
`Nothing to capture`, and the MCP tool reports the same sentence as a tool
error. The write is recorded as `agent(<name>): 01 Periodic/00 Daily/<date>.md`
like every other agent write.

## POST /agent/files/{path}

Puts one PDF, epub or image into the vault at `path`, and never over a file
already there. The body is the file itself, raw, as
[`POST /api/assets/{path}`](/reference/http-api/assets-and-books.md#post-apiassetspath) takes
it, and the two run the same function.

```sh
curl -s -X POST -H "Authorization: Bearer $KASTEN_TOKEN" \
  --data-binary @ddia.pdf "$KASTEN_AGENT/files/20%20Literature/DDIA.pdf"
```

```json
{ "path": "20 Literature/DDIA.pdf" }
```

`path` ends in `.pdf`, `.epub`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.mp3`,
`.m4a`, `.ogg` or `.wav`, and
the bytes must start the way that suffix says. A PDF or an epub filed at a
note's path with the suffix swapped is the file the reader opens beside that
note, which [The file beside a note](/explanation/books-in-the-vault.md)
explains.

| Status | Means |
| --- | --- |
| `201` | The file is at `path` |
| `400` | `The vault will not take that path`, or `That file is not what its name says` |
| `409` | `Something is already there` |
| `413` | `That file is over the 100 MiB limit` |

There is no overwrite and no delete. A file sent to the wrong path stays there
until someone removes it from the browser (an image) or the shell (a book).

No MCP tool carries bytes. A tool call is JSON the model writes, so a file would
have to travel as base64 the model types out, which fails long before a paper's
size. An agent with a shell, Claude Code among them, sends the file with this
route instead, and the bytes go from disk to the vault without passing through
the model.

## POST /agent/files/{path}/fetch

Downloads the file at a public `url` into the vault at `path`, by way of the
upload above. The MCP tool is `save_file`, taking `path` and `url`.

```json
{ "url": "https://arxiv.org/pdf/2404.16130" }
```

The answer, the cap, the suffix check and the refusals are the upload's. The
address meets the checks [`GET /api/fetch`](/reference/http-api/capture.md#get-apifetch)
makes: `http` or `https`, every address the name resolves to on the public
internet, every redirect checked again, at most twenty of them. A refused
address is `400`; a name that does not resolve, a page that answers `400` or
worse, and a transfer that breaks off are `502`. The path is checked before
anything is opened.

This is the way in for claude.ai and chatgpt.com, which have no shell. A file
there with no public address, a PDF attached to the chat among them, has no way
into the vault: the model sees its text and never its bytes.

## The finance reads

Ten `GET` routes under `/agent/finance/`, and no route that writes. Each
summary is the finance pane's own route, served a second time behind the token,
so it takes the same query and answers the same JSON, to the cent; the pages
under [HTTP API](/reference/http-api.md) describe the shapes. `today` is always
the reader's local date, never the server's.

| Route | The pane's route | MCP tool |
| --- | --- | --- |
| `GET /agent/finance/budget?month=&today=` | [`GET /api/finance/budget`](/reference/http-api/finance-budget.md) | `monthly_by_category` |
| `GET /agent/finance/budget/free?month=&today=` | [`GET /api/finance/budget/free`](/reference/http-api/finance-budget.md) | `free_to_spend` |
| `GET /agent/finance/goals?today=` | [`GET /api/finance/goals`](/reference/http-api/finance-plans.md) | `goal_progress` |
| `GET /agent/finance/plans/forecast?today=` | [`GET /api/finance/plans/forecast`](/reference/http-api/finance-plans.md) | `plan_forecast` |
| `GET /agent/finance/plans/upcoming?month=` | [`GET /api/finance/plans/upcoming`](/reference/http-api/finance-plans.md) | `plan_forecast` |
| `GET /agent/finance/sync` | [`GET /api/finance/sync`](/reference/http-api/finance-sync.md) | `sync_status` |
| `GET /agent/finance/tax/{year}` | [`GET /api/finance/tax/{year}`](/reference/http-api/finance-tax.md) | `tax_year_summary` |
| `GET /agent/finance/transactions/{id}` | [`GET /api/finance/drill/bookings/{id}`](/reference/http-api/finance-drill.md) | `read_transaction` |
| `GET /agent/finance/transactions` | below | `list_transactions` |
| `GET /agent/finance/lookup` | below | `finance_lookup` |

`plan_forecast` answers both plan routes in one object, `forecast` and
`upcoming`, for the month `today` falls in.

`GET /agent/finance/transactions` is a page of single bookings, newest first.
It takes the filters of [`GET /api/finance/transactions`](/reference/http-api/finance.md)
(`month` or `from` and `to`, `account`, `category`, `payee`, `text`, `order`,
`after`) and one more, `scope`: `mine` lists the own accounts that are not
saving accounts, `household` the shared ones. A month here is by booking date,
not the budget month a late salary counts in. `limit` is 100 unless given, at
most 500. Each booking comes without its raw bank record, which the single
booking route carries.

```json
{ "bookings": [{ "id": 812, "booking_date": "2026-10-02", "amount": "-120.00", "purpose": "Rewe", "splits": [] }], "next": 812 }
```

`next` is the `after` for the page that follows, and `null` on a page shorter
than `limit`. An `after` that names no booking, one deleted since, is `400`
rather than an empty page. A database that fails partway through a read
answers a tool with a short sentence, and the server log keeps the reason.

`GET /agent/finance/lookup` answers every account, category and payee, the
ids the filters and the summaries name:

```json
{ "accounts": [{ "id": 1, "name": "Giro", "kind": "giro", "shared": false }], "categories": [{ "id": 4, "name": "Groceries", "kind": "flexible" }], "payees": [] }
```

With no database, the self-host default, every finance route answers `503`
with the sentence the pane's routes give, and every finance tool fails with it.
Why agents read single bookings at all is in
[Finance reads past the boundary](/explanation/the-agent-boundary/finance-reads.md).
Tax figures come with the tax marks (#1040).

## What a digest is of, and why it is never the digest of what you sent

Every write stamps the note on the way through, the same stamp a browser save
applies: an id when the note has none, a creation date, a type and this moment
in `modified`. Not stamping would leave `modified` untouched on every agent
write, and would let an agent that dropped the frontmatter block earn the note a
fresh id on its next browser save, which is the failure the stamp exists to
prevent.

So the bytes written are not the `content` that was sent, and **the `sha` in the
answer is the digest of what landed on disk**. A caller that computes its next
digest locally from what it sent is refused on every save. The digest to present
on the next write is the one the last write returned.

The exception is `index.md` and `log.md`. Open Knowledge Format gives those two a
shape of their own, kasten writes no block into either, and their bytes are
therefore exactly what was sent. For those two, and only those two, the returned
`sha` is the digest of the `content` you sent.

## The size bound

A write that would leave more than 1MiB on disk is `413`. The bound is measured
on the final UTF-8 bytes, after the append has been joined and after the stamp
has run, so a note just under the line plus a small append is refused rather
than allowed through on the size of the incoming text alone.

One mebibyte because that is the size above which jj stops tracking a new file
by default, and therefore the size above which "jj holds the history" stops
being true.
