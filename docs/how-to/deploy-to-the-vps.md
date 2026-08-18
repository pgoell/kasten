---
type: How-to Guide
title: Deploy to the VPS
description: Bootstrap dev and prod on the Hetzner box, deploy day to day, and prove the shell is still behind its gate.
tags: [deploy, vps, caddy, postgres, ci]
status: stable
---

# Deploy to the VPS

Two environments run on the same Hetzner box. This page is the runbook for
both. Why they are built in opposite ways is in
[Two environments](/explanation/environments.md).

| | dev | prod |
|---|---|---|
| URL | `kasten-dev.pascalkraus.com` | `kasten.pascalkraus.com` |
| What runs | uvicorn `--reload` and vite dev, in containers with the tree bind-mounted | Images from GHCR, in containers |
| Who deploys | you, on the box | GitHub Actions only |
| Trigger | saving a file | publishing a GitHub release |
| Built where | nowhere, it runs from source | `ubuntu-latest` in CI |
| Database | `kasten_dev`, kasten's own compose Postgres on `:5434` | `kasten_prod`, on the shared `postgres` container |
| Vault | `/home/pascal/Code/kasten/vault` | `/home/pascal/kasten-data/vault` |

## First-time setup

Prerequisites already on the VPS: Caddy, the shared Postgres, and oauth2-proxy
running from `/home/pascal/Code/server-infra/`.

### 1. DNS

Two proxied A records in Cloudflare pointing at `162.55.81.13`: `kasten` and
`kasten-dev`. There is no wildcard on `pascalkraus.com`, so both are needed.

### 2. Caddy

Add the two site blocks to
`/home/pascal/Code/server-infra/caddy/Caddyfile`, then validate before
reloading so a typo cannot take down the other sites:

```sh
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Both blocks must carry the request matcher that leaves `/api/events`
uncompressed, and the `handle /term/*` route that carries `import oauth2_auth`.
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

### 6. Self-hosted runner

Runners are per repository for a user account, so the Klassenzeit and website
runners on this box cannot serve kasten. Add a third:

```sh
./scripts/setup-runner.sh
```

It unpacks the runner, registers it as `iuno-kasten`, installs a systemd user
unit, and waits for GitHub to report it online. No sudo: lingering is already
enabled for pascal, so a user unit survives logout and reboot. Re-running it is
safe, it skips whatever is already done.

The runner inherits pascal's group membership, which includes `docker`, so the
deploy job can drive compose.

To match the other two runners as system services instead, register with
`config.sh` as the script does, then `sudo ./svc.sh install pascal && sudo
./svc.sh start` in `~/actions-runner-kasten`.

Check status any time:

```sh
gh api /repos/pgoell/kasten/actions/runners --jq '.runners[] | .name + " " + .status'
```

### 7. Dev services

```sh
mise run dev:up
```

## Day to day

**Dev.** Edit files. uvicorn and vite reload on their own, because the working
tree is bind-mounted into both containers. `mise run dev:restart` after a
dependency change, `mise run dev:logs` when something looks wrong,
`mise run dev:status` to see what is up.

**Prod.** Cut a GitHub release, following [Cut a release](cut-a-release.md):
pick the version off the commits, bump `backend/pyproject.toml`, then tag. The
workflow checks the tag against that version and stops there if they disagree,
then builds all three images on `ubuntu-latest`, tags them with the release tag
and `latest`, pushes to GHCR, and the self-hosted runner pulls, runs migrations
as a one-shot container, restarts the services, and waits for the backend
healthcheck.

**Rollback.** Run the `Deploy production` workflow by hand with the `tag` input
set to an older release. It skips the build and redeploys that tag.

## Open the agent door

Do this once, and only after the release carrying the token gate is live. A
backend that predates it answers `404` to everything under `/agent/`, never the
vault, so the order is safe either way, but there is no reason to open a door
onto a room that is not built.

Nothing in the kasten repository can test any of this. The Caddyfile lives in
`~/Code/server-infra`, which has no pipeline, so the three curls below are the
check and there is no automated one behind them.

**1. Make the host directory.** Beside the vault, never inside it.

```sh
mkdir -p /home/pascal/kasten-data/agent
chown 1000:1000 /home/pascal/kasten-data/agent
```

The directory is what `deploy/compose.yaml` mounts, never `tokens.json` itself.
A bind-mounted file is a mount point and `os.replace` over one fails with
`EBUSY`, so mounting the file would break every mint and every revoke in
production while passing every test there is.

**2. Add the Caddy stanza** to the `kasten.pascalkraus.com` block in
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

`handle` sorts by path specificity exactly as `/api/*` and `/term/*` do, so this
needs no named matcher and has no ordering hazard against them.

**3. Reload Caddy** and run the three curls. `$KASTEN_TOKEN` is a token minted
at `/tokens` in the notebook.

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://kasten.pascalkraus.com/agent/notes
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer wrong' https://kasten.pascalkraus.com/agent/notes
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $KASTEN_TOKEN" https://kasten.pascalkraus.com/agent/notes
```

`401`, `401`, `200`.

* `302` on any of them means the stanza did not take and the request went to the
  sign-in page.
* **`200` on the first means the gate is not running. Stop and roll the Caddy
  change back.** That is the one answer here that is an incident rather than a
  misconfiguration.
* `404` on the third means the backend predates the release that carries
  `/agent/`.

**4. Mint a token at `/tokens` and revoke it**, which proves `os.replace` works
against the mounted directory. A mint that fails means step 1 mounted the file
rather than the directory.

## Prove the shell is not exposed

Run this after any change to compose or the Caddyfile. Two things stand between
the shell container and the internet and there is no third, so both are worth
proving rather than assuming.

On the box:

```sh
docker inspect -f '{{json .NetworkSettings.Ports}}' kasten-shell-prod   # expect {}
ss -ltn 'sport = :7681'                                                # expect no listener
```

From anywhere, with no oauth2 cookie:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==' \
  -H 'Sec-WebSocket-Protocol: tty' \
  https://kasten.pascalkraus.com/term/ws
```

`302` is right: oauth2-proxy sending an unauthenticated caller to the sign-in
page. `101` means the gate is missing and the internet has a shell. `400` or
`404` means ttyd answered directly, which is the same hole wearing a different
number. `502` means the container is not up yet, which is expected before the
first release ships the image and is not the same answer as `302`.

Run it against `kasten-dev.pascalkraus.com` too, and check that
`grep -A4 'handle /term' caddy/Caddyfile` prints `import oauth2_auth` for both
hosts rather than one.

## Look at dev in a browser

`kasten-dev.pascalkraus.com` is behind the OAuth gate, so a browser on the box
cannot reach it without signing in. For a quick visual check, load
`http://127.0.0.1:5173` instead: the dev ports are published on loopback for
exactly this.

One known wart. Vite's HMR socket is pinned to the public host so hot reload
survives Caddy, and that host is OAuth-gated, so loading via localhost logs a
failed websocket handshake in the console. Rendering is unaffected. Use the
public URL when you want working hot reload.

Vite blocks unknown `Host` headers and its HMR client guesses the wrong
websocket URL behind a TLS terminator. `KASTEN_DEV_PUBLIC_HOST` in the frontend
unit fixes both. Unset it and vite goes back to plain localhost behaviour.

## Related

* [Two environments](/explanation/environments.md) - why dev and prod are built in opposite ways, and the constraints this box imposes
* [Cut a release](cut-a-release.md) - the version, the tag and the workflow that deploys them
* [Run the checks](run-the-checks.md) - the linters and tests, and clearing a stale `.container/node_modules`
* [Configuration](/reference/configuration.md) - every `KASTEN_` setting the env files carry
* [The agent boundary](/explanation/the-agent-boundary.md) - what the one ungated block is holding
* [Connect an agent](/how-to/connect-an-agent.md) - what to point at the door once it is open
