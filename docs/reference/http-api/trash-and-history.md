---
type: Reference
title: "HTTP API: trash and history"
description: Routes that read a note's jj history, delete notes and folders into the trash, and restore them.
resource: backend/src/kasten_backend/routes/
tags: [api, backend, openapi]
status: stable
---

# HTTP API: trash and history

The routes that read a note's jj history, send a note or folder to the trash, and put it back.

## GET /api/history

Lists the jj changes that touched one note, newest first. Takes `path`, the
note's vault path, which need not exist now. A path the vault would not take
is a `404`.

```json
{ "versioned": true, "changes": [{ "commit": "3c7719c83cbe41108baa7c74f7ba464c69df1d02", "change": "kvlnznonukvs", "time": "2026-10-17T17:40:13+02:00", "description": "vault: reading/borges.md", "path": "reading/borges.md" }] }
```

`commit` is the 40-digit commit id, `change` the short change id `jj log`
shows, `time` the committer timestamp with its offset, and `description` the
first line of the change's description.

The list follows the note through moves. Where a change renamed it from another
path, the older changes are those that touched that path, and `path` says
where the note was in each. Only a rename jj itself records counts, which
it finds when the text stayed similar, as a kasten move keeps it. A note added
while another was removed is not followed. A rename out of `.trash`, which a restore is, is
not followed. The walk stops after 20 renames.

The working-copy change is listed like any other, as of the last snapshot,
which every save takes. No call here snapshots or writes to the repo: each
passes `--ignore-working-copy`.

A vault that is not a jj repo, or a box with no jj, answers
`{ "versioned": false, "changes": [] }`. A jj that fails or runs over ten
seconds is a `503`.

## GET /api/history/version

Reads one note's full text at one change. Takes `path`, the path that change
lists, and `commit`, its commit id.

```json
{ "content": "# Borges\n" }
```

A `commit` that is not 40 lowercase hex digits is a `422`. A commit jj does
not know, or a note that is not at that path in it, is a `404`, and so is a
path the vault would not take. A jj that fails or runs too long is a `503`.

## DELETE /api/files/{path}

Takes one note out of the vault and holds it in the trash.

```json
{
  "entry": "00 Inbox/borges.md@2026-08-11T14-03-02.481337",
  "path": "00 Inbox/borges.md",
  "deleted": "2026-08-11T14:03:02Z"
}
```

`entry` is where the note now sits under `.trash`, and it is the name
[the restore](#patch-apitrashentry) takes. `path` is where it lived, which is
where a restore puts it back. `deleted` is the moment in the entry's own name.

A `DELETE` that keeps the note is not a contradiction. What these routes answer
about is what the vault holds, and the note stops being one of them the moment
it moves: nothing lists it, nothing searches it, and no path in a URL reaches
it, because every route refuses a hidden folder. Why it waits there rather than
going is [Deleting a note](/explanation/deleting-a-note.md).

The trash mirrors the vault. A note keeps its path and its leaf takes the moment
it went, so the name is the whole record: where it came from, when, and no way
to collide with a note deleted from the same path later.

The folders the note came out of go with it, exactly as
[a move](/reference/http-api/moving.md#what-a-move-leaves-behind) takes them, a folder left holding its
`index.md` alone included. Unlike a move, a delete leaves the entries in the
index above alone.

Links pointing at the note are left alone. A `[[link]]` names a note rather than
a place, the editor already draws one nothing answers to as missing, and
rewriting the vault to say a note is gone would be the one edit a restore could
not take back.

### What a delete refuses

* `404` when there is no note at the path in the URL. Everything `GET` and `PUT`
  refuse is refused here too, so a note you cannot open is a note you cannot
  delete.

A delete that lands is recorded the way a save is, named
`vault: .trash/<entry>`. The entry rather than the note, so a delete never
amends the change holding the edit before it and the text you last typed stays
reachable. jj matches the content across the move and records it as a rename.

## DELETE /api/folders/{path}

Takes one folder out of the vault, and every note under it with it.

```json
{
  "entry": "reading@2026-08-11T14-03-02.481337",
  "path": "reading",
  "deleted": "2026-08-11T14:03:02Z"
}
```

One entry, not one per note. The folder goes in one rename and comes back in
one, so what you get back is the folder you deleted rather than a list of notes
to put back yourself.

Its own route rather than the one above, for the reason
[the folder move](/reference/http-api/moving.md#patch-apifolderspath) has one.

### What a folder delete refuses

* `404` when there is no folder at the path in the URL. A note at that path is a
  `404` too, so the one way to delete a note stays the route above, and so is
  the vault root.

## GET /api/trash

Everything the trash is holding, newest first.

```json
[
  {
    "entry": "00 Inbox/borges.md@2026-08-11T14-03-02.481337",
    "path": "00 Inbox/borges.md",
    "deleted": "2026-08-11T14:03:02Z"
  }
]
```

Read off the names in `.trash` rather than out of a list somebody has to keep in
step with it. The name of an entry is the record, so a note moved out of the
trash by hand stops being on this list by the same act.

Newest first because the entry anyone wants back is usually the last one they
deleted, and `<leader>du` takes the first row without asking.

## PATCH /api/trash/{entry}

Puts one entry back where it was deleted from.

```json
{ "path": "00 Inbox/borges.md" }
```

`PATCH` and no body, for the reason [a move](/reference/http-api/moving.md#patch-apifilespath) is a `PATCH`:
this changes where something lives, and where it should live is already written
in the entry's own name.

The folders on the way back are made, the way a create makes them, because the
delete took the empty ones with it.

### What a restore refuses

* `404` when the trash has no such entry. A path that climbs out of the trash is
  a `404` too, the entry going through the same rule a note's path does.
* `409` when something has taken the path since. The entry is left in the trash.
* `400` when the vault will not take the path at all, which by then means
  something is standing where one of its folders has to go.

A restore that lands is recorded the way a save is, named `vault: <path>`.

