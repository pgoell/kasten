---
type: Reference
title: Configuration
description: Every backend setting, its default, where the values come from, and the two variables the shell container reads for its commit identity.
resource: backend/src/kasten_backend/config.py
tags: [config, environment, backend]
status: stable
---

# Configuration

Settings are read from the environment and from `backend/.env`, in that order
of precedence. Every field takes the `KASTEN_` prefix. Unknown variables are
ignored.

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

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md) - what these settings mean to each other
* [Deleting a note](/explanation/deleting-a-note.md) - what the trash is for
* [Two environments](/explanation/environments.md) - the values dev and prod actually run with
* [The agent boundary](/explanation/the-agent-boundary.md) - what the token store is for
