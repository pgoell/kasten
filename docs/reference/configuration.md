---
type: Reference
title: Configuration
description: Every backend setting, its default, where the values come from, what the shell container reads for its commit identity, the uid it runs as and its first-start install of Claude Code, the variables the compose files read, and the self-host stack's own.
resource: backend/src/kasten_backend/config.py
tags: [config, environment, backend]
status: stable
---

# Configuration

Settings come from the environment, then from a `.env` file in the directory
the process starts in. `mise run dev` starts at the repo root and reads `./.env`; the `db:` tasks start in
`backend/` and read `backend/.env`. Every field takes the `KASTEN_` prefix.
Unknown variables are ignored.

Every value below is already the default. `backend/.env.example` shows
how to write your own overrides.

The backend image changes three of them. It sets `KASTEN_VAULT_PATH=/vault`,
`KASTEN_TOKENS_PATH=/agent-data/tokens.json` and
`KASTEN_RECEIPTS_PATH=/receipts`, the mount points `deploy/compose.yaml` uses,
since the relative defaults would vanish under `/app` in the container. An env
file still wins over all three.

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

The SQLAlchemy URL for `finance`, RSVP places and token logs, never notes.

Alembic, [finance](/reference/http-api/finance.md),
[`/api/rsvp`](/reference/http-api/rsvp.md) and token records use it, per
request, with a 5 s or 2 s timeout. With none, `503` or null; the rest runs;
the [self-host stack](/how-to/self-host-kasten.md) ships none.

Dev points at kasten's compose Postgres on host port 5434. It
cannot use the shared `postgres` container on the VPS: that one publishes no
host port, and the dev backend runs on the host.

## KASTEN_ARCHIVE_PATH

```
98 Archive
```

The folder holding what is finished, which `GET /api/search` and
`GET /api/todos` walk past unless the request asks for it. The editor reads it
from [`GET /api/layout`](/reference/http-api/finding.md#get-apilayout) and hides it from
the tree and the todo list the same way.

An ordinary folder in the vault, and this name is the only thing kasten knows
about it. Nothing writes into it, nothing moves anything into it, and a note in
it opens, saves, renames and deletes like any other.

`GET /api/files` is deliberately never filtered by it. That listing is what
resolves a `[[wikilink]]`, and a link to an archived note reading as a dead one
would make a second note in the inbox out of a note the vault already holds.

Set it to a name no folder has and nothing is left out of anything.

## The vault's folders

Six settings name the folders kasten files into or looks in. Each is a path
from the vault root, and each default is the folder one vault already used.
[`GET /api/layout`](/reference/http-api/finding.md#get-apilayout) serves them to the
editor, and the startup notes and the agent instructions spell them as set.

| Setting | Default | What goes there |
| --- | --- | --- |
| `KASTEN_INBOX_PATH` | `00 Inbox` | a note made from a `[[link]]` nothing answers to, a clipped page, an imported markdown file; books in `02 Books` and documents in `02 Documents` under it; an agent's notes in `00 Agent` under it |
| `KASTEN_PERIODIC_PATH` | `01 Periodic` | the periodic notes, in `00 Daily`, `01 Weekly`, `02 Monthly`, `03 Quarterly` and `04 Yearly` under it, and the dump |
| `KASTEN_IMAGES_PATH` | `99 Misc/02 Assets/01 Images` | an image pasted or dropped into a note |
| `KASTEN_CONFIG_PATH` | `99 Misc/01 Config` | `reading-this-vault.md`, `todo-views.md` and `reading-now.md`, and the ontology and three agent guides in `01 Agents` under it |
| `KASTEN_ARCHIVE_PATH` | `98 Archive` | see [its own section](#kasten_archive_path) |
| `KASTEN_SKILLS_PATH` | `.claude/skills` | the skills the agent's `list_skills`, `read_skill` and `GET /agent/skills` read, never write. A missing folder lists none |
| `KASTEN_SHARE_FOLDER` | `05 Shared` | the [shared lists](/explanation/shared-lists.md), one note a list, and all the `/share/` routes reach |
| `KASTEN_SHARE_PEOPLE` | `{}` | [who writes](/reference/http-api/shared-lists.md#who-is-writing) a shared list |

Only the parent folders are settings. The subfolders under them keep their
names, so one setting moves a whole group and the list stays short.

The startup notes are written into `KASTEN_CONFIG_PATH` only when missing, so
changing it on a running vault writes a fresh set in the new place and leaves
the old ones where they are. Move them yourself if you want to keep your edits.

`reading-now.md` is not a startup note. You write it, and kasten only reads it:
nothing creates it or changes it, except a move of the book's note, which
rewrites the link as it rewrites any other. Its body holds one `[[wikilink]]` to
the note of the book you are reading, such as `[[The Expectant Father]]`, and
the link resolves by the vault's usual rule. With several links the first one
counts. [`<leader>gc`](/reference/editor-keys/book-pane.md#the-book-pane) reads it afresh
on each press and opens that book.

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

## KASTEN_REVIEW_NEW_PER_DAY

How many new cards a sitting of a deck introduces a day.

| | |
| --- | --- |
| Default | unset, which means no limit |
| Read by | `GET /api/review/limits` |

The fallback for a deck that neither
[`decks.md`](/reference/flashcard-format/reviewing-cards.md#daily-limits) nor a deck above it
gives a limit. Set it so a 2,000 card import does not make the first sitting
absurd in a vault where nobody wrote `decks.md`.

## KASTEN_REVIEW_REVIEWS_PER_DAY

How many due cards a sitting of a deck asks a day.

| | |
| --- | --- |
| Default | unset, which means no limit |
| Read by | `GET /api/review/limits` |

The other half of `KASTEN_REVIEW_NEW_PER_DAY`, read the same way.

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
token holding a name, a creation date and a SHA-256 digest in lowercase hex.

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

A revoked token's record moves out of this file into `tokens-revoked.json`,
beside it, so a request that token makes later can still be named in the action
log. Both files sit in the same directory and are written the same way.

`tokens-revoked.json` keeps the last 50 records; [revoking a token](/reference/http-api/system.md) says why that, or a broken file, cannot let one back in.

## KASTEN_ACTIVITY_TIMEOUT_SECONDS

The most a recording insert may take, in seconds, before its row is dropped
with a warning in the log. Every request a token makes writes one row to
[the action log](/how-to/connect-an-agent.md#what-kasten-records), so this is also
the most that write can hold up the request.

A box with no database records nothing. Each agent request logs one warning
instead, and [the action list](/reference/http-api/system.md) answers `503`.

| | |
| --- | --- |
| Default | `2` |
| Read by | every `/agent/` request |

## KASTEN_UPLOAD_PATH

The folder a file sent in pieces is joined in, until
`POST /api/anki?upload=` or `POST /api/assets/{path}?upload=` reads it. See
[`POST /api/uploads`](/reference/http-api/assets-and-books.md#post-apiuploads).

| | |
| --- | --- |
| Default | `kasten-uploads` in the system's temp folder, `/tmp/kasten-uploads` |
| Read by | `POST /api/uploads`, and startup |

Outside the vault, so a half-sent file never reaches the file tree, the
watcher or jj; the backend refuses to start with it in the vault or inside it.
At every start the backend deletes the files in it named like an upload, 32
hex digits, and leaves anything else: what has arrived is held in memory, and
a restart forgets it. It needs room for 4GiB, what the uploads open at once
may declare between them, and the asset finish copies the joined file into the
vault rather than moving it, because the two sit on different filesystems in
the container.

## KASTEN_TEXT_CACHE_PATH

Text search takes from pdf, epub and html files. Outside the vault, safe to
delete. Default `/tmp/kasten-text`.

## KASTEN_RECEIPTS_PATH

The folder the finance receipts are kept in, each file named by its hash. See
[HTTP API: finance tax](/reference/http-api/finance-tax.md).

| | |
| --- | --- |
| Default | `receipts`, relative to the working directory; the backend image sets `/receipts` |
| Read by | `/api/finance/receipts/*` and the tax year's ZIP |

Beside the vault and never inside it: a receipt in the vault would enter jj
history and sit beside every note an agent reads. The backend refuses to start
with it in the vault or inside it. Production mounts
`/home/pascal/kasten-data/finance/receipts` here; make that folder, owned by
the backend's user, before the first deploy that mounts it.

## KASTEN_UPLOAD_SWEEP_SECONDS

How often the backend deletes uploads idle for over an hour.

| | |
| --- | --- |
| Default | `600` |
| Read by | startup |

It must be over 0, or the backend refuses to start. There for the tests,
which set a nanosecond to sweep on every turn of the event loop rather than
wait ten minutes. Production leaves it alone.

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
[consent `POST`](/reference/agent-api/oauth.md#get-and-post-apioauthauthorize):
`https://{value}` is accepted there as well as the request's own host.

## The shared lists

`KASTEN_SHARE_HOST` and `KASTEN_SHARE_LOGS_DONE` set the lists app's host and
whether its ticks reach the done log: [The shared lists](/reference/configuration/shared-lists.md).

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

## KASTEN_FOOD_CONTACT

| | |
| --- | --- |
| Default | `https://github.com/pgoell/kasten` |
| Read by | food routes |

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

After that it installs the Claude Agent SDK into `~/.kasten-chat`, at the
version `KASTEN_AGENT_SDK_VERSION` in the image names, and starts
[the chat runner](/reference/chat-runner.md) on port `7682`. Both happen in
the background, so the shell does not wait for them. A release that moves the
pin replaces the copy in the volume on its first start.

| Variable | Set on | What it does |
| --- | --- | --- |
| `KASTEN_AGENT_SDK_VERSION` | the image | the SDK version the entrypoint installs. Change it in `shell/Dockerfile`, not in compose |
| `CLAUDE_CODE_OAUTH_TOKEN` | the shell container, optional | signs Claude Code in without the interactive login. From `claude setup-token` |
| `ANTHROPIC_API_KEY` | never | Claude Code prefers it to the subscription login, so every run in the terminal and the chat pane would be billed to the API account |
| `KASTEN_DEV_CHAT` | the frontend dev server | where vite proxies `/chat`. Default `http://localhost:7682` |

## Compose variables

These are read by compose, not by the backend, so they take no part in
`backend/.env`. Each defaults to what the original VPS runs with.

| Variable | Default | Read by | What it sets |
| --- | --- | --- | --- |
| `KASTEN_IMAGE_REPO` | `ghcr.io/pgoell` | `deploy/compose.yaml`, `deploy/selfhost/compose.yaml` | where the images are pulled from |
| `KASTEN_IMAGE_TAG` | `latest` | both | which release to run, a version such as `0.29.0` or `latest` |
| `KASTEN_UID`, `KASTEN_GID` | `1000` | both | who the backend and shell run as. Set them to the host user that owns `KASTEN_DATA_DIR` |
| `KASTEN_DATA_DIR` | `/home/pascal/kasten-data`, and `./data` for self-host | both | the host directory holding `vault/`, `agent/` and, in production, `finance/receipts/` |
| `JJ_USER`, `JJ_EMAIL` | unset | both | passed to the shell container, see [above](#the-shell-container) |
| `KASTEN_NETWORK` | `web` | `deploy/compose.yaml`, `compose.dev.yml` | the external Docker network shared with Caddy |
| `KASTEN_DEV_PUBLIC_HOST` | `kasten-dev.pgoell.com` | `compose.dev.yml` | the public name vite accepts and points hot reload at |
| `DEV_UID`, `DEV_GID` | `1000` | `compose.dev.yml` | who the dev containers run as |
| `KASTEN_DB_PORT` | `5434` | `compose.yaml` | the dev Postgres's port on loopback |

[Deploy to the VPS](/how-to/deploy-to-the-vps.md#5-prod-env-file) says where
the production ones go.

## The self-host stack

`deploy/selfhost/compose.yaml` reads more variables from `.env` beside it, and
two files sit beside that: [The self-host stack](/reference/configuration/self-host-stack.md)
lists them.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md): what these settings mean to each other
* [Deleting a note](/explanation/deleting-a-note.md): what the trash is for
* [Two environments](/explanation/environments.md): the values dev and prod actually run with
* [The agent boundary](/explanation/the-agent-boundary.md): what the token store is for
