---
type: Reference
title: HTTP API
description: Every endpoint the backend serves, with its response shape.
resource: backend/src/kasten_backend/main.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API

The backend serves forty-nine endpoints under `/api/`. Thirty-two read,
sixteen write, and one streams. The interactive schema is at `/docs` while the backend
runs, and the machine-readable one at `/openapi.json`.

The agent's routes sit under `/agent/`, and they are documented on their own page,
[the Agent API](/reference/agent-api.md). Everything here is reached through
the login gate in front of kasten and nothing else; everything there is reached
with a bearer token and nothing else.

The OAuth consent step, `GET` and `POST /api/oauth/authorize`, sits under
`/api/` too but is left out of the count and the schema. It is documented with
the rest of [the OAuth flow](/reference/agent-api/oauth.md#get-and-post-apioauthauthorize),
including the check that refuses a cross-site `POST` with a `403`.

## Routes by area

* [Notes](/reference/http-api/notes.md): list, read, save and create notes, and the day each one counts on
* [Moving](/reference/http-api/moving.md): give a note or folder a new path, and preview what a move rewrites
* [Trash and history](/reference/http-api/trash-and-history.md): delete into the trash, restore, and read a note's jj history
* [Assets and books](/reference/http-api/assets-and-books.md): images, sounds, books and the chunked uploads
* [Finding](/reference/http-api/finding.md): search, tags, mentions, the link graph and the folder layout
* [Todos](/reference/http-api/todos.md): the route that lists every todo and its project
* [Log](/reference/http-api/log.md): the day's water, coffee, alcohol and food, and their totals
* [Food](/reference/http-api/food.md): search Open Food Facts for a food, or read one by its barcode
* [Cards](/reference/http-api/cards.md): flashcard lines, review limits and Anki imports
* [Capture](/reference/http-api/capture.md): the dump, web pages, YouTube transcripts, HTML pages and weather
* [System](/reference/http-api/system.md): health, version, the change stream, terminals and agent tokens
* [Shared lists](/reference/http-api/shared-lists.md): the six `/share/` routes the shared lists app reaches, outside the `/api/` count

## Related

* [Deleting a note](/explanation/deleting-a-note.md): why a delete keeps the note
* [Moving a note](/explanation/moving-notes.md): why a move rewrites links and carries index entries
* [Regenerate the API types](/how-to/regenerate-the-api-types.md): push a change here through to the frontend
* [Configuration](/reference/configuration.md): which directory `/api/files` reads
* [Shared lists](/explanation/shared-lists.md): why the `/share/` routes exist, and what they can reach
* [Agent API](/reference/agent-api.md): the routes a token reaches, and the ones it never does
* [Capture from your phone](/how-to/capture-from-your-phone.md): the page and the share sheet that post to `/api/dump`
