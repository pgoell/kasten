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
- Make the prod vault a git repo and push it on a schedule. That is backup and file history in one, and it costs nothing because the vault is already plain markdown.

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
git -C /home/pascal/kasten-data/vault init      # backup and history
mkdir -p /home/pascal/Code/kasten/vault          # dev, already gitignored
```

**5. Prod env file.** Copy the template and fill in the password from step 3:

```sh
mkdir -p /home/pascal/kasten-deploy
cp deploy/.env.prod.example /home/pascal/kasten-deploy/.env.prod
```

**6. Self-hosted runner.** Runners are per repository for a user account, so the Klassenzeit runner cannot serve this repo. Register a third one on the same box:

```sh
TOKEN=$(gh api -X POST /repos/pgoell/kasten/actions/runners/registration-token --jq .token)
mkdir -p ~/actions-runner-kasten && cd ~/actions-runner-kasten
tar xzf ~/actions-runner/actions-runner-linux-x64-2.321.0.tar.gz
./config.sh --url https://github.com/pgoell/kasten --token "$TOKEN" \
            --name iuno-kasten --labels self-hosted,Linux,X64 --unattended
sudo ./svc.sh install pascal && sudo ./svc.sh start
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

**Every published port binds `127.0.0.1` explicitly.** Docker publishes ports with DNAT rules that ufw never sees, so a bare `"5434:5432"` faces the open internet regardless of firewall rules. Do not drop the prefix.

## Looking at dev in a browser

`kasten-dev.pascalkraus.com` is behind the OAuth gate, so a browser on the box cannot reach it without signing in. For a quick visual check, load `http://127.0.0.1:5173` instead: the dev ports are published on loopback for exactly this.

One known wart. Vite's HMR socket is pinned to the public host so hot reload survives Caddy, and that host is OAuth-gated, so loading via localhost logs a failed websocket handshake in the console. Rendering is unaffected. Use the public URL when you want working hot reload.

Vite blocks unknown `Host` headers and its HMR client guesses the wrong websocket URL behind a TLS terminator. `KASTEN_DEV_PUBLIC_HOST` in the frontend unit fixes both. Unset it and vite goes back to plain localhost behaviour.

The deploy job refuses to start if `.env.prod` or the vault directory is missing, rather than letting compose invent an empty vault and bring the notebook up blank.
