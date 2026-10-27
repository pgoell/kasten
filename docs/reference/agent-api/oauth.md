---
type: Reference
title: Agent OAuth flow
description: The authorization server kasten runs for claude.ai and chatgpt.com, the routes it answers on, the redirect addresses it accepts, and why each route sits where it does.
tags: [api, agent, tokens, oauth, backend]
status: stable
---

# Agent OAuth flow

## The OAuth flow

claude.ai and chatgpt.com have no field for a header, so neither can be handed a
token minted at `/tokens`. Both instead discover an authorization server, send
you through it, and carry what it issues. The routes below are that server, and
walking a product through them is
[Connect an agent](/how-to/connect-an-agent.md).

Only those two products can use this flow, because a code is sent only to the
redirect addresses [listed below](#get-and-post-apioauthauthorize). Claude Code,
codex and any other MCP client send the header instead: kasten has no
registration endpoint, and a loopback redirect on your own machine is not on the
list.

What the flow issues is an ordinary row in the same store, named for the
client's callback host: `claude.ai`, `claude.com` or `chatgpt.com`. The gate above cannot tell an OAuth
grant from a token typed into a terminal, `/tokens` revokes both with the same
button, and a note written through a connector reads
`agent(claude.ai): index.md` in `jj log`. A second Connect from the same product
revokes the old row and mints a new one.

Where each route sits is load-bearing. `/.well-known/*` and `/agent/oauth/token`
are fetched by a machine with no session and no way to get one, so nothing in
front of them may ask for one. `/api/oauth/authorize` is opened by your browser,
and the login gate in front of it is what proves who you are; kasten has no
login form of its own.

The reverse proxy is what holds that arrangement, and
[Reverse-proxy routes](/reference/reverse-proxy-routes.md) lists every route it
needs. The self-host stack's `deploy/selfhost/Caddyfile` ships them. Until
`/.well-known/*` reaches the backend ungated, the gate answers those paths with
a sign-in page or a `401`, and a connector reads that as neither a document nor
an absence.

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
  "resource": "https://notes.example.com/agent/mcp",
  "authorization_servers": ["https://notes.example.com"],
  "scopes_supported": ["kasten:notes"]
}
```

The same document answers at
`/.well-known/oauth-protected-resource/agent/mcp`. Claude follows that
path-inserted spelling off the `401` header and ChatGPT probes the bare one, and
a `404` on whichever a client tries ends the flow there.

`kasten:notes` is the one scope. It names the eight capabilities and the
finance reads, and there is nothing to narrow. `read_guide` is a ninth tool under it and not a ninth
capability: it answers with a string compiled into the image and reads no note,
so the audit this prefix exists for is still a list of eight things.

### GET /.well-known/oauth-authorization-server

RFC 8414. Every field here is read by one product or the other.

```json
{
  "issuer": "https://notes.example.com",
  "authorization_endpoint": "https://notes.example.com/api/oauth/authorize",
  "token_endpoint": "https://notes.example.com/agent/oauth/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["kasten:notes"],
  "authorization_response_iss_parameter_supported": true,
  "client_id_metadata_document_supported": true
}
```

`S256` above all: chatgpt.com refuses a server whose metadata omits it before it
tries anything. `none` is what lets a client with no secret reach the token
endpoint, which is both of them.

`client_id_metadata_document_supported` is for chatgpt.com, which needs a way to
get a `client_id` and greys out its add button when the server offers none.
With the flag it sends `https://chatgpt.com/oauth/client.json` as the id and
skips registration. kasten never fetches that document and never reads a
`client_id` at all: the redirect allowlist below decides where a code goes.

### GET and POST /api/oauth/authorize

The `GET` renders one button, naming the host it would give the eight
capabilities and every finance figure and transaction to. The `POST` behind that button mints a code and answers `302` to
the address it was given, carrying `code`, `state` and `iss`.

A `GET` never mints. oauth2-proxy's cookie is `SameSite=Lax`, which a browser
attaches to a top-level navigation, so a link here would otherwise mint a code
into whatever connector flow the linking page has waiting. A cross-site `POST`
carries no Lax cookie, so behind oauth2-proxy it is turned away before this
route is reached.

The `POST` also checks for itself that it came from the consent page, because
basic auth in front of kasten resends its credentials to any site that posts
here. It answers `403` and redirects nowhere when:

* `Sec-Fetch-Site` is present and is anything but `same-origin`
* `Sec-Fetch-Site` is absent, `Origin` is present, and its host matches neither
  the request's `Host` nor [`KASTEN_AGENT_HOST`](/reference/configuration.md#kasten_agent_host)

`Sec-Fetch-Site` wins when both are sent, so a dev proxy that rewrites `Host`
does not break the real consent page. A request with neither header came from
no browser and passes.

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
the host in question may carry a session cookie for its whole parent domain. A
`code_challenge` that is missing or not RFC 7636 shape (43 to 128 characters of
`A-Z`, `a-z`, `0-9`, `-` and `_`, the base64url with no padding that S256
gives), or a `code_challenge_method` other than `S256`, is refused the same way,
so `plain` does not work here.

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
