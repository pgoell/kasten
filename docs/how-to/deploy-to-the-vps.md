---
type: How-to Guide
title: Deploy to the VPS
description: The maintainer's runbook for one deployment. Bootstrap dev and prod on the Hetzner box, on amd64 or arm64, deploy day to day, and prove the shell is still behind its gate.
tags: [deploy, vps, caddy, postgres, ci]
status: stable
---

# Deploy to the VPS

> **The maintainer's runbook.** This page is one worked deployment: kasten on
> the maintainer's Hetzner box, sharing a Caddy, an oauth2-proxy and a Postgres
> with other sites, deployed by GitHub Actions. Its hostnames, paths and
> addresses are that box's. To run kasten on a machine of your own, follow
> [Self-host on a server](/tutorials/self-host-on-a-server.md) or
> [Self-host kasten](/how-to/self-host-kasten.md); the general rules are in
> [Reverse-proxy routes](/reference/reverse-proxy-routes.md) and
> [Security model](/explanation/security-model.md).

Two environments run on the same Hetzner box. This page is the runbook for
both. Why they are built in opposite ways is in
[Two environments](/explanation/environments.md).

| | dev | prod |
|---|---|---|
| URL | `kasten-dev.pgoell.com` | `kasten.pgoell.com` |
| What runs | uvicorn `--reload` and vite dev, in containers with the tree bind-mounted | Images from GHCR, in containers |
| Who deploys | you, on the box | GitHub Actions only |
| Trigger | saving a file | publishing a GitHub release |
| Built where | nowhere, it runs from source | `ubuntu-latest` and `ubuntu-24.04-arm` in CI |
| Architectures | whatever the box is | `linux/amd64` and `linux/arm64` |
| Database | `kasten_dev`, kasten's own compose Postgres on `:5434` | `kasten_prod`, on the shared `postgres` container |
| Vault | `/home/pascal/Code/kasten/vault` | `/home/pascal/kasten-data/vault` |

## First-time setup

Prerequisites already on the VPS: Caddy, the shared Postgres, and oauth2-proxy
running from `/home/pascal/Code/server-infra/`.

The prod images are published for `linux/amd64` and `linux/arm64` under one
tag, so the same steps work on an x86 box like this one and on an ARM one such
as a Hetzner CAX or a 64-bit Raspberry Pi. Docker pulls the image that matches
the host; nothing in `deploy/` names an architecture. A 32-bit ARM board has no
image.

### 1. DNS

Two proxied A records in Cloudflare pointing at `162.55.81.13`: `kasten` and
`kasten-dev`. There is no wildcard on `pgoell.com`, so both are needed.

### 2. Caddy

Add the two site blocks to
`/home/pascal/Code/server-infra/caddy/Caddyfile`, then validate before
reloading so a typo cannot take down the other sites:

```sh
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Both blocks must carry the request matcher that leaves `/api/events` and
`/chat/events` uncompressed, and the `handle /term/*` route carrying
`import oauth2_auth`. The prod block carries `handle /chat/*` with the same
import; [Open the chat route](#open-the-chat-route) has it.
[Two environments](/explanation/environments.md#constraints-the-box-imposes)
says what breaks without each.

### 3. Postgres

Only production needs a role on the shared container. Dev uses kasten's own
compose Postgres, because the shared one publishes no host port and the dev
backend runs on the host rather than in a container.

```sh
cd /home/pascal/Code/server-infra
set -a && . ./.env && set +a       # POSTGRES_USER and POSTGRES_PASSWORD
PROD_PW=$(openssl rand -base64 24)
docker exec -i postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" <<SQL
CREATE ROLE kasten_prod LOGIN PASSWORD '${PROD_PW}';
CREATE DATABASE kasten_prod OWNER kasten_prod;
SQL
echo "prod password: ${PROD_PW}"
```

Put that password into `KASTEN_DATABASE_URL` in
`/home/pascal/kasten-deploy/.env.prod`. For dev, `mise run db:up` is the whole
story and the defaults in `config.py` already point at it.

### 4. Vault directories

```sh
mkdir -p /home/pascal/kasten-data/vault
mkdir -p /home/pascal/Code/kasten/vault          # dev, already gitignored
```

Give each vault a history. The backend writes into it on every save, and the
identity goes on the repo because the backend runs jj from a container that has
no home directory to read a personal config out of:

```sh
for v in /home/pascal/kasten-data/vault /home/pascal/Code/kasten/vault; do
  jj git init --colocate "$v"                    # git repo alongside, so pushes still work
  jj -R "$v" config set --repo user.name  "Pascal Kraus"
  jj -R "$v" config set --repo user.email "pascal98kraus@gmail.com"
done
```

The prod container owns these files as uid 1000, so run this as `pascal`, not
as root. jj itself is baked into the backend image, pinned to the version in
`mise.toml`; both work on the same repo through the bind mount, so the two
have to agree.

### 5. Prod env file

Copy the template and fill in the password from step 3:

```sh
mkdir -p /home/pascal/kasten-deploy
cp deploy/.env.prod.example /home/pascal/kasten-deploy/.env.prod
```

The deploy job refuses to start if `.env.prod` or the vault directory is
missing, rather than letting compose invent an empty vault and bring the
notebook up blank.

The job runs compose with `--env-file .env.prod`, so the same file can also
carry the compose-level settings `deploy/compose.yaml` reads. Each defaults to
this box's value, and this box sets none of them:

| Variable | Default | What it sets |
| --- | --- | --- |
| `KASTEN_IMAGE_REPO` | `ghcr.io/pgoell` | where the three images are pulled from |
| `KASTEN_UID`, `KASTEN_GID` | `1000` | who the backend and shell run as |
| `KASTEN_NETWORK` | `web` | the external Docker network shared with Caddy |
| `JJ_USER`, `JJ_EMAIL` | unset | who jj records for a change made in the shell |

`KASTEN_DATA_DIR`, the host directory holding `vault/` and `agent/`, is not in
the file: compose defaults it to `/home/pascal/kasten-data`, and the deploy
script checks that `vault/` is there before it starts anything.

To run kasten on one machine without a shared Caddy at all, use
[Self-host kasten](/how-to/self-host-kasten.md) instead.

### 6. Deploy key

No runner and no code of this repository runs on the box. The deploy job
opens an SSH connection and sends one word, the tag. The key it uses is bound
to `deploy/deploy.sh kasten` in `~/Code/server-infra`, which checks the tag,
pulls the three images, and restarts the services from
`deploy/kasten/compose.yaml` there. That file is a copy of `deploy/compose.yaml`
here: after a change to it, copy it over by hand, or production keeps the old
one.

`deploy/README.md` in server-infra has the steps: make a key, add its line to
`~/.ssh/authorized_keys`, and give the `vps` environment of this repository
the secret `DEPLOY_SSH_KEY` and the variables `DEPLOY_HOST` and
`DEPLOY_KNOWN_HOSTS`. Only `main` and release tags may use that environment.

### 7. Dev services

```sh
mise run dev:up
```

## Day to day

**Dev.** Edit files. uvicorn and vite reload on their own, because the working
tree is bind-mounted into both containers. The frontend installs again by
itself when `bun.lock` changes; `mise run dev:restart` after a change to
`uv.lock`, `mise run dev:logs` when something looks wrong,
`mise run dev:status` to see what is up.

**Prod.** Cut a GitHub release, following [Cut a release](cut-a-release.md):
pick the version off the commits, bump `backend/pyproject.toml`, then tag. The
workflow checks the tag against that version and stops there if they disagree,
then builds each changed image twice, for amd64 on `ubuntu-latest` and for
arm64 on `ubuntu-24.04-arm`, tags the pair with the release tag and `latest`,
pushes to GHCR, and sends the tag to the box over SSH. The deploy script there
pulls, runs migrations as a one-shot container, restarts the services, and
waits for the backend healthcheck.

**Rollback.** Run the `Deploy production` workflow by hand with the `tag` input
set to an older release. It skips the build and redeploys that tag.

## Open the agent door

Do this once, and only after the release carrying the token gate is live. A
backend that predates it answers `404` to everything under `/agent/`, never the
vault, so the order is safe either way, but there is no reason to open a door
onto a room that is not built.

Nothing in the kasten repository can test any of this. The Caddyfile lives in
`~/Code/server-infra`, which has no pipeline, so the curls below are the check
and there is no automated one behind them.

**1. Make the host directory.** Beside the vault, never inside it.

```sh
mkdir -p /home/pascal/kasten-data/agent
chown 1000:1000 /home/pascal/kasten-data/agent
```

The directory is what `deploy/compose.yaml` mounts, never `tokens.json` itself.
A bind-mounted file is a mount point and `os.replace` over one fails with
`EBUSY`, so mounting the file would break every mint and every revoke in
production while passing every test there is.

**2. Add the Caddy stanzas** to the `kasten.pgoell.com` block in
`~/Code/server-infra/caddy/Caddyfile`, beside the existing `handle` blocks:

```
# The one block here with no oauth2_auth. Every route under it is token-gated
# in the backend, which is the entire trust boundary. Removing the gate from
# any other block, `/term/*` above all, is a different matter entirely: see
# kasten's docs/explanation/the-agent-boundary.md.
handle /agent/* {
    reverse_proxy kasten-backend-prod:8000
}
```

And a second stanza, for the OAuth metadata documents:

```
# Fetched by a machine with no session and no way to get one. The catch-all
# block imports oauth2_auth, so without this every path here answers 302 to a
# sign-in page on another host, and a connector reads that as neither a
# document nor "there is none".
handle /.well-known/* {
    reverse_proxy kasten-backend-prod:8000
}
```

The whole of `/.well-known/`, not `/.well-known/oauth-*`: a client that falls
back to `/.well-known/openid-configuration` has to get a `404`, and a narrower
match leaves that path on the catch-all, which answers a redirect. Widening
takes nothing away: certificates on this host come from the DNS-01 challenge
(`acme_dns cloudflare` in the global block), so nothing else is served under the
prefix.

The other two OAuth paths need no stanza of their own. `/agent/oauth/token` is
called by a machine with no session and rides the ungated block above;
`/api/oauth/authorize` is opened by your browser and rides `/api/*`, where
`oauth2_auth` is what proves who is pressing the button.

`handle` sorts by path specificity exactly as `/api/*` and `/term/*` do, so
neither stanza needs a named matcher and where they sit in the block does not
matter.

**3. Reload Caddy** and run the curls. `$KASTEN_TOKEN` is a token minted at
`/tokens` in the notebook.

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://kasten.pgoell.com/agent/notes
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' https://kasten.pgoell.com/agent/notes
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KASTEN_TOKEN" https://kasten.pgoell.com/agent/notes
```

`401`, `401`, `200`.

* `302` on any of them means the `/agent/*` stanza did not take and the request
  went to the sign-in page.
* **`200` on the first means the gate is not running. Stop and roll the Caddy
  change back.** That is the one answer here that is an incident rather than a
  misconfiguration.
* `404` on the third means the backend predates the release that carries
  `/agent/`.

Then the metadata documents, which no token touches:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://kasten.pgoell.com/.well-known/oauth-protected-resource
curl -s -o /dev/null -w '%{http_code}\n' https://kasten.pgoell.com/.well-known/oauth-protected-resource/agent/mcp
curl -s -o /dev/null -w '%{http_code}\n' https://kasten.pgoell.com/.well-known/oauth-authorization-server
curl -s -o /dev/null -w '%{http_code}\n' https://kasten.pgoell.com/.well-known/openid-configuration
```

`200`, `200`, `200`, `404`. Claude reads the second spelling, off the
`resource_metadata` in the `401` header; ChatGPT probes the first.

* `302` on any of them means the `/.well-known/*` stanza did not take. That is
  the state the host is in before the change, and it ends a connector flow.
* `404` on the first three means the backend predates the release that carries
  the OAuth server.
* `200` on the fourth means something else on this host claims the prefix. The
  backend serves no OpenID metadata.

**4. Mint a token at `/tokens` and revoke it**, which proves `os.replace` works
against the mounted directory. A mint that fails means step 1 mounted the file
rather than the directory.

## Open the chat route

Do this once, for prod, before or after the release that carries the chat
runner. Until it is done the chat pane says it could not reach the runner
and nothing else changes.

**1. Add the stanza** to the `kasten.pgoell.com` block in
`~/Code/server-infra/caddy/Caddyfile`, beside `handle /term/*`. Dev needs
none: its vite server proxies `/chat` to `kasten-shell-dev` itself, through
the route the frontend already has.

```
# The chat runner: Claude Code with a shell in the vault, running tools
# unasked. Never without oauth2_auth, for the reason /term/* never is.
handle /chat/* {
    import oauth2_auth
    reverse_proxy kasten-shell-prod:7682
}
```

**2. Widen the matcher** in both blocks. The runner marks its stream
`no-transform`, which Caddy's `encode` honours, so this is the second lock and
not the first:

```
@compressible not path /api/events /chat/events
```

**3. Validate and reload**, as in [Caddy](#2-caddy) above, then run the proof
below.

**4. Sign Claude Code in**, if the shell container never was: open a terminal
pane, run `claude`, sign in. The chat runner uses that login. The first start
of the new image installs the Agent SDK into the home volume, which needs the
network and shows in `docker logs kasten-shell-prod`.

In dev, `mise run dev:up` rebuilds `kasten-shell-dev` with the runner in it,
and that container wants its own sign-in.

## Prove the shell is not exposed

Run this after any change to compose or the Caddyfile. Two things stand between
the shell container and the internet and there is no third, so both are worth
proving rather than assuming.

On the box:

```sh
docker inspect -f '{{json .NetworkSettings.Ports}}' kasten-shell-prod   # expect {}
ss -ltn 'sport = :7681'                                                # expect no listener
ss -ltn 'sport = :7682'                                                # expect no listener
```

From anywhere, with no oauth2 cookie:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==' \
  -H 'Sec-WebSocket-Protocol: tty' \
  https://kasten.pgoell.com/term/ws
```

`302` is right: oauth2-proxy sending an unauthenticated caller to the sign-in
page. `101` means the gate is missing and the internet has a shell. `400` or
`404` means ttyd answered directly, which is the same hole wearing a different
number. `502` means the container is not up yet, which is expected before the
first release ships the image and is not the same answer as `302`.

The chat runner sits behind the same gate and gets the same proof:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' -m 5 https://kasten.pgoell.com/chat/events
```

`302` is right again. `200` means the gate is missing and the internet has an
agent with a shell. `404` before [Open the chat route](#open-the-chat-route) is
done is the frontend answering, which is closed, not open.

Run both against `kasten-dev.pgoell.com` too, and check that
`grep -A4 'handle /term\|handle /chat' caddy/Caddyfile` prints
`import oauth2_auth` under every one of them.

## Look at dev in a browser

`kasten-dev.pgoell.com` is behind the OAuth gate, so a browser on the box
cannot reach it without signing in. For a quick visual check, load
`http://127.0.0.1:5173` instead: the dev ports are published on loopback for
exactly this.

One known wart. Vite's HMR socket is pinned to the public host so hot reload
survives Caddy, and that host is OAuth-gated, so loading via localhost logs a
failed websocket handshake in the console. Rendering is unaffected. Use the
public URL when you want working hot reload.

Vite blocks unknown `Host` headers and its HMR client guesses the wrong
websocket URL behind a TLS terminator. `KASTEN_DEV_PUBLIC_HOST` in the frontend
unit fixes both. `compose.dev.yml` sets it to `kasten-dev.pgoell.com` unless the
shell running compose sets another name. Unset it and vite goes back to plain
localhost behaviour.

The dev compose files take two more such overrides, both defaulting to this
box: `KASTEN_NETWORK` (`web`) for the external network, and `KASTEN_DB_PORT`
(`5434`) for the dev Postgres's host port.

## Remove the service worker

The frontend ships `/sw.js`, a worker that opens the installed app with no
signal. To remove it, ship a worker that removes itself. Put this in
`frontend/sw/sw.js`, delete the line `import "./lib/service-worker";` from
`frontend/src/main.tsx` in the same release (or every load registers the
self-removing worker again), and cut the release. The browser fetches `/sw.js`
through oauth2-proxy, so a phone picks it up only when it opens the app online
with a live session: sign in first if it has expired. It takes over at once, deletes every cache, unregisters, and
reloads every open window, which then loads from the network with no worker:

```js
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) {
        client.navigate(client.url);
      }
    })(),
  );
});
```

The build plugin expects the `__PRECACHE__` and `__VERSION__` placeholders and
stops with an error without them, so keep both in a comment at the top of that
file.

A plain revert does not remove the worker. A build without it has no
`/sw.js`, and nginx answers that path with `404`, but a `404` does not
unregister a worker: checked in Chromium, the update fails and the old worker
stays in control. It does little harm there, as it fetches every page from the
network first and so serves the new release, but it keeps its cache.

Check what prod serves:

```sh
docker exec kasten-frontend-prod wget -S -O- http://127.0.0.1:3000/sw.js
```

`200` with `Content-Type: application/javascript` and the worker's code is a
live worker, or the one that removes itself. `404` means no worker ships,
and phones that had one keep it.

## Related

* [Two environments](/explanation/environments.md): why dev and prod are built in opposite ways, and the constraints this box imposes
* [Self-host kasten](/how-to/self-host-kasten.md): the whole stack on one machine, with its own Caddy and login
* [Cut a release](cut-a-release.md): the version, the tag and the workflow that deploys them
* [Run the checks](run-the-checks.md): the linters and tests, and clearing a stale `.container/node_modules`
* [Configuration](/reference/configuration.md): every `KASTEN_` setting the env files carry
* [The agent boundary](/explanation/the-agent-boundary.md): what the one ungated block is holding
* [Connect an agent](/how-to/connect-an-agent.md): what to point at the door once it is open
