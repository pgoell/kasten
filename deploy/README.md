# Environments

Two environments on the Hetzner VPS, deployed in deliberately different ways.

| | dev | prod |
|---|---|---|
| URL | `kasten-dev.pascalkraus.com` | `kasten.pascalkraus.com` |
| What runs | uvicorn `--reload` and vite dev, as systemd user units | Images from GHCR, in containers |
| Who deploys | you, on the box | GitHub Actions only |
| Trigger | `mise run dev:restart` | publishing a GitHub release |
| Built where | nowhere, it runs from source | `ubuntu-latest` in CI |
| Database | `kasten_dev` | `kasten_prod` |
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

**3. Postgres roles and databases.** On the VPS:

```sh
cd /home/pascal/Code/server-infra
source .env.local            # POSTGRES_USER and POSTGRES_PASSWORD
PROD_PW=$(openssl rand -base64 24)
DEV_PW=$(openssl rand -base64 24)
docker exec -i postgres psql -U "$POSTGRES_USER" <<SQL
CREATE ROLE kasten_prod LOGIN PASSWORD '${PROD_PW}';
CREATE DATABASE kasten_prod OWNER kasten_prod;
CREATE ROLE kasten_dev  LOGIN PASSWORD '${DEV_PW}';
CREATE DATABASE kasten_dev  OWNER kasten_dev;
SQL
echo "prod: ${PROD_PW}"
echo "dev:  ${DEV_PW}"
```

Put the prod password into `KASTEN_DATABASE_URL` in `/home/pascal/kasten-deploy/.env.prod`, and the dev one into `backend/.env`.

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
mise run dev:install
```

## Day to day

**Dev.** Edit files. uvicorn and vite reload on their own. `mise run dev:restart` after changing dependencies or anything outside the reload watch, `mise run dev:logs` when something looks wrong.

**Prod.** Cut a GitHub release. The workflow builds both images on `ubuntu-latest`, tags them with the release tag and `latest`, pushes to GHCR, then the self-hosted runner pulls, runs migrations as a one-shot container, restarts the services, and waits for the backend healthcheck.

**Rollback.** Run the `Deploy production` workflow by hand with the `tag` input set to an older release. It skips the build and redeploys that tag.

## Gotchas worth knowing

The dev servers bind `172.18.0.1`, the gateway of the `web` bridge network, not `0.0.0.0`. Caddy reaches them from inside that network and the public internet cannot, so no firewall rule is doing the work. If the `web` network is ever recreated the subnet may change; re-derive it with `docker network inspect web --format '{{(index .IPAM.Config 0).Gateway}}'` and update both unit files.

Vite blocks unknown `Host` headers and its HMR client guesses the wrong websocket URL behind a TLS terminator. `KASTEN_DEV_PUBLIC_HOST` in the frontend unit fixes both. Unset it and vite goes back to plain localhost behaviour.

The deploy job refuses to start if `.env.prod` or the vault directory is missing, rather than letting compose invent an empty vault and bring the notebook up blank.
