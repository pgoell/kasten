---
type: Reference
title: "HTTP API: shared lists"
description: The eleven routes the shared lists app reaches under /share/, with what each takes and answers.
resource: backend/src/kasten_backend/routes/share.py
tags: [api, backend, share, lists]
status: stable
---

# HTTP API: shared lists

The eleven routes under `/share/`. They sit outside `/api/`, so the count on
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
{ "name": "Einkauf", "sha": "3f9c1a0", "items": [{ "line": 4, "depth": 0, "text": "Milch", "done": false, "assignee": null, "ticked_by": null, "ticked_at": null }] }
```

* `sha` is the note's current sha, or `null` when the note is not there.
* `line` is the item's 0-based line index in the note.
* `depth` is `0` for an item and `1` for a part of the item above it, `2` for a
  part of that part, and so on. Items come in note order, so a part follows the
  item it belongs to.
* `text` is the item with no markdown: no `- [ ]`, every field the editor
  reads taken out, such as `✅ <date>`, `🆔 kt-…` or `📅 <date>`, and no
  trailing `^block-id`. Words after a field stay, and so does a marker with no
  value or one inside a link or code span: `a 🆔 ⛔ kt-1 more` reads `a 🆔 more`.
* `assignee` is who the item is for: the name written after an undated `👤`,
  such as `[[Pascal]]`, or `null` when there is none. A `👤` with a date is the
  wait and gives no assignee.
* `ticked_by` is who ticked a done item, such as `Alicia`, read from the note's
  jj history. It is `null` for an open item, for a tick no listed person made,
  and when the history cannot be read.
* `ticked_at` is when a done item was ticked, as ISO 8601 with an offset, such as
  `2026-10-25T18:04:12+02:00`. It is `null` for an open item and when the history
  cannot be read.
* Lines `- [ ] `, `- [x] ` and `- [X] ` at the margin are items. The same lines
  indented under one are its parts, by the rule in
  [Subtasks](/reference/todo-format/state-changes.md#subtasks): a heading or a
  plain list item ends them. A part under a line in another state, such as
  `- [/]`, is not listed, and neither is the `- [/]` line.

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

When `me` is the person
[`KASTEN_SHARE_OWNER`](/reference/configuration/shared-lists.md#kasten_share_owner)
names and `KASTEN_AGENT_HOST` is set, the answer also carries `home`, kasten's
address, `https://<KASTEN_AGENT_HOST>/`. The app links to it from its header.
Anyone else gets no `home`.

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

With `?text=<typed text>` the answer also carries `kept`: the `text` an add of
that text shows as, such as `"kept": "Butter #einkauf"` for `Butter ⏫ #einkauf`.
The app reads it before it sends an add and counts the open items showing it,
so an add whose answer was lost is not sent twice. A read without `text` has no
`kept`.

## POST /share/lists/{name}/items

Takes `{"text": "Milch", "sha": "3f9c1a0"}` and appends `- [ ] Milch` after the
last item line, or at the end of the note. Answers the `List` after the add.

With `"under": 4` the new line is a part of the item on line 4: it goes after
that item's parts, two spaces further in than the item's own line, as
[`s` in the todo pane](/reference/editor-keys/todo-pane.md#the-todo-pane) writes
one. An `under` that names no item adds an item of its own.

* `sha: null` creates the note when it is missing.
* Blank text answers `422`.
* A stale sha answers `409`.

## POST /share/lists/{name}/tick

Takes `{"line": 4, "done": true, "sha": "3f9c1a0", "day": "2026-11-03"}` and
answers the `List`. `day` is the date on the ticking device, which the lists app
sends, and `<today>` below is that date: the server runs in UTC, so its own date
is yesterday's for the first hour or two after midnight in Berlin. A tick without
`day` takes the server's date. A `day` that is no date answers `422`.

Ticking to done writes `- [x] <text> ✅ <today>`, and a `🆔 kt-<6 hex>` after it
unless the line reads an id already. The `✅` goes before the id it reads. A
`🆔` with no word after it, one inside a link or code span, or one glued to
another field's value (`⏲ 5m🆔 kt-1`), reads no id, as in the editor, so the
line gets one. A `^block-id` that ends the line after a space or a tab, or is
the whole item, stays last, so `- [ ] Brot ^abc` becomes
`- [x] Brot ✅ <today> 🆔 kt-… ^abc`. That is the rule the read uses to drop it.
Unticking writes `- [ ] <text>` and strips the `✅` date, keeping the blank
before it where text is glued to the date: `Brot ✅ 2026-01-015` becomes
`Brot 5`. With no blank on either side it writes one where the words would
read differently without it: `Brot✅ 2026-01-01mehr` becomes `Brot mehr`, but
`Brot✅ 2026-01-01📅 2026-02-02` becomes `Brot📅 2026-02-02`. Both take only the done field the line reads, a `✅` with a date
outside a link or code span: a bare `✅` among the words, or one inside a code
span, stays as it is.

A tick to done takes the item's open parts along, as kasten's completion does:
every part under it, parts of parts too, in any state but done and rejected,
becomes `[x]` with `✅ <today>` and no `🆔`, and a waiting part loses its dated
`👤`. A part already done or rejected stays. Unticking an item leaves its parts as
they are, and a part ticks and unticks alone like any item.

A tick whose line is already in the asked state, or is not an item, answers
`200` and changes nothing. A stale sha answers `409`. A tick to done on a line,
or over an open part, that reads a recurrence, a `🔁` with a value outside a
link or code span, answers `422` `{"detail": "Tick this one in kasten"}` and
writes nothing: kasten's own cycle writes the next occurrence.

A tick to done also writes the done log line the todo pane writes, `- ✅ <today>
<words> [[<list>]] <id>`, under `## Done` in today's daily note, making the note
where the vault has none. The words are the item's without its fields, so an
assignee goes and tags stay: `- [ ] Milch #bio 👤 [[Anna]]` logs
`- ✅ <today> Milch #bio [[05 Shared/Einkauf]] kt-…`. An id a `- ✅` line names
anywhere outside the archive gets no second line. An untick drops every `- ✅`
line naming the item's id, wherever it stands. A line names the id when the id
is its last `kt-` word, or its last word where it has none, and the line stands
outside a code fence, so a log line of another todo whose words mention the id
stays. A tick or untick of an id another todo line carries too, in the list or
in another note, answers `422` `{"detail": "🆔 <id> is on another todo too: <note>
line <n>"}` and writes nothing, as the todo pane refuses it. The list is written first and the
daily note after it; [the share tick orderings](/reference/save-path-orderings/share-tick.md)
say what a failure between them leaves. `KASTEN_SHARE_LOGS_DONE=false` turns the
log write off, and with it that refusal.

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

## POST /share/lists/{name}/edit

Takes `{"line": 4, "text": "2x Milch", "sha": "3f9c1a0"}` and answers the
`List`. The words of the item or part on that line become `text`, joined onto
one line. The box, the indent, every field the editor reads (`👤`, `📅`, `🔁`,
`➕`, `✅`, `🆔`, `⛔` and the rest) and a trailing `^block-id` stay as written.
The fields follow the new words in the order they stood, one space apart, so
words that sat between two fields, such as a tag after the assignee, move before
them: `Milch 👤 [[Alicia]] #bio 📅 2026-11-20` edited to `2x Milch #bio` becomes
`2x Milch #bio 👤 [[Alicia]] 📅 2026-11-20`.

A field typed into `text` is written as one: `Milch 📅 2026-12-01` adds a due
date. Text that leaves the item no words, blank or only fields, answers `422` and
writes nothing. A line that is no item, or words the line has already, write
nothing and answer the `List`. A stale sha answers `409`.

## POST /share/lists/{name}/delete

Takes `{"line": 4, "sha": "3f9c1a0"}` and takes the item or part on that line
out of the note, with every part under it. A part goes alone. The vault's history
keeps the lines. Answers the `List`; a line that is no item writes nothing, and a
stale sha answers `409`.

## POST /share/lists/{name}/clear

Takes `{"sha": "3f9c1a0"}` and removes each done item at the margin with its
parts, when every part is done or rejected. An item with a part still open stays,
and so does a done part of an open item, which counts in its `1/3`. Nothing else
changes. Answers the `List`, and a stale sha answers `409`.

## GET /share/meals

Answers the meals of the [week plans](/reference/food/meal-plan.md) in the
shared folder for the lists app's Essen tab, from `today` through the six days
after it. `today` is the device's date, `YYYY-MM-DD`, as a tick sends it; the
server's date stands in when it is left out. A plan reads only when its
frontmatter says `type: Meal Plan` and names a `week`. Training days and
protein stay in kasten.

```json
[
  {
    "date": "2026-11-09",
    "meals": [
      { "slot": "lunch", "kind": "from", "dish": "Chili sin carne", "servings": null, "cook": null },
      { "slot": "dinner", "kind": "cook", "dish": "Linsen-Dal", "servings": 4, "cook": "Alicia" }
    ]
  }
]
```

Only days with a meal come back, in date order, lunch before dinner. `dish` is
the recipe's name for a `cook` or `from` meal, else the line's words with link
brackets and the cook taken off. Nothing is written.

## GET /share/events

Answers a server-sent event stream in the wire format of
[`GET /api/events`](/reference/http-api/system.md). It carries only the events
for paths inside the shared folder. A change to any other note sends nothing:
the filter reads each event as the watcher yields it, so such a change never
reaches the stream. The watcher runs in a task of its own, so a keepalive goes
out without cancelling it.

The stream is not compressed, as [the reverse-proxy page](/reference/reverse-proxy-routes.md#rules)
says for the other streams.

## Related

* [Shared lists](/explanation/shared-lists.md): why the lists are notes, and how a conflict is settled
* [Configuration](/reference/configuration.md): `KASTEN_SHARE_FOLDER`, `KASTEN_SHARE_HOST` and `KASTEN_SHARE_PEOPLE`
* [Reverse-proxy routes](/reference/reverse-proxy-routes.md): which gate covers these routes
