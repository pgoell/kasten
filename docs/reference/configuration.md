---
type: Reference
title: Configuration
description: Every backend setting, its default, where the values come from, what the shell container reads for its commit identity, the uid it runs as and its first-start install of Claude Code, the variables the compose files read, and the self-host stack's own.
resource: backend/src/kasten_backend/config.py
tags: [config, environment, backend]
status: stable
---

# Configuration

Settings are read from the environment and from a `.env` file in the
directory the process starts in, in that order of precedence. `mise run dev`
starts at the repo root and reads `./.env`; the `db:` tasks start in
`backend/` and read `backend/.env`. Every field takes the `KASTEN_` prefix.
Unknown variables are ignored.

Every value below is already the default, so a fresh clone runs without a
`.env` file at all. `backend/.env.example` exists to give your own overrides an
obvious home.

The backend image changes two of them. It sets `KASTEN_VAULT_PATH=/vault` and
`KASTEN_TOKENS_PATH=/agent-data/tokens.json`, the mount points
`deploy/compose.yaml` uses, because the relative defaults would resolve under
`/app` inside the container and vanish with it. An env file still wins over
both.

> **Warning: an existing vault.** At every startup the backend writes
> `type: Note` into the frontmatter of every note that has no `type`, in one jj
> change. On a vault kasten made, that is what keeps it an
> [OKF bundle](/explanation/okf-in-the-vault.md). On a vault you already keep in
> Obsidian or another tool, it rewrites most of your notes on the first boot,
> and a sync tool will carry that rewrite to every device. Set
> [`KASTEN_TYPE_BACKFILL=false`](#kasten_type_backfill) before the first start
> if you do not want that, and set the folder settings below to the folders
> your vault already has.

## KASTEN_DATABASE_URL

```
postgresql+psycopg://kasten:kasten@localhost:5434/kasten_dev
```

The SQLAlchemy URL for the derived index. It never holds note content.

Only Alembic reads it today. No module the running backend imports opens a
connection, which is why the [self-host stack](/how-to/self-host-kasten.md)
ships no Postgres and leaves this at its default.

Dev points at kasten's own compose Postgres, published on the host at 5434. It
cannot use the shared `postgres` container on the VPS: that one publishes no
host port, and the dev backend runs on the host rather than in a container.

## KASTEN_ARCHIVE_PATH

```
98 Archive
```

The folder holding what is finished, which `GET /api/search` and
`GET /api/todos` walk past unless the request asks for it. The editor reads it
from [`GET /api/layout`](/reference/http-api.md#get-apilayout) and hides it from
the tree and the todo list the same way.

An ordinary folder in the vault, and this name is the only thing kasten knows
about it. Nothing writes into it, nothing moves anything into it, and a note in
it opens, saves, renames and deletes like any other.

`GET /api/files` is deliberately never filtered by it. That listing is what
resolves a `[[wikilink]]`, and a link to an archived note reading as a dead one
would make a second note in the inbox out of a note the vault already holds.

Set it to a name no folder has and nothing is left out of anything.

## The vault's folders

Five settings name the folders kasten files into or looks in. Each is a path
from the vault root, and each default is the folder one vault already used.
[`GET /api/layout`](/reference/http-api.md#get-apilayout) serves them to the
editor, and the startup notes and the agent instructions spell them as set.

| Setting | Default | What goes there |
| --- | --- | --- |
| `KASTEN_INBOX_PATH` | `00 Inbox` | a note made from a `[[link]]` nothing answers to, a clipped page, an imported markdown file; books in `02 Books` and documents in `02 Documents` under it; an agent's notes in `00 Agent` under it |
| `KASTEN_PERIODIC_PATH` | `01 Periodic` | the periodic notes, in `00 Daily`, `01 Weekly`, `02 Monthly`, `03 Quarterly` and `04 Yearly` under it, and the dump |
| `KASTEN_IMAGES_PATH` | `99 Misc/02 Assets/01 Images` | an image pasted or dropped into a note |
| `KASTEN_CONFIG_PATH` | `99 Misc/01 Config` | `reading-this-vault.md` and `todo-views.md`, and the ontology and three agent guides in `01 Agents` under it |
| `KASTEN_ARCHIVE_PATH` | `98 Archive` | see [its own section](#kasten_archive_path) |

Only the parent folders are settings. The subfolders under them keep their
names, so one setting moves a whole group and the list stays short.

The startup notes are written into `KASTEN_CONFIG_PATH` only when missing, so
changing it on a running vault writes a fresh set in the new place and leaves
the old ones where they are. Move them yourself if you want to keep your edits.

Changing a folder setting moves nothing. Notes already in the old folder stay
there, and the links to them keep working.

## KASTEN_TYPE_BACKFILL

Whether startup writes `type: Note` into every note that has no `type`.

| | |
| --- | --- |
| Default | `true` |
| Read by | startup |

The pass writes in one jj change, keeps each note's line endings, and leaves
`modified` alone. Off, a note without a type stays as it is; a note saved from
the editor still gains one, because a save stamps the block.

Turn it off before the first start on a vault another tool keeps. The warning
at the top of this page says why.

## KASTEN_FLASHCARDS_PATH

Where [an imported Anki deck](/how-to/import-an-anki-deck.md) is written.

| | |
| --- | --- |
| Default | `03 Flashcards` |
| Read by | `POST /api/anki` |

A setting rather than a constant for the reason `KASTEN_ARCHIVE_PATH` is one:
the number in front is one vault's filing convention and not kasten's.

Only the import knows this folder exists. A deck written by hand lives wherever
you put it and is found by its tag, so nothing else in kasten reads this.

## KASTEN_TRASH_DAYS

```
30
```

How long a deleted note waits in the vault's `.trash` before it is dropped for
good. Counted from the moment in the entry's own name, and read at startup,
which is when the trash is emptied.

Long enough to notice the delete was a mistake, short enough that the trash is
not a second vault. The reasoning is in
[Deleting a note](/explanation/deleting-a-note.md).

## KASTEN_TOKENS_PATH

Where the [agent tokens](/reference/agent-api.md) are kept, one JSON record per
token holding a name, a creation date and a SHA-256 digest.

| | |
| --- | --- |
| Default | `tokens.json`, and `/agent-data/tokens.json` in the backend image |
| Read by | every `/agent/` route, and `/api/tokens` |

A relative path resolves against the working directory, the way
`KASTEN_VAULT_PATH` does. Production names a file inside a mounted directory,
the same path the image sets.

Beside the vault and never inside it. A token in the vault would enter jj
history for good and sit one search away from any agent reading notes.

The *directory* is what production mounts, never this file: `os.replace` over a
bind-mounted file fails with `EBUSY`, and every mint and revoke would break.
And keep that directory on the host: a store inside the container's own
filesystem goes with the container at the next upgrade, and every agent is
refused until you mint again.

A store that does not exist reads as an empty list, so a box with no tokens
refuses every bearer rather than failing to start.

## KASTEN_AGENT_HOST

The `Host` header the MCP endpoint answers to, and the OAuth issuer.

| | |
| --- | --- |
| Default | empty, which accepts any host and takes the issuer from the request |
| Read by | `POST /agent/mcp`, its `401`, the two `.well-known` documents, and the `iss` on the authorize redirect |

The MCP SDK's DNS-rebinding protection is left on, and its own default allowlist
is localhost only, which answers `421` to everything arriving through a proxy.
Empty is what dev on loopback needs; production sets the hostname Caddy serves.

The issuer is `https://{value}`, so the value is a bare hostname. It is what the
discovery documents state and what a [connector](/how-to/connect-an-agent.md)
compares, as an exact string with no normalising, so a trailing slash or a
scheme in front of the name fails the flow at the first comparison.

Unset, the issuer comes from the request, which is what dev and the tests run
on. In production that is wrong: the container runs uvicorn without
`--forwarded-allow-ips`, so an issuer built from the request says `http` where
the world sees `https`, and every comparison fails.

The backend logs a warning at startup while this is empty, and starts anyway.
It also bounds the `Origin` check on the
[consent `POST`](/reference/agent-api.md#get-and-post-apioauthauthorize):
`https://{value}` is accepted there as well as the request's own host.

## KASTEN_HERDR_SESSIONS_PATH

Where the shell container keeps one directory per named herdr session.

| | |
| --- | --- |
| Default | `/herdr-home/.config/herdr/sessions` |
| Read by | `GET /api/terminals` |

The shell container's home, which `deploy/compose.yaml` mounts read-only at
`/herdr-home`, so the terminal prompt can offer the sessions that already
exist. The path is only ever listed; nothing here starts, stops or reads into a
session.

The default is the container path rather than something relative, because
production sets no variable for it. A backend without the mount answers `[]`
and the notebook works as before.

## KASTEN_WEATHER_PLACES

The towns a daily note draws the weather for, in the order drawn.

| | |
| --- | --- |
| Default | Gelnhausen and Frankfurt |
| Read by | `GET /api/weather` |

JSON, a list of objects with a `name`, a `latitude` and a `longitude`:

```sh
KASTEN_WEATHER_PLACES='[{"name": "Gelnhausen", "latitude": 50.2017, "longitude": 9.1886}]'
```

`[]` turns the card off. The coordinates go to Open-Meteo every time a daily
note opens a day the backend has not asked about in the last 30 minutes.

## KASTEN_VAULT_PATH

The directory of markdown files that is the source of truth.

| | |
| --- | --- |
| Default | `vault`, and `/vault` in the backend image |
| Read by | every route that reads or writes a note |

A relative path resolves against the working directory, so start the app from
the repo root. The backend image sets `/vault`, its mount point, and production
sets the same value in its env file.

The backend logs a warning at startup when this directory holds no `.jj`, since
saves there are not recorded in any history. See
[Recover an earlier version of a note](/how-to/recover-an-earlier-version.md).

## The shell container

The shell container is not the backend and reads no `KASTEN_` setting of its
own beyond `KASTEN_API`. Two more variables set who a commit made in it is by.

| Variable | Sets |
| --- | --- |
| `JJ_USER` | jj's `user.name` and git's `user.name` |
| `JJ_EMAIL` | jj's `user.email` and git's `user.email` |

The entrypoint reads them each time the container starts and writes a value
into the home volume only where that key is empty, so a name set by hand inside
the container is never replaced. Unset or empty, it writes nothing. It then
removes both from the environment the shell gets, because jj reads `JJ_USER`
and `JJ_EMAIL` itself ahead of any config file, and left in place they would
override what the volume holds.

The container runs as any uid and gid compose gives it. One with no line in
the image's `/etc/passwd` gets one through nss_wrapper, named `kasten` with
`/home/kasten` as its home. A fresh home volume is writable by every uid; one
made under another uid is not, and the shell then stops with a line in its
log saying so.

On its first start the entrypoint installs Claude Code into `~/.local/bin` in
the home volume, with Anthropic's installer and under Anthropic's terms,
because the published image does not carry it. That start needs network to
reach `claude.ai` and takes longer. It installs only when no `claude` is on
`PATH`, and a failed install is logged and does not stop the shell.

## Compose variables

These are read by compose, not by the backend, so they take no part in
`backend/.env`. Each defaults to what the original VPS runs with.

| Variable | Default | Read by | What it sets |
| --- | --- | --- | --- |
| `KASTEN_IMAGE_REPO` | `ghcr.io/pgoell` | `deploy/compose.yaml`, `deploy/selfhost/compose.yaml` | where the images are pulled from |
| `KASTEN_IMAGE_TAG` | `latest` | both | which release to run, a version such as `0.29.0` or `latest` |
| `KASTEN_UID`, `KASTEN_GID` | `1000` | both | who the backend and shell run as. Set them to the host user that owns `KASTEN_DATA_DIR` |
| `KASTEN_DATA_DIR` | `/home/pascal/kasten-data`, and `./data` for self-host | both | the host directory holding `vault/` and `agent/` |
| `JJ_USER`, `JJ_EMAIL` | unset | both | passed to the shell container, see [above](#the-shell-container) |
| `KASTEN_NETWORK` | `web` | `deploy/compose.yaml`, `compose.dev.yml` | the external Docker network shared with Caddy |
| `KASTEN_DEV_PUBLIC_HOST` | `kasten-dev.pgoell.com` | `compose.dev.yml` | the public name vite accepts and points hot reload at |
| `DEV_UID`, `DEV_GID` | `1000` | `compose.dev.yml` | who the dev containers run as |
| `KASTEN_DB_PORT` | `5434` | `compose.yaml` | the dev Postgres's port on loopback |

[Deploy to the VPS](/how-to/deploy-to-the-vps.md#5-prod-env-file) says where
the production ones go, and names the two repository variables the deploy job
reads, `DEPLOY_DIR` and `KASTEN_DATA_DIR`.

## The self-host stack

`deploy/selfhost/compose.yaml` reads these from `.env` beside it, as well as
the shared ones above. `deploy/selfhost/.env.example` lists them with comments,
and [Self-host kasten](/how-to/self-host-kasten.md) walks through them.

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

* `backend.env`, optional, holds any `KASTEN_` setting from this page for the
  backend. Compose hands it to the backend alone, so the gate's secrets in
  `.env` never reach it. The stack sets `KASTEN_AGENT_HOST`,
  `KASTEN_VAULT_PATH` and `KASTEN_TOKENS_PATH` itself; `backend.env` cannot
  override those three, because compose's `environment` wins over `env_file`.
* `allowed-emails.txt`, for the oauth2-proxy gate, one address a line. Only
  those addresses may sign in, and without the file oauth2-proxy does not start.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md): what these settings mean to each other
* [Deleting a note](/explanation/deleting-a-note.md): what the trash is for
* [Two environments](/explanation/environments.md): the values dev and prod actually run with
* [The agent boundary](/explanation/the-agent-boundary.md): what the token store is for
