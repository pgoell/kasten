# Environments

Two environments on the Hetzner VPS, deployed in deliberately different ways.

| | dev | prod |
|---|---|---|
| URL | `kasten-dev.pascalkraus.com` | `kasten.pascalkraus.com` |
| What runs | uvicorn `--reload` and vite dev, in containers with the tree bind-mounted | Images from GHCR, in containers |
| Who deploys | you, on the box | GitHub Actions only |
| Trigger | saving a file | publishing a GitHub release |
| Built where | nowhere, it runs from source | `ubuntu-latest` in CI |
| Database | `kasten_dev`, kasten's own compose Postgres on `:5434` | `kasten_prod`, on the shared `postgres` container |
| Vault | `/home/pascal/Code/kasten/vault` | `/home/pascal/kasten-data/vault` |

The point of the split: dev reloads the moment you save a file, and production is never built on the machine that serves it. Nothing about dev touches GitHub Actions, and nothing about prod is built by hand.

Both hostnames sit behind the shared oauth2-proxy, which is locked to a single GitHub user. kasten itself contains no auth code.

## The vault is the only irreplaceable thing here

Postgres holds a derived index and can be rebuilt from the vault at any time. The vault cannot be rebuilt from anything. So:

- It is a bind mount to a host path, never a named volume, and it lives outside the repo and outside every container lifecycle.
- Dev and prod never share a directory. A dev bug that rewrites files would otherwise eat your real notes.
- Make the prod vault a jj repo, colocated with git, and push it on a schedule. The backend records every save into it, so that is file history and backup in one, and it costs nothing because the vault is already plain markdown. Without it saving still works and nothing is kept, so an overwrite is final.

## First-time setup

Prerequisites already on the VPS: Caddy, the shared Postgres, and oauth2-proxy running from `/home/pascal/Code/server-infra/`.

**1. DNS.** Two proxied A records in Cloudflare pointing at `162.55.81.13`: `kasten` and `kasten-dev`. There is no wildcard on `pascalkraus.com`, so both are needed.

**2. Caddy.** Add the two site blocks to `/home/pascal/Code/server-infra/caddy/Caddyfile`, then validate before reloading so a typo cannot take down the other sites:

```sh
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

**3. Postgres.** Only production needs a role on the shared container. Dev uses kasten's own compose Postgres, because the shared one publishes no host port and the dev backend runs on the host rather than in a container.

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

Put that password into `KASTEN_DATABASE_URL` in `/home/pascal/kasten-deploy/.env.prod`. For dev, `mise run db:up` is the whole story and the defaults in `config.py` already point at it.

**4. Vault directories.**

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

**5. Prod env file.** Copy the template and fill in the password from step 3:

```sh
mkdir -p /home/pascal/kasten-deploy
cp deploy/.env.prod.example /home/pascal/kasten-deploy/.env.prod
```

**6. Self-hosted runner.** Runners are per repository for a user account, so the Klassenzeit and website runners on this box cannot serve kasten. Add a third:

```sh
./scripts/setup-runner.sh
```

It unpacks the runner, registers it as `iuno-kasten`, installs a systemd user unit, and waits for GitHub to report it online. No sudo: lingering is already enabled for pascal, so a user unit survives logout and reboot. Re-running it is safe, it skips whatever is already done.

The runner inherits pascal's group membership, which includes `docker`, so the deploy job can drive compose.

To match the other two runners as system services instead, register with `config.sh` as the script does, then `sudo ./svc.sh install pascal && sudo ./svc.sh start` in `~/actions-runner-kasten`.

Check status any time:

```sh
gh api /repos/pgoell/kasten/actions/runners --jq '.runners[] | .name + " " + .status'
```

**7. Dev services.**

```sh
mise run dev:up
```

## Day to day

**Dev.** Edit files. uvicorn and vite reload on their own, because the working tree is bind-mounted into both containers. `mise run dev:restart` after a dependency change, `mise run dev:logs` when something looks wrong, `mise run dev:status` to see what is up.

**Prod.** Cut a GitHub release. The workflow builds both images on `ubuntu-latest`, tags them with the release tag and `latest`, pushes to GHCR, then the self-hosted runner pulls, runs migrations as a one-shot container, restarts the services, and waits for the backend healthcheck.

**Rollback.** Run the `Deploy production` workflow by hand with the `tag` input set to an older release. It skips the build and redeploys that tag.

## Gotchas worth knowing

**The dev servers run in containers, not on the host.** That is not a style choice. This box firewalls Docker bridge traffic to arbitrary host ports: from inside a container, ports 22, 80 and 443 on the host connect, and everything else times out. So Caddy cannot reach a dev server bound to the host, no matter which address it binds. On the `web` network it reaches them by name, which needs no firewall rule and cannot break when one changes.

**Both dev containers run as uid 1000, not root.** The backend writes into the bind-mounted vault, and a root-owned note on the host needs sudo to edit or back up. The same applies in production, hence `user: "1000:1000"` in `deploy/compose.yaml`. This is also why `dev:up` creates `.container/venv` and `.container/node_modules` before starting: they are bind mounts, and Docker would otherwise create them as root and leave the containers unable to write.

Container dependency trees live in `.container/`, deliberately separate from the host's `.venv` and `frontend/node_modules`. Sharing them breaks both: a venv holds absolute paths that are wrong inside the container.

**`.container/node_modules` outlives a restart, and a stale one breaks dev quietly.** It is the tree the frontend container installs into, so `dev:restart` cannot clear it. After the move from pnpm to bun it held both layouts at once, and dev served the page with a 500 on the stylesheet, `ENOENT` on a path under `node_modules/.pnpm/`. Wipe it and let the container reinstall. [Run the checks](../docs/how-to/run-the-checks.md) has the commands, and the reason you recreate the directory yourself rather than letting Docker do it.

**`/api/events` must not be compressed.** It is a server-sent event stream that stays open and pushes vault changes as they happen. A reverse proxy that gzips it buffers the whole response instead, so the browser holds a connection that never delivers a byte and never errors either: it reads as healthy, nothing is logged, and nobody works it out from the behaviour. Caddy's `reverse_proxy` flushes `text/event-stream` on its own, so `encode` is the only thing on the path that can do this, and the fix is a request matcher rather than a response one, because `not` inside `encode` is rejected as an unrecognised response matcher:

```caddyfile
@compressible not path /api/events
encode @compressible gzip
```

Both kasten site blocks in `/home/pascal/Code/server-infra/caddy/Caddyfile` carry it, and everything else stays compressed. That file lives in another repo, which is why the requirement is written down here.

**Every published port binds `127.0.0.1` explicitly.** Docker publishes ports with DNAT rules that ufw never sees, so a bare `"5434:5432"` faces the open internet regardless of firewall rules. Do not drop the prefix.

## Looking at dev in a browser

`kasten-dev.pascalkraus.com` is behind the OAuth gate, so a browser on the box cannot reach it without signing in. For a quick visual check, load `http://127.0.0.1:5173` instead: the dev ports are published on loopback for exactly this.

One known wart. Vite's HMR socket is pinned to the public host so hot reload survives Caddy, and that host is OAuth-gated, so loading via localhost logs a failed websocket handshake in the console. Rendering is unaffected. Use the public URL when you want working hot reload.

Vite blocks unknown `Host` headers and its HMR client guesses the wrong websocket URL behind a TLS terminator. `KASTEN_DEV_PUBLIC_HOST` in the frontend unit fixes both. Unset it and vite goes back to plain localhost behaviour.

The deploy job refuses to start if `.env.prod` or the vault directory is missing, rather than letting compose invent an empty vault and bring the notebook up blank.
