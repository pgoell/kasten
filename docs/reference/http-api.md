---
type: Reference
title: HTTP API
description: Every endpoint the backend serves, with its response shape.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API

The backend serves three endpoints. All of them are read-only. The interactive
schema is at `/docs` while the backend runs, and the machine-readable one at
`/openapi.json`.

## GET /api/health

Reports that the process is up. It deliberately does not touch the database, so
it stays a liveness check and does not become a readiness check by accident.

```json
{ "status": "ok" }
```

## GET /api/files

Lists every note in the vault as a relative POSIX path, sorted.

```json
["daily/2026-08-05.md", "index.md", "projects/kasten.md"]
```

The list is flat and the server keeps it that way. Folders are not modelled
anywhere in the backend; the frontend folds the paths into a tree. Hidden files
and directories are skipped, which keeps `.git` and editor dotfiles out. A
vault directory that does not exist reads as an empty one, so a fresh checkout
still serves.

## GET /api/files/{path}

Reads one note. `path` is a vault-relative POSIX path, exactly as it appears in
the list above. A slash inside it may be sent raw or percent-encoded.

```json
{ "path": "daily/2026-08-05.md", "content": "# 2026-08-05\n" }
```

`content` is the file's text, unchanged.

Anything that is not a readable markdown file inside the vault is a `404`:

* a note that is not there
* a path that climbs out of the vault with `..`, or an absolute path
* a symlink whose target sits outside the vault
* a file that is not `.md`, a directory, or a hidden file

Every refusal reads the same, because telling a typo apart from an attempt to
climb out is worth nothing to the one user and something to everyone else.

Nothing writes yet. There is no endpoint that saves a note.

## Related

* [Regenerate the API types](/how-to/regenerate-the-api-types.md) - push a change here through to the frontend
* [Configuration](/reference/configuration.md) - which directory `/api/files` reads
