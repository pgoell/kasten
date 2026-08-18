---
type: Reference
title: Agent API
description: The routes an agent outside the box reaches the vault with, and the bearer token they all require.
resource: backend/src/kasten_backend/agent_routes.py
tags: [api, agent, tokens, backend]
status: stable
---

# Agent API

Everything under `/agent/` is reached with a bearer token and nothing else. It
is the one path prefix that does not sit behind oauth2-proxy, so the token check
in the backend is the entire trust boundary. Why the prefix exists at all, and
why it carries five capabilities rather than the twenty-four in
[the HTTP API](/reference/http-api.md), is in
[The agent boundary](/explanation/the-agent-boundary.md).

Mint a token at `/tokens` in the notebook. Connecting a client to it is
[Connect an agent](/how-to/connect-an-agent.md).

## The bearer rule

Every request carries the token in an `Authorization` header:

```
Authorization: Bearer kasten_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Anything else is `401`: no header, a header in another scheme, a secret the
store does not hold, and a token that has been revoked. The answer is one
sentence in every case, so it says nothing about which it was.

```json
{ "detail": "That is not a token this vault knows" }
```

A revoke takes effect on the very next request. Nothing is held between them.

There is no configuration in which the gate opens. A token store that does not
exist reads as an empty list, and no digest matches nothing.

The token's name is recorded with the write it makes: an agent's change reads
`agent(laptop): daily/2026-08-18.md` in `jj log`, where a browser's reads
`vault: daily/2026-08-18.md`.

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

It names the routes on this page and nothing else. `/openapi.json` at the root
is a different document: it describes the browser's API, it is behind
oauth2-proxy, and no token reaches it.

Built from this router's own routes rather than by filtering the whole
application's schema, so the models it defines are the ones these routes use and
no others. That is deliberate rather than tidy. A token holder cannot reach
anything under `/api/`, and handing one the map of those twenty-seven routes
would give it away for nothing.

An agent over MCP needs none of this: `tools/list` describes the same five
capabilities with the same argument shapes.

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

## What a digest is of, and why it is never the digest of what you sent

Both writes stamp the note on the way through, the same stamp a browser save
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

## Related

* [The agent boundary](/explanation/the-agent-boundary.md) - why this prefix exists and what a token does not grant
* [Connect an agent](/how-to/connect-an-agent.md) - the client configuration for each of them
* [HTTP API](/reference/http-api.md) - the routes the browser uses, which no token reaches
* [Configuration](/reference/configuration.md) - `KASTEN_TOKENS_PATH` and `KASTEN_AGENT_HOST`
