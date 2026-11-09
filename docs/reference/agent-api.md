---
type: Reference
title: Agent API
description: The routes an agent outside the box reaches the vault with, the bearer token they require, and the OAuth flow that issues one to a browser product.
resource: backend/src/kasten_backend/agent_routes.py
tags: [api, agent, tokens, oauth, backend, books]
status: stable
---

# Agent API

Everything under `/agent/` is reached with a bearer token and nothing else,
except the token endpoint of [the OAuth flow](/reference/agent-api/oauth.md), which by
definition meets a caller that has none. Nothing in front of the prefix asks for
a session, so the token check in the backend is the entire trust boundary. Why
the prefix exists at all, and why it carries eleven capabilities and the finance
reads rather than the thirty-five in [the HTTP API](/reference/http-api.md), is
in [The agent boundary](/explanation/the-agent-boundary.md).

Mint a token at `/tokens` in the notebook. Connecting a client to it is
[Connect an agent](/how-to/connect-an-agent.md).

The routes and the sign-in flow have pages of their own:

* [Agent routes](/reference/agent-api/routes.md): every route under `/agent/`, the finance reads and the skill reads among them, what it answers, and the digest a write must present
* [Agent finance routes](/reference/agent-api/finance.md): the finance pane's routes behind the token, the contracts and their reminder pass, and the MCP tool beside each
* [Search by meaning for agents](/reference/agent-api/search-by-meaning.md): the ranked search behind `search_meaning` and `GET /agent/search/meaning`, and the notes like one note
* [Agent OAuth flow](/reference/agent-api/oauth.md): the routes claude.ai and chatgpt.com sign in through, and the redirects they may use

## The bearer rule

Every request carries the token in an `Authorization` header:

```
Authorization: Bearer kasten_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Anything else is `401`: no header, a header in another scheme, a secret the
store does not hold, and a token that has been revoked. The body is one sentence
in every case, so it says nothing about which it was.

```json
{ "detail": "That is not a token this vault knows" }
```

`POST /agent/mcp` adds a header to that refusal, and it is the only part of the
refusal that names anything:

```
WWW-Authenticate: Bearer error="invalid_token", resource_metadata="https://notes.example.com/.well-known/oauth-protected-resource/agent/mcp", scope="kasten:notes"
```

The header names one document and no more. That document is public, holds three
fields, and reads the same to everyone: which endpoint this is, which server
authorizes it and the one scope. It is what turns a refusal into a sign-in, and
a browser product that never sees it has nowhere to look. The REST routes below
refuse with the body alone.

A revoke takes effect on the very next request. Nothing is held between them.

There is no configuration in which the gate opens. A token store that does not
exist reads as an empty list, and no digest matches nothing.

The token's name is recorded with the write it makes: an agent's change reads
`agent(laptop): daily/2026-08-18.md` in `jj log`, where a browser's reads
`vault: daily/2026-08-18.md`.

## Reading tokens and GET /agent/reading

A token minted with the `reading` scope opens `GET /agent/reading` and
[the two post reads](#get-agentposts), and nothing else. Every other route under `/agent/`, `POST /agent/mcp` included, refuses it
with the `401` and the sentence above. A full token may call the route too.
Tick "Website only" at `/tokens` to mint one, or send `"scope": "reading"` to
[`POST /api/tokens`](/reference/http-api/system.md#post-apitokens). The store
keeps reading tokens in `tokens-reading.json` beside `tokens.json`, a digest
each, so an older backend that reads only `tokens.json` refuses them rather
than taking them for full tokens.

The route answers the book you are reading, for the Reading pane on pgoell.com:

```json
{ "title": "The Staff Engineer's Path", "author": "Tanya Reilly", "progress": 0.41, "read_at": "2026-11-05T21:30:00+01:00" }
```

The book is the note the first `[[link]]` in `reading-now.md` names, in the
[config folder](/reference/configuration.md#the-vaults-folders). When that file
is missing or names no note, it is the note with a `reading:` field and the
newest `read_at:`. A note qualifies only with both fields and a `read_at:` that
reads as a time, so a `reading-now.md` naming a note without one answers `204`
with no body, as a vault with no qualifying note does.

`title` is the note's name. `author`, `progress` and `read_at` are the
[fields the reader writes](/reference/note-frontmatter.md#every-other-field-is-yours);
`author` and `progress` are `null` when the note has none. Nothing else of the
note is in the answer: no path, no body and no cfi.

## GET /agent/posts

The blog on pgoell.com reads the notes you publish through two routes, which a
reading token opens as well as a full one. A note is a post when its block says
`publish: true` (or `yes`) and it has a date, from `date:` or else `created`.
Notes in the archive folder never are.

`GET /agent/posts` answers every post, newest first, without its text:

```json
[{ "slug": "how-this-site-was-made", "title": "How this site was made", "date": "2026-11-08", "description": "The viewfinder home page", "lang": "en", "translation_key": "viewfinder" }]
```

`GET /agent/posts/{slug}` answers one, the same fields and `body`, or `404`.
With `?lang=de` it picks the post in that language when two share a slug.

* `slug` is the `slug:` field when it is lowercase words joined by hyphens, or
  else the note's name made into one, `ä` as `ae`.
* `title` is the `title:` field, or else the `# heading` the note opens with, or
  else the note's name.
* `description`, `lang` (lowercased) and `translation_key` (or `translationKey`)
  are the fields of those names, `null` when absent.
* `body` is the markdown below the block, without the opening `# heading`. A
  `[[link]]` to another post becomes `[words](its-slug)`, a link the site reads
  relative to the post. Any other `[[link]]` becomes its words, so no private
  note's path leaves the vault. An embed, `![[...]]`, is dropped. Links in code
  stay as written.

No path, folder or other field of the note is in either answer.

## Related

* [The agent boundary](/explanation/the-agent-boundary.md): why this prefix exists and what a token does not grant
* [Connect an agent](/how-to/connect-an-agent.md): the client configuration for each of them
* [HTTP API](/reference/http-api.md): the routes the browser uses, which no token reaches
* [Configuration](/reference/configuration.md): `KASTEN_TOKENS_PATH` and `KASTEN_AGENT_HOST`
