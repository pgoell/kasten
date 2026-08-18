---
type: Reference
title: Configuration
description: Every backend setting, its default, and where the values come from.
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
`GET /api/todos` walk past unless the request asks for it.

An ordinary folder in the vault, and this name is the only thing kasten knows
about it. Nothing writes into it, nothing moves anything into it, and a note in
it opens, saves, renames and deletes like any other.

`GET /api/files` is deliberately never filtered by it. That listing is what
resolves a `[[wikilink]]`, and a link to an archived note reading as a dead one
would make a second note in the inbox out of a note the vault already holds.

Set it to a name no folder has and nothing is left out of anything.

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
| Default | `tokens.json` |
| Read by | every `/agent/` route, and `/api/tokens` |

A relative path resolves against the working directory, the way
`KASTEN_VAULT_PATH` does. Production names a file inside a mounted directory.

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

## KASTEN_VAULT_PATH

```
vault
```

The directory of markdown files that is the source of truth.

A relative path resolves against the working directory, so start the app from
the repo root. Production overrides this with the absolute container path
`/vault`.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md) - what these settings mean to each other
* [Deleting a note](/explanation/deleting-a-note.md) - what the trash is for
* [Two environments](/explanation/environments.md) - the values dev and prod actually run with
* [The agent boundary](/explanation/the-agent-boundary.md) - what the token store is for
