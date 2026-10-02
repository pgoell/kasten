---
type: Reference
title: Reverse-proxy routes
description: Every path the proxy in front of kasten must route, which container each reaches, which carry the login gate and which must not, and the two paths that need special handling.
resource: deploy/selfhost/Caddyfile
tags: [deploy, caddy, proxy, security]
status: stable
---

# Reverse-proxy routes

kasten is three containers behind one hostname, and the proxy in front of them
splits the paths. `deploy/selfhost/Caddyfile` is a working copy of this table.
Any other proxy has to do the same. Why the gate sits where it does is in
[Security model](/explanation/security-model.md).

## The table

| Path | Goes to | Login gate | Why |
| --- | --- | --- | --- |
| `/api/*` | backend, port `8000` | yes | the browser's API, consent page and token routes included; the backend has no login of its own |
| `/agent/*` | backend, port `8000` | **no** | the backend checks a bearer token on every route under it, the OAuth token exchange aside |
| `/.well-known/*` | backend, port `8000` | **no** | the OAuth discovery documents, fetched by a machine with no session |
| `/term/*` | shell, port `7681` | yes | ttyd, a live shell. The gate is the only lock on it |
| everything else | frontend, port `3000` | yes | the built app, served by nginx |

Behind the oauth2-proxy gate, `/oauth2/*` goes to oauth2-proxy on port `4180`
with no gate, so the sign-in page and its callback can load.

## Rules

* **Keep the path.** Each route passes the path through unchanged. ttyd runs
  with `-b /term` and expects `/term/...`; the backend serves `/api/...` and
  `/agent/...` as written. In Caddy that means `handle`, never `handle_path`.
* **Gate everything but two prefixes.** `/agent/*` and `/.well-known/*` are the
  only routes open to the internet. A sign-in page or a gate's `401` on either
  ends an agent connector's flow. A missing gate anywhere else opens the vault,
  or, on `/term/*`, a shell.
* **The whole of `/.well-known/`.** Not just `/.well-known/oauth-*`: a client
  that falls back to `/.well-known/openid-configuration` must get the backend's
  `404`, not the gate.
* **`/api/oauth/authorize` stays gated.** It sits under `/api/`, and the gate in
  front of it is what proves who presses the consent button.
* **Do not compress `/api/events`.** It is a server-sent event stream. A
  compressor buffers it whole, and the browser then holds a connection that
  never delivers and never errors. In Caddy, put a request matcher on `encode`:

  ```caddyfile
  @compressible not path /api/events
  encode @compressible zstd gzip
  ```

  Caddy's `reverse_proxy` flushes `text/event-stream` on its own. Another proxy
  must turn off response buffering for that path too, as nginx does with
  `proxy_buffering off`.
* **Pass WebSocket upgrades on `/term/*`.** The terminal pane opens
  `wss://<host>/term/ws` with the `tty` subprotocol. Caddy passes upgrades
  without being told; nginx needs the `Upgrade` and `Connection` headers set by
  hand. The gate must cover the upgrade request too.
* **Publish no container port but the proxy's.** The shell above all: a
  published `7681` is a shell with no login in front of it.
* **Serve HTTPS on 443 at the hostname in `KASTEN_AGENT_HOST`.** The MCP
  endpoint answers `421` to any other `Host`, and the OAuth issuer is
  `https://<KASTEN_AGENT_HOST>` with no port.

## Checking it

From a machine with no session:

| Request | Answer |
| --- | --- |
| `GET /api/health` | refused by the gate: `401` for basic auth, `302` for oauth2-proxy, no answer from outside a tailnet |
| `GET /agent/notes`, no header | `401` from the backend, `{"detail": "That is not a token this vault knows"}` |
| `GET /agent/notes` with a valid token | `200` |
| `GET /.well-known/oauth-authorization-server` | `200`, JSON naming `https://<your-host>` as the issuer |
| `GET /.well-known/openid-configuration` | `404` from the backend |
| WebSocket upgrade on `/term/ws` | refused by the gate. **A `101` means the shell is open** |

[Self-host kasten](/how-to/self-host-kasten.md#6-check-the-gate) has the curls.

## Related

* [Security model](/explanation/security-model.md): what each lock covers, and why kasten has no login of its own
* [Self-host kasten](/how-to/self-host-kasten.md): the stack this table comes from
* [Agent API](/reference/agent-api.md): what answers under `/agent/` and `/.well-known/`
* [Two environments](/explanation/environments.md): the same routes on the maintainer's box, whose Caddy lives in another repository
