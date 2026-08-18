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

## Related

* [The agent boundary](/explanation/the-agent-boundary.md) - why this prefix exists and what a token does not grant
* [Connect an agent](/how-to/connect-an-agent.md) - the client configuration for each of them
* [HTTP API](/reference/http-api.md) - the routes the browser uses, which no token reaches
* [Configuration](/reference/configuration.md) - `KASTEN_TOKENS_PATH` and `KASTEN_AGENT_HOST`
