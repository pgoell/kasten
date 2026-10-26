---
type: Reference
title: The self-host stack
description: The variables deploy/selfhost/compose.yaml reads from its .env, and the two files beside it.
resource: deploy/selfhost/compose.yaml
tags: [config, self-host, compose]
status: stable
---

# The self-host stack

`deploy/selfhost/compose.yaml` reads these from `.env` beside it, as well as
the shared ones in [Configuration](/reference/configuration.md#compose-variables).
`deploy/selfhost/.env.example` lists them with comments, and
[Self-host kasten](/how-to/self-host-kasten.md) walks through them.

| Variable | Default | What it sets |
| --- | --- | --- |
| `KASTEN_DOMAIN` | none, required | the hostname Caddy gets a certificate for, and the backend's `KASTEN_AGENT_HOST` |
| `KASTEN_GATE` | none, required | the login: `basicauth`, `oauth2-proxy` or `tailscale`, read as `gates/<name>.caddy` |
| `KASTEN_BASIC_AUTH_USER` | empty | the user name the basic auth gate asks for |
| `KASTEN_BASIC_AUTH_HASH` | empty | its bcrypt hash, from `caddy hash-password`, in single quotes |
| `KASTEN_BIND_ADDRESS` | `0.0.0.0` | the host address Caddy's ports bind to; the tailnet address for the tailscale gate |
| `KASTEN_HTTP_PORT` | `80` | the host port for HTTP |
| `KASTEN_HTTPS_PORT` | `443` | the host port for HTTPS, TCP and UDP |
| `OAUTH2_PROXY_PROVIDER` | `github` | `github`, or `oidc` for any OpenID Connect provider |
| `OAUTH2_PROXY_OIDC_ISSUER_URL` | empty | the provider's issuer, for `oidc` |
| `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET` | empty | the OAuth app registered with the provider |
| `OAUTH2_PROXY_COOKIE_SECRET` | empty | 32 random bytes, base64 |
| `COMPOSE_PROFILES` | unset | `oauth2-proxy` starts the oauth2-proxy service |
| `COMPOSE_FILE` | unset | `compose.yaml:compose.tailscale.yaml` for the tailscale gate |

Two files sit beside `.env`:

* `backend.env`, optional, holds any `KASTEN_` setting from [Configuration](/reference/configuration.md) for the
  backend. Compose hands it to the backend alone, so the gate's secrets in
  `.env` never reach it. The stack sets `KASTEN_AGENT_HOST`,
  `KASTEN_VAULT_PATH` and `KASTEN_TOKENS_PATH` itself; `backend.env` cannot
  override those three, because compose's `environment` wins over `env_file`.
* `allowed-emails.txt`, for the oauth2-proxy gate, one address a line. Only
  those addresses may sign in, and without the file oauth2-proxy does not start.
