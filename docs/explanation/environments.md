---
type: Explanation
title: Two environments
description: Why dev and prod are deployed in deliberately different ways, and the constraints this box imposes on both.
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

One service breaks that pattern, and it is worth naming rather than hiding. The
shell container is the only dev service built on the box. There is no reload
loop to bind-mount a tree into, so a change to `shell/Dockerfile` has no other
way to be tested before a release ships it; `mise run dev:up` passes `--build`
and rebuilds that one image, leaving the other two on their stock ones.

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

That matters more now that one of the things behind the gate is a shell. Both
environments reach the shell container the same way, through a Caddy
`handle /term/*` carrying `import oauth2_auth`, and neither container publishes
a port. Those two facts are the whole of its security, so
[Deploy to the VPS](/how-to/deploy-to-the-vps.md#prove-the-shell-is-not-exposed)
carries the commands that prove them.

They do not share a database and they do not share a vault. Dev writes
`kasten_dev` on kasten's own compose Postgres; prod writes `kasten_prod` on the
shared container. The vaults are separate host directories, for the reason
given below.

## The vault is the only irreplaceable thing here

Postgres holds a derived index and can be rebuilt from the vault at any time,
which is the whole point of
[The vault and the derived index](/explanation/vault-and-derived-index.md). The
vault cannot be rebuilt from anything. Three consequences follow, and all three
are deployment decisions rather than code:

- The vault is a bind mount to a host path, never a named volume, and it lives
  outside the repo and outside every container lifecycle. A volume is easy to
  remove by accident and hard to back up on purpose.
- Dev and prod never share a directory. A dev bug that rewrites files would
  otherwise eat your real notes.
- The prod vault is a jj repo, colocated with git, pushed on a schedule. The
  backend records every save into it, so that is file history and backup in
  one, and it costs nothing because the vault is already plain markdown.
  Without it saving still works and nothing is kept, so an overwrite is final.

## Constraints the box imposes

Six things about this machine that a reasonable person would get wrong, each of
which cost an evening to find.

**The dev servers run in containers, not on the host.** That is not a style
choice. This box firewalls Docker bridge traffic to arbitrary host ports: from
inside a container, ports 22, 80 and 443 on the host connect, and everything
else times out. So Caddy cannot reach a dev server bound to the host, no matter
which address it binds. On the `web` network it reaches them by name, which
needs no firewall rule and cannot break when one changes.

**Both dev containers run as uid 1000, not root.** The backend writes into the
bind-mounted vault, and a root-owned note on the host needs sudo to edit or
back up. The same applies in production, hence `user: "1000:1000"` in
`deploy/compose.yaml`. This is also why `dev:up` creates `.container/venv` and
`.container/node_modules` before starting: they are bind mounts, and Docker
would otherwise create them as root and leave the containers unable to write.

Those container dependency trees live in `.container/`, deliberately separate
from the host's `.venv` and `frontend/node_modules`. Sharing them breaks both,
because a venv holds absolute paths that are wrong inside the container. The
consequence is that `.container/node_modules` outlives a restart, so
`dev:restart` cannot clear a stale one: after the move from pnpm to bun it held
both layouts at once and dev served the page with a 500 on the stylesheet,
`ENOENT` on a path under `node_modules/.pnpm/`. [Run the
checks](/how-to/run-the-checks.md) has the commands to wipe it.

**`/api/events` must not be compressed.** It is a server-sent event stream that
stays open and pushes vault changes as they happen. A reverse proxy that gzips
it buffers the whole response instead, so the browser holds a connection that
never delivers a byte and never errors either: it reads as healthy, nothing is
logged, and nobody works it out from the behaviour. Caddy's `reverse_proxy`
flushes `text/event-stream` on its own, so `encode` is the only thing on the
path that can do this, and the fix is a request matcher rather than a response
one, because `not` inside `encode` is rejected as an unrecognised response
matcher:

```caddyfile
@compressible not path /api/events
encode @compressible gzip
```

Both kasten site blocks carry it and everything else stays compressed. The
Caddyfile lives in another repo, which is why the requirement is written down
here.

**`/api/events` would also hold a reload open forever, so uvicorn is started
with `--timeout-graceful-shutdown 1`.** That endpoint runs until its reader
leaves, and uvicorn waits for open connections before it stops, so a single
browser tab holding the stream pins the old process open: in dev every request
then hangs until the tab is closed or the container restarted, and in prod a
replaced container never goes away. A lifespan cannot settle it, and this is
worth writing down because it is the obvious thing to reach for: uvicorn runs
the shutdown lifespan after the wait for connections, so a flag set there is
read too late to end the wait it was meant to end. The flag is on the dev
command in `compose.dev.yml`, the image `CMD` in `backend/Dockerfile` and the
`dev` task in `mise.toml`. It logs `Cancel 1 running task(s), timeout graceful
shutdown exceeded`, which is expected rather than a fault, and `EventSource`
reconnects to the new process on its own.

**Every published port binds `127.0.0.1` explicitly.** Docker publishes ports
with DNAT rules that ufw never sees, so a bare `"5434:5432"` faces the open
internet regardless of firewall rules. Do not drop the prefix.

**The shell container publishes no port at all, and its route carries the auth
gate.** `kasten-shell-dev` and `kasten-shell-prod` run ttyd over herdr with the
vault mounted, which is a root-less but fully live shell. Nothing else in this
system fails as quietly, because a shell that is reachable looks exactly like a
shell that is not until somebody finds it. It mounts the same host vault
directory the backend does, the two environments not sharing it, and it does
not get the docker socket. It carries `KASTEN_API`, the backend's address on
the `web` network, `http://backend-dev:8000` in dev and
`http://kasten-backend-prod:8000` in prod. The vault's own
`99 Misc/01 Config/01 Agents/How-To-TODO.md` tells an agent in there to tick a
todo through `PUT /api/files/{path}`, and that is where it sends it. Nothing is
published to the host for it, and `curl` and `jq` are in the image for the same
reason.

It does not get your home directory either. Claude Code, codex and dsh are
installed fresh in the image and keep what they are told inside the container,
in the `kasten-shell-home` named volume; no `~/.claude`, `~/.claude.json`,
`~/.codex` or `~/.dsh` from the host is mounted. So the first of the two that
log in asks you to do it, once, dsh reads a DeepSeek API key from the
environment or `~/.dsh/.env`, and the volume keeps both across rebuilds and
releases. That is the
point: an agent in this container is its own install with its own settings, and
the vault is the only thing it shares with you.

The shell it hands you is zsh with starship drawing the prompt, and the aliases
are the host's. That setup is in the image, at `/etc/zsh/zshrc.kasten`, rather
than in a dotfile, because the home is a named volume docker seeds once: a
`~/.zshrc` shipped in an image would reach a fresh volume and never an existing
one. `~/.zshrc` is seeded empty for your own aliases and is read after the
shared file. All three are installed under `/opt/npm` rather than npm's
`/usr/local`, and that tree belongs to the user the shell runs as, which is
what `claude update` needs to write; putting it under `/usr/local` would hand
that user ttyd and herdr as well. An update lands in the container's writable
layer, so recreating the container returns to the version `shell/Dockerfile`
pins, and bumping the pin is how a version sticks.

## The runbook

The step-by-step for both environments, including DNS, Caddy and the
self-hosted runner, is in [Deploy to the VPS](/how-to/deploy-to-the-vps.md).
