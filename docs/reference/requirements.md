---
type: Reference
title: Requirements
description: What a machine needs to run the self-host stack, the ports it opens, and the memory and disk the maintainer's running copy uses.
resource: deploy/selfhost/compose.yaml
tags: [deploy, self-host, requirements]
status: stable
---

# Requirements

What a machine needs to run [the self-host stack](/how-to/self-host-kasten.md).

## Software

| Need | Detail |
| --- | --- |
| Linux, `amd64` or `arm64` | each image tag covers both, and Docker pulls the right one. arm64 images exist from the first release after 0.29.0. 32-bit ARM has none |
| Docker Engine | with the compose plugin, 2.24 or later, which reads `env_file` with `required: false` |
| A DNS name | pointing at the machine, for basic auth and oauth2-proxy. Tailscale uses the machine's `ts.net` name instead |
| Git | to fetch `deploy/selfhost/`. Nothing else in the repository is needed |

No Postgres, no Python and no node on the host. jj, rg and git are inside the
images.

## Ports

| Port | Why | Gate |
| --- | --- | --- |
| `80/tcp` | Let's Encrypt's HTTP challenge, and the redirect to HTTPS | basic auth, oauth2-proxy |
| `443/tcp` | the notebook | all |
| `443/udp` | HTTP/3 | all |

`KASTEN_HTTP_PORT`, `KASTEN_HTTPS_PORT` and `KASTEN_BIND_ADDRESS` move them.
Leave 443 where it is if claude.ai or chatgpt.com will connect: the OAuth issuer
names no port. Under the Tailscale gate, bind to the tailnet address and open
nothing to the internet.

No other container publishes a port.

## Memory

Measured with `docker stats --no-stream` on the maintainer's production copy,
idle, with one user:

| Container | Memory |
| --- | --- |
| backend | about 80MiB |
| frontend | about 15MiB |
| shell | under 1MiB with no terminal open |
| Caddy | about 25MiB |
| oauth2-proxy, when used | about 20MiB |

The shell grows with what you run in it: each terminal is a herdr session, and
an agent such as Claude Code inside one costs what it costs anywhere. The idle
stack comes to under 200MiB, so the memory a machine needs is mostly whatever
you plan to run in the shell.

## Disk

| What | Size |
| --- | --- |
| backend image | about 520MB |
| frontend image | about 90MB |
| shell image | about 1.9GB, with node, Claude Code, codex and dsh in it |
| Caddy image | about 90MB |
| the vault | your notes, plus their jj history and any books you add |

Keep a few GB free on top, so an upgrade can pull a new set of images beside
the old. `docker image prune -a` removes the old set once the new one runs.

## Related

* [Self-host kasten](/how-to/self-host-kasten.md): the stack these numbers describe
* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): what the proxy on these ports routes
* [Upgrade kasten](/how-to/upgrade-kasten.md): why the spare disk is needed
