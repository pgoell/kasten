---
type: Reference
title: "HTTP API: RSVP"
description: The two routes that read and save where an RSVP run stopped in a note, HTML page, PDF or book.
resource: backend/src/kasten_backend/routes/rsvp.py
tags: [api, backend, openapi, rsvp, database]
status: stable
---

# HTTP API: RSVP

Two routes keep the place an RSVP run stopped at in each file, one row per
file in the `rsvp_places` table in Postgres. Both take `path`, the file's vault
path, in the query. It may name a note (`.md`), an HTML page (`.html`) or an
asset such as a PDF or an EPUB, and the file must be there: a path the vault would not take, or one with
no file at it, is a `404` with `{"detail": "No such file"}`.

With no database to reach, both answer `503` with
`{"detail": "No database answers at KASTEN_DATABASE_URL, where finance and RSVP places are kept. See docs/reference/configuration.md."}`,
as the finance routes do. The self-host stack runs that way.

The place is keyed by the vault's own spelling of the path, so
`reading/./borges.md` and `reading/borges.md` are one row. A book's note and
the book beside it are two paths and so two rows; which one a client saves
under is up to the client.

## GET /api/rsvp

Reads the place saved for one file.

```
GET /api/rsvp?path=reading/borges.pdf
```

```json
{
  "path": "reading/borges.pdf",
  "word": 1204,
  "words": 48311,
  "anchor": "the garden of forking paths",
  "updated": "2026-10-25T17:56:02.412871Z"
}
```

A file no run has stopped in answers `200` with `null`.

## PUT /api/rsvp

Saves the place for one file over the place saved before, and answers with the
row as `GET` would read it.

```
PUT /api/rsvp?path=reading/borges.pdf
```

```json
{ "word": 1204, "words": 48311, "anchor": "the garden of forking paths" }
```

A `word` or `words` below 0, or a `word` past `words`, is a `422`. A `word`
equal to `words` is the place of a run that read to the end.

## The place

* `path` is the file's vault path, in the vault's own spelling.
* `word` is the index of the word the run stopped at, counted from 0.
* `words` is how many words the list held when the place was saved. A client
  that counts another number knows the text changed.
* `anchor` is the saved word and about four after it, joined by spaces. A
  client whose text changed searches for it to find the nearest place.
* `updated` is when the place was last saved, set by the database.

## Related

* [The vault and the derived index](/explanation/vault-and-derived-index.md): why this is the one table the vault cannot rebuild
* [Configuration](/reference/configuration.md#kasten_database_url): the database these routes reach
