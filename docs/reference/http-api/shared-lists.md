---
type: Reference
title: "HTTP API: shared lists"
description: The eight routes the shared lists app reaches under /share/, with what each takes and answers.
resource: backend/src/kasten_backend/routes/share.py
tags: [api, backend, share, lists]
status: stable
---

# HTTP API: shared lists

The eight routes under `/share/`. They sit outside `/api/`, so the count on
[the HTTP API page](/reference/http-api.md) leaves them out. On the share host,
set by [`KASTEN_SHARE_HOST`](/reference/configuration/shared-lists.md#kasten_share_host), they
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
{ "name": "Einkauf", "sha": "3f9c1a0", "items": [{ "line": 4, "text": "Milch", "done": false, "assignee": null, "ticked_by": null, "ticked_at": null }] }
```

* `sha` is the note's current sha, or `null` when the note is not there.
* `line` is the item's 0-based line index in the note.
* `text` is the item with no markdown: no `- [ ]`, and cut before the first
  Tasks field marker, such as `✅`, `🆔` or `📅`.
* `assignee` is who the item is for: the name written after an undated `👤`,
  such as `[[Pascal]]`, or `null` when there is none. A `👤` with a date is the
  wait and gives no assignee.
* `ticked_by` is who ticked a done item, such as `Alicia`, read from the note's
  jj history. It is `null` for an open item, for a tick no listed person made,
  and when the history cannot be read.
* `ticked_at` is when a done item was ticked, as ISO 8601 with an offset, such as
  `2026-10-25T18:04:12+02:00`. It is `null` for an open item and when the history
  cannot be read.
* Only top-level lines `- [ ] `, `- [x] ` and `- [X] ` are items.

A note that is not there reads as `{"sha": null, "items": []}`, and an add with
`sha: null` creates it.

Every write goes through the same save as the rest of kasten, so a stale sha
answers `409` with `{"detail": ..., "current": "<sha>"}` and writes nothing.

## GET /share/me

Answers who is asking and who the app offers:

```json
{ "me": "Alicia", "people": ["Pascal", "Alicia"] }
```

`me` is who is writing, below, or `null`. `people` is every name in
`KASTEN_SHARE_PEOPLE`, in its order, each once.

### Who is writing

The share host's oauth2-proxy sends the signed-in address as
`X-Auth-Request-Email` on every `/share/` request. `KASTEN_SHARE_PEOPLE` maps
an address to a name, as JSON in menu order, addresses without case:

```sh
KASTEN_SHARE_PEOPLE='{"pascal@example.test": "Pascal", "alicia@example.test": "Alicia"}'
```

A write by a listed address is named after its person in the vault's history,
`agent(share:Alicia): 05 Shared/Einkauf.md`. A missing header or an address not
listed writes as `share` and has no `me`. The default `{}` lists nobody.

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
unless the line reads an id already. The `✅` goes before the id it reads. A
`🆔` with no word after it, or one inside a link or code span, reads no id, as in
the editor, so the line gets one. A `^block-id` at the end of the line stays
last, so `- [ ] Brot ^abc` becomes `- [x] Brot ✅ <today> 🆔 kt-… ^abc`.
Unticking writes `- [ ] <text>` and strips the `✅` date. Both take only the
done field the line reads, a `✅` with a date outside a link or code span: a
bare `✅` among the words, or one inside a code span, stays as it is.

A tick whose line is already in the asked state, or is not an item, answers
`200` and changes nothing. A stale sha answers `409`. A tick to done on a line
carrying `🔁`, or on a line with indented parts under it, answers `422`
`{"detail": "Tick this one in kasten"}` and writes nothing: kasten's own cycle
writes the next occurrence and ticks the parts.

A tick to done also writes the done log line the todo pane writes, `- ✅ <today>
<words> [[<list>]] <id>`, under `## Done` in today's daily note, making the note
where the vault has none. The words are the item's without its fields, so an
assignee goes and tags stay: `- [ ] Milch #bio 👤 [[Anna]]` logs
`- ✅ <today> Milch #bio [[05 Shared/Einkauf]] kt-…`. An id a `- ✅` line names
anywhere outside the archive gets no second line. An untick drops every `- ✅`
line naming the item's id, wherever it stands. A line names the id when the id
is its last `kt-` word, or its last word where it has none, and the line stands
outside a code fence, so a log line of another todo whose words mention the id
stays. An untick of an id another todo line carries too, in the list or in
another note, answers `422` `{"detail": "🆔 <id> is on another todo too: <note>
line <n>"}` and writes nothing, as the todo pane refuses it. The list is written first and the
daily note after it; [the share tick orderings](/reference/save-path-orderings/share-tick.md)
say what a failure between them leaves. `KASTEN_SHARE_LOGS_DONE=false` turns the
log write off.

## POST /share/lists/{name}/assign

Takes `{"line": 4, "assignee": "Alicia", "sha": "3f9c1a0"}` and answers the
`List`. `assignee` is a name from `people` in
[`GET /share/me`](#get-shareme), or `null` to clear the assignee. Any other name
answers `422` with `{"detail": "Not one of the people"}` and writes nothing.

The write sets `👤 [[Alicia]]` in place of the line's undated `👤`, or adds it
before the line's first field, and a clear removes the `👤` with the blank before
it. Every other byte of the line stays: the words, tags, the `✅` date, the `🆔`,
a dated wait and a `^block-id` at the end.

A stale sha answers `409`. An assign to the state the line is in already, or on a
line that is no task, writes nothing and answers the `List`. An item that is
done keeps who ticked it, since an assign is no tick.

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
* [Configuration](/reference/configuration.md): `KASTEN_SHARE_FOLDER`, `KASTEN_SHARE_HOST` and `KASTEN_SHARE_PEOPLE`
* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): which gate covers these routes
