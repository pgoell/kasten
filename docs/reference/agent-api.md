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
except the token endpoint of [the OAuth flow](/reference/agent-api/oauth.md), which by
definition meets a caller that has none. Nothing in front of the prefix asks for
a session, so the token check in the backend is the entire trust boundary. Why
the prefix exists at all, and why it carries eight capabilities and the finance
reads rather than the thirty-five in [the HTTP API](/reference/http-api.md), is
in [The agent boundary](/explanation/the-agent-boundary.md).

Mint a token at `/tokens` in the notebook. Connecting a client to it is
[Connect an agent](/how-to/connect-an-agent.md).

The routes and the sign-in flow have pages of their own:

* [Agent routes](/reference/agent-api/routes.md): every route under `/agent/`, the finance reads among them, what it answers, and the digest a write must present
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

## Related

* [The agent boundary](/explanation/the-agent-boundary.md): why this prefix exists and what a token does not grant
* [Connect an agent](/how-to/connect-an-agent.md): the client configuration for each of them
* [HTTP API](/reference/http-api.md): the routes the browser uses, which no token reaches
* [Configuration](/reference/configuration.md): `KASTEN_TOKENS_PATH` and `KASTEN_AGENT_HOST`
