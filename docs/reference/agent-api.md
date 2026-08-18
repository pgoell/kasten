---
type: Reference
title: Agent API
description: The routes an agent outside the box reaches the vault with, the bearer token they require, and the OAuth flow that issues one to a browser product.
resource: backend/src/kasten_backend/agent_routes.py
tags: [api, agent, tokens, oauth, backend]
status: stable
---

# Agent API

Everything under `/agent/` is reached with a bearer token and nothing else,
except the token endpoint of [the OAuth flow](#the-oauth-flow), which by
definition meets a caller that has none. Nothing in front of the prefix asks for
a session, so the token check in the backend is the entire trust boundary. Why
the prefix exists at all, and why it carries five capabilities rather than the
twenty-four in [the HTTP API](/reference/http-api.md), is in
[The agent boundary](/explanation/the-agent-boundary.md).

Mint a token at `/tokens` in the notebook. Connecting a client to it is
[Connect an agent](/how-to/connect-an-agent.md).

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
WWW-Authenticate: Bearer error="invalid_token", resource_metadata="https://kasten.pascalkraus.com/.well-known/oauth-protected-resource/agent/mcp", scope="kasten:notes"
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

## The OAuth flow

claude.ai and chatgpt.com have no field for a header, so neither can be handed a
token minted at `/tokens`. Both instead discover an authorization server, send
you through it, and carry what it issues. The routes below are that server, and
walking a product through them is
[Connect an agent](/how-to/connect-an-agent.md).

Claude Code cannot use this flow. It has no field for a client id and would need
kasten to register clients on demand, which it does not do. It and codex are
unchanged and still send the header.

What the flow issues is an ordinary row in the same store, named for the
client's host, `claude.ai` or `chatgpt.com`. The gate above cannot tell an OAuth
grant from a token typed into a terminal, `/tokens` revokes both with the same
button, and a note written through a connector reads
`agent(claude.ai): index.md` in `jj log`. A second Connect from the same product
revokes the old row and mints a new one.

Where each route sits is load-bearing. `/.well-known/*` and `/agent/oauth/token`
are fetched by a machine with no session and no way to get one, so nothing in
front of them may ask for one. `/api/oauth/authorize` is opened by your browser,
and oauth2-proxy in front of it is what proves who you are; kasten has no login
form of its own.

Caddy is what holds that arrangement, and its config lives in the server-infra
repo rather than in this one. Until `/.well-known/*` is routed to the backend
there, the catch-all block answers those three paths with a redirect to a
sign-in page, and a connector reads that as neither a document nor an absence.
[Deploy to the VPS](/how-to/deploy-to-the-vps.md) has the stanza and the curls
that check it.

Every URL these routes hand out, the `iss` on the redirect and the one in the
`401` header above, is built from `KASTEN_AGENT_HOST` as `https://{host}`, which
is that setting's second job. A client compares an issuer as an exact string,
and the container runs uvicorn without `--forwarded-allow-ips`, so a URL built
from the request would say `http` where the world sees `https` and fail every
comparison downstream. Unset, the request is the fallback, which is what dev and
the tests use.

### GET /.well-known/oauth-protected-resource

RFC 9728, which names the endpoint and points at whoever authorizes it.

```json
{
  "resource": "https://kasten.pascalkraus.com/agent/mcp",
  "authorization_servers": ["https://kasten.pascalkraus.com"],
  "scopes_supported": ["kasten:notes"]
}
```

The same document answers at
`/.well-known/oauth-protected-resource/agent/mcp`. Claude follows that
path-inserted spelling off the `401` header and ChatGPT probes the bare one, and
a `404` on whichever a client tries ends the flow there.

`kasten:notes` is the one scope. It names the five capabilities and there is
nothing to narrow. `read_guide` is a sixth tool under it and not a sixth
capability: it answers with a string compiled into the image and reads no note,
so the audit this prefix exists for is still a list of five things.

### GET /.well-known/oauth-authorization-server

RFC 8414. Every field here is read by one product or the other.

```json
{
  "issuer": "https://kasten.pascalkraus.com",
  "authorization_endpoint": "https://kasten.pascalkraus.com/api/oauth/authorize",
  "token_endpoint": "https://kasten.pascalkraus.com/agent/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["kasten:notes"],
  "authorization_response_iss_parameter_supported": true
}
```

`S256` above all: chatgpt.com refuses a server whose metadata omits it before it
tries anything. `none` is what lets a client with no secret reach the token
endpoint, which is both of them.

### GET and POST /api/oauth/authorize

The `GET` renders one button, naming the host it would give the five
capabilities to. The `POST` behind that button mints a code and answers `302` to
the address it was given, carrying `code`, `state` and `iss`.

A `GET` never mints. oauth2-proxy's cookie is `SameSite=Lax`, which a browser
attaches to a top-level navigation, so a link here would otherwise mint a code
into whatever connector flow the linking page has waiting. A cross-site `POST`
carries no cookie, so oauth2-proxy turns it away before this route is reached.

`redirect_uri` is matched whole and never by prefix, against three addresses and
one pattern:

```
https://claude.ai/api/mcp/auth_callback
https://claude.com/api/mcp/auth_callback
https://chatgpt.com/connector_platform_oauth_redirect
https://chatgpt.com/connector/oauth/{callback_id}
```

The last is chatgpt.com's per-app callback, whose final segment is minted with
the app and cannot be known before it exists; the pattern pins the host, so the
widening reaches ChatGPT and nowhere else.

Anything else is a `400` rendered here and never sent on as an error redirect:
redirecting to an address just judged untrusted is the hole being refused, and
the host in question carries a `.pascalkraus.com` session cookie. A
missing `code_challenge`, or a `code_challenge_method` other than `S256`, is
refused the same way, so `plain` does not work here.

### POST /agent/oauth/token

Form encoded, as RFC 6749 requires, with `grant_type=authorization_code`,
`code`, `code_verifier` and `redirect_uri`. The answer carries
`Cache-Control: no-store`.

```json
{
  "access_token": "kasten_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "token_type": "Bearer",
  "scope": "kasten:notes",
  "expires_in": 315360000
}
```

A code is 256 bits, worth 60 seconds, spent by its first exchange and bound to
the redirect it was issued for. A stale code, a second exchange, a wrong
verifier and a mismatched redirect are all `400` with
`{"error": "invalid_grant"}`, the RFC 6749 code rather than a sentence of
kasten's own, because that spelling is what tells a client to send you through
the flow again.

Codes in flight are held in the process rather than in Postgres. Nothing there
outlives a minute, and a restart between the redirect and the exchange costs one
more press of Connect.

`expires_in` says ten years and is honest: a token here ends when it is revoked
at `/tokens`. There is no refresh token, no registration endpoint and no
revocation endpoint. A connector asking for a client id has nothing to be given,
so that field stays empty.

## Related

* [The agent boundary](/explanation/the-agent-boundary.md) - why this prefix exists and what a token does not grant
* [Connect an agent](/how-to/connect-an-agent.md) - the client configuration for each of them
* [HTTP API](/reference/http-api.md) - the routes the browser uses, which no token reaches
* [Configuration](/reference/configuration.md) - `KASTEN_TOKENS_PATH` and `KASTEN_AGENT_HOST`
