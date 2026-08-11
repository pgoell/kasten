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
