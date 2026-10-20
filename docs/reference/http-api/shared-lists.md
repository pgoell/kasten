---
type: Reference
title: "HTTP API: shared lists"
description: The six routes the shared lists app reaches under /share/, with what each takes and answers.
resource: backend/src/kasten_backend/routes/share.py
tags: [api, backend, share, lists]
status: stable
---

# HTTP API: shared lists

The six routes under `/share/`. They sit outside `/api/`, so the count on
[the HTTP API page](/reference/http-api.md) leaves them out. On the share host,
set by [`KASTEN_SHARE_HOST`](/reference/configuration.md#kasten_share_host), they
are the only paths the backend answers. The reasoning is in
[Shared lists](/explanation/shared-lists.md).

Every route names a list by its file name without `.md`. `{name}` maps to the
note `05 Shared/<name>.md`, and the folder is set by
[`KASTEN_SHARE_FOLDER`](/reference/configuration.md#the-vaults-folders). A name
that resolves outside the folder, through `../`, an absolute path, an encoded
dot-dot, a symlink or a nested folder, answers `404` with
`{"detail": "No such list"}`.

## The List shape

Each list route answers the same shape:

```json
{ "name": "Einkauf", "sha": "3f9c1a0", "items": [{ "line": 4, "text": "Milch", "done": false }] }
```

* `sha` is the note's current sha, or `null` when the note is not there.
* `line` is the item's 0-based line index in the note.
* `text` is the item with no markdown: no `- [ ]`, and cut before the first
  Tasks field marker, such as `✅`, `🆔` or `📅`.
* Only top-level lines `- [ ] `, `- [x] ` and `- [X] ` are items.

A note that is not there reads as `{"sha": null, "items": []}`, and an add with
`sha: null` creates it.

Every write goes through the same save as the rest of kasten, so a stale sha
answers `409` with `{"detail": ..., "current": "<sha>"}` and writes nothing.

## GET /share/lists

Answers the names of the lists: the notes directly in the shared folder, without
`.md`, sorted. A folder that is not there answers `[]`.

```json
["Einkauf", "Todo"]
```

## GET /share/lists/{name}

Answers the `List` for one list. A list that is not there answers
`{"name": "<name>", "sha": null, "items": []}`, so the app shows its empty state.

## POST /share/lists/{name}/items

Takes `{"text": "Milch", "sha": "3f9c1a0"}` and appends `- [ ] Milch` after the
last item line, or at the end of the note. Answers the `List` after the add.

* `sha: null` creates the note when it is missing.
* Blank text answers `422`.
* A stale sha answers `409`.

## POST /share/lists/{name}/tick

Takes `{"line": 4, "done": true, "sha": "3f9c1a0"}` and answers the `List`.

Ticking to done writes `- [x] <text> ✅ <today>`, and a `🆔 kt-<6 hex>` after it
unless the line has an id already. The `✅` goes before an existing `🆔`.
Unticking writes `- [ ] <text>` and strips the `✅` date.

A tick whose line is already in the asked state, or is not an item, answers
`200` and changes nothing. A stale sha answers `409`.

## POST /share/lists/{name}/clear

Takes `{"sha": "3f9c1a0"}` and removes the `- [x]` and `- [X]` item lines.
Nothing else changes. Answers the `List`, and a stale sha answers `409`.

## GET /share/events

Answers a server-sent event stream in the wire format of
[`GET /api/events`](/reference/http-api/system.md). It carries only the events
for paths inside the shared folder. A change to any other note sends nothing.

The stream is not compressed, as [the reverse-proxy page](/reference/reverse-proxy-routes.md#rules)
says for the other streams.

## Related

* [Shared lists](/explanation/shared-lists.md): why the lists are notes, and how a conflict is settled
* [Configuration](/reference/configuration.md): `KASTEN_SHARE_FOLDER` and `KASTEN_SHARE_HOST`
* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): which gate covers these routes
