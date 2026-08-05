---
type: Explanation
title: Two environments
description: Why dev and prod are deployed in deliberately different ways.
tags: [deploy, environments, ci]
status: stable
---

# Two environments

kasten runs in two places on the same Hetzner VPS, and they are built in
opposite ways on purpose.

Dev runs the working tree. uvicorn and vite run with reload inside containers
that bind-mount the repo, so saving a file is the whole deploy step. You start
it yourself, on the box. Nothing about it touches GitHub Actions.

Prod runs images. GitHub Actions builds them, publishes them to GHCR, and
deploys only when you publish a GitHub release. Nothing about it is built by
hand, and nothing is built on the machine that serves it.

The split exists so that the fast path stays fast and the slow path stays
trustworthy. A reload loop that waits on CI is useless for development. A
production image built by hand on the server is a machine nobody can reproduce.
Neither environment can drift into the other's failure mode, because they share
no build step.

## What they do share

Both hostnames sit behind the shared oauth2-proxy, locked to one GitHub user.
kasten itself contains no authentication code at all. That is worth restating
because it is easy to forget when reading the backend: there is no login,
no session, no user model, and the API is open to whoever reaches it. The gate
is entirely in front.

They do not share a database and they do not share a vault. Dev writes
`kasten_dev` on kasten's own compose Postgres; prod writes `kasten_prod` on the
shared container. The vaults are separate host directories, for the reason given
in [The vault and the derived index](/explanation/vault-and-derived-index.md): a
dev bug that rewrites files must not be able to reach real notes.

## The runbook

The step-by-step for both environments, including DNS, Caddy and the
self-hosted runner, lives in [deploy/README.md](../../deploy/README.md), next
to the compose files it describes.
