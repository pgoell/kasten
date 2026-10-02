---
type: How-to Guide
title: Self-host kasten
description: Run kasten on one machine of your own, amd64 or arm64, with Caddy doing TLS and a login gate of basic auth, oauth2-proxy or Tailscale in front.
tags: [deploy, self-host, caddy, oauth2-proxy, tailscale]
status: stable
---

# Self-host kasten

`deploy/selfhost/` holds a whole kasten in one compose file: the backend, the
frontend, the shell, and Caddy in front of them doing TLS and the login. There
is no database to run; the backend reads and writes the vault and nothing else.

You need a Linux machine with Docker and the compose plugin (2.24 or later), on
amd64 or arm64. arm64 images exist from the first release after 0.29.0.

## 1. Get the files

```sh
git clone https://github.com/pgoell/kasten.git
cd kasten/deploy/selfhost
cp .env.example .env
```

Everything from here on happens in `deploy/selfhost/`, and every setting is a
line in `.env`. The example lists them all.

## 2. Pick a name and a gate

Set `KASTEN_DOMAIN` to the name the notebook will answer on, and `KASTEN_GATE`
to one of the three logins below. Compose refuses to start with either missing,
and Caddy refuses a gate it has no file for, so a stack with no login does not
come up at all.

Every route asks for the login except two. `/agent/*` checks a bearer token
minted at `/tokens`, and `/.well-known/*` serves the documents an agent
connector reads before it has one. [The agent boundary](/explanation/the-agent-boundary.md)
says why those two can stand open.

### Basic auth

The simplest: one user name and password, asked for by the browser.

```sh
docker run --rm -it caddy:2.11.4-alpine caddy hash-password
```

Type the password twice and put the hash in `.env`, in single quotes, because
it is full of `$` and compose would read those as variables:

```sh
KASTEN_GATE=basicauth
KASTEN_BASIC_AUTH_USER=you
KASTEN_BASIC_AUTH_HASH='$2a$14$...'
```

`KASTEN_DOMAIN` needs a DNS record pointing at the machine, and ports 80 and
443 open to the internet, so Caddy can get a certificate from Let's Encrypt.

### oauth2-proxy

Sign in with GitHub, or with any OpenID Connect provider.

1. Register an OAuth app with the provider. Its callback URL is
   `https://<KASTEN_DOMAIN>/oauth2/callback`.
2. In `.env`, uncomment `COMPOSE_PROFILES=oauth2-proxy`, set
   `KASTEN_GATE=oauth2-proxy`, and fill in `OAUTH2_PROXY_CLIENT_ID`,
   `OAUTH2_PROXY_CLIENT_SECRET` and a cookie secret from
   `openssl rand -base64 32 | tr -- '+/' '-_'`.
3. For a provider other than GitHub, set `OAUTH2_PROXY_PROVIDER=oidc` and
   `OAUTH2_PROXY_OIDC_ISSUER_URL`.
4. List who may sign in, one email address a line:

   ```sh
   echo you@example.com > allowed-emails.txt
   ```

Only the addresses in that file get in. Without it oauth2-proxy does not start,
and every gated route answers `502` rather than opening.

DNS and ports are as for basic auth.

### Tailscale

No public port at all: the notebook is reachable from your tailnet and nowhere
else. The machine must already be on your tailnet, with MagicDNS and HTTPS
certificates turned on in the Tailscale admin console.

```sh
KASTEN_GATE=tailscale
KASTEN_DOMAIN=<machine>.<tailnet>.ts.net
KASTEN_BIND_ADDRESS=<the address from `tailscale ip -4`>
COMPOSE_FILE=compose.yaml:compose.tailscale.yaml
```

`compose.tailscale.yaml` mounts the host's tailscaled socket into Caddy, which
asks it for the `ts.net` certificate. Binding to the tailnet address keeps the
ports off every other interface, and Caddy also drops any request to a gated
route that does not come from a Tailscale address.

An agent connector on claude.ai or chatgpt.com cannot reach a tailnet, so this
gate rules those out. Claude Code or codex on a machine in the tailnet works.

## 3. Make the data directory

The vault and the agent token store are bind mounts under `KASTEN_DATA_DIR`,
`./data` unless you change it. The backend and shell run as `KASTEN_UID` and
`KASTEN_GID`, 1000 unless you change them, so the directories must belong to
that user or the containers cannot write a note:

```sh
mkdir -p data/vault data/agent
id -u; id -g       # set KASTEN_UID and KASTEN_GID to these if they are not 1000
```

## 4. Give the vault a history

The backend records every save in a jj repo in the vault. Make one, with the
name its changes go under, using the jj inside the backend image:

```sh
docker compose run --rm --no-deps backend jj git init --colocate /vault
docker compose run --rm --no-deps backend jj -R /vault config set --repo user.name "Your Name"
docker compose run --rm --no-deps backend jj -R /vault config set --repo user.email "you@example.com"
```

Skip this and kasten still saves notes, with a warning at startup and no way
back to an earlier version.

If you point `KASTEN_DATA_DIR` at a vault you already keep in another tool,
read the warning at the top of [Configuration](/reference/configuration.md)
first, and put `KASTEN_TYPE_BACKFILL=false` in a `backend.env` file beside
`.env`. That file is where every backend setting goes; compose hands it to the
backend alone, so the gate's secrets never reach it.

## 5. Start it

```sh
docker compose up -d
docker compose ps
```

Open `https://<KASTEN_DOMAIN>`, log in, and the notebook is there.

## 6. Check the gate

From a machine with no session, every one of these must be refused:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<KASTEN_DOMAIN>/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://<KASTEN_DOMAIN>/agent/notes
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==' \
  -H 'Sec-WebSocket-Protocol: tty' \
  https://<KASTEN_DOMAIN>/term/ws
```

With basic auth, `401` on all three. With oauth2-proxy, `302` on the first and
third and `401` on the second. With Tailscale, run them from outside the
tailnet: no connection at all.

**`101` on the third means the shell is open to whoever can reach the port.
Stop the stack** (`docker compose down`) and check that `KASTEN_GATE` and the
`/term/*` route in the `Caddyfile` are as shipped.

## Upgrade

```sh
docker compose pull
docker compose up -d
```

`KASTEN_IMAGE_TAG=latest` follows every release. Set it to a version number to
stay on one, and change it when you choose to move.

## Related

* [Configuration](/reference/configuration.md): every backend setting, for `backend.env`
* [Connect an agent](/how-to/connect-an-agent.md): mint a token and point an agent at the vault
* [Recover an earlier version of a note](/how-to/recover-an-earlier-version.md): what the jj history in step 4 is for
* [Deploy to the VPS](/how-to/deploy-to-the-vps.md): the original deployment, which shares a Caddy and an oauth2-proxy with other sites
