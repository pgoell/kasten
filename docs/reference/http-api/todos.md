---
type: Reference
title: "HTTP API: todos"
description: The route that finds every todo line in the vault and the project each belongs to, the devices a todo reminder is pushed to, when pushes go, and the timers that push.
resource: backend/src/kasten_backend/routes/queries.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: todos

The route that finds every todo line in the vault, and works out which project each one belongs to.

## GET /api/todos

Finds every line in the vault that could be a todo. Takes an optional
`archive` and answers with at most 100,000 matches, in the shape
`GET /api/search` returns plus a `project` and a `shared` on each.

```json
[{ "path": "02 Projects/kasten/plan.md", "line": 12, "text": "- [/] wire up the pane 📅 2026-08-14 ⏫", "project": "02 Projects/kasten", "shared": false }]
```

`shared` is `true` when the todo's note sits directly inside the share folder,
`05 Shared` by default: `05 Shared/Einkauf.md` is shared, `05 Shared/sub/x.md`
and `05 Sharedx/a.md` are not. It is the rule the share lists are read by, so
the client can hide the shared lists from the todo views without a rule of its
own.

Each note's lines are read as search's `rg` reads them, over the notes
`GET /api/files` lists, so the two cannot disagree about which notes the vault
holds. A note's todo lines are held in memory and parsed again only when its
modification time, change time, size or inode moves (#1758). Nothing is indexed
and Postgres is not consulted, for the reason search does not consult it: the
files are the source of truth.

It matches two shapes, and sends the lines below that end a todo's parts:

* a checkbox list item at any indent, in any of
  [the seven states](/reference/todo-format/state-changes.md#the-seven-states): `- [ ]`,
  `- [/]`, `- [r]`, `- [x]`, `- [X]`, `- [b]`, `- [w]` or `- [-]`
* a running session line, `- 14:03- …`, with no end time on it

`[X]` is matched because another editor writes it that way, and `[R]` is not,
because nothing does. `[` is not one of
the state characters, which is what keeps `- [[borges]]` out, and the `- `
anchor is what keeps `1. [ ] ordered` out. The done log's `- ✅` line does not
match either, which is
[the whole reason it is not a checkbox](/reference/todo-format/time-and-repeats.md#the-done-log).

A closed session line, `- 09:12-10:32 …`, is deliberately not matched. The pane's
`t` writes both spellings into the
[time log](/reference/todo-format/time-and-repeats.md#the-time-log), and a running one comes back
in the same pass as the todos because the view wants to know what is going. A
closed one says nothing the task line does not already carry, the total being on
it, and the closed ones are the half of that log that piles up. A stop reads them
through `GET /api/search` on the todo's id instead, which is one narrow pass at
the press rather than a growing answer on every fetch.

The endpoint serves no todo's state or fields. It hands the lines over whole,
because the editor has to parse a line anyway and two parsers in two languages
drift. Whether one of them is open or overdue is read on the client, off the
same module the editor draws a todo with. That is also how the client tells a
session line from a todo, which is why one endpoint can answer both. The one
thing the backend works out is `project`, below, and to find the words it reads
a project from, it takes the fields off a line the way the editor does.

### The project

`project` is the project folder a todo belongs to, as a path from the vault
root, `"02 Projects/FDE"`, or `null` for none. The board draws its lanes by it,
and an agent reading this endpoint sees the same lanes. The first of these that
answers wins:

1. A `#p/x` tag on the todo, else on the nearest todo above it that it is a part
   of and that carries one.
2. The note's project folder: a folder directly under `02 Projects` or
   `03 Areas`, with the note at any depth inside it. A note directly in one of
   those two, or outside them, has none.
3. The first `[[link]]` on the line that lands on a note that exists, in a
   folder under `02 Projects`. Areas do not count here.
4. The project of the todo it is a part of, by this same rule.
5. `null`.

Tags and links are read off the todo's words, as the editor parses them: a
link inside a field's value, such as `👤 2026-10-01 [[Vendor]]` or
`🔁 every week [[Vendor]]`, files nothing.

A part is a todo indented under another: its parent is the nearest todo above
it in the same note with a smaller indent, a tab counting as one, with prose in
between ending nothing. A heading, or a list item that is no todo, ends the parts
above it at its indent, as the
[writes end them](/reference/todo-format/state-changes.md#subtasks). A
session line is no todo, has `project: null` and is nobody's parent, and so is
a line the editor does not read as a todo, such as one holding a lone `\r`,
U+2028 or U+2029. A CRLF line comes without its `\r`, as the note read
`GET /api/files/{path}` answers it, so it is the todo its LF twin is. Done, rejected and archived todos follow the same rule.

How a tag names a folder:

* A tag is read as Obsidian reads one: a letter or `_`, then letters, digits,
  `_`, `/` and `-`, with no letter, digit, `_` or `/` straight before the `#`.
  So `#p/fde.` at the end of a sentence is `#p/fde`. Inside a `[[link]]` or a
  code span counts too, as it does for the board's own tags.
* `#p/` matches with case ignored, so `#P/FDE` counts.
* `#p/x/y` names `x`, and `#p/` alone names nothing.
* `x` names a folder directly under `02 Projects` that holds at least one note.
  Case is ignored, and a `-` or `_` on either side stands for a space:
  `#p/japan-honeymoon-2027` names `02 Projects/Japan Honeymoon 2027`.
* A tag that names no folder is passed over. Of two tags, the first, left to
  right, that names a folder wins.

A link lands when it resolves, by the rule `GET /api/files` and the editor
share, to a note in that listing, which holds the archive too.

The cap is 100,000 rather than search's 2,000, and the two numbers are doing
different jobs. Search guards a query that can match anything in the vault. This
one is a backstop against a single generated file with a million list items in
it, and nothing else: reaching it truncates the answer silently, which is why it
sits where nothing written by hand reaches it.

### Fences and the lines that end parts

The pattern matches a line rather than a parse tree, so it also takes every
line opening with three backticks or tildes at any indent. A note with such a
line, or with an indented todo, is then read whole (#1445):

* A line inside a fenced code block is dropped, a `- [ ]` in a note about
  markdown among them. markdown-it finds the fences, so one under a nested list
  item counts and one in a list item ends with the item (#1555). Fences are found
  in the body alone, so a fence the frontmatter seems to open hides nothing.
* In a note with an indented todo, every heading and every list item that is no
  todo, between the first todo and the last indented one, comes back as a line
  of its own with `project: null`. Those are what can end a part, and the pane
  reads them to draw what ticks together. A client that wants todos alone keeps
  the lines its own todo parser reads, as it does for session lines.

The fence lines themselves never come back, and a note whose only hits are
fence lines is not read. On the live vault, 33 of the 136 notes holding a todo
are read whole, which adds 15 to 20 ms to the answer.

A vault directory that does not exist reads as an empty one, so a fresh
checkout still serves.

## Reminders

A todo with `⏰ YYYY-MM-DD HH:MM` sends a web push at that time to every device
subscribed here. The devices sit in the `push_devices` table in Postgres, and
each reminder sent in `push_sent`. A loop in the backend wakes every 15
seconds and reads the vault for reminders on every fourth wake, so each minute;
only the worker holding a Postgres advisory lock sends. It sends what fell due in the
last hour and was not sent yet, so a missed reminder goes out late when it is
under an hour old and never after, bar quiet hours as below. A sent reminder is known by its note, time
and words, so a restart or a line moved within its note does not send it again.

Only an open todo reminds: not `[x]`, `[X]` or `[-]`, nor one in a fence, a
code span or the archive. The time is read in `KASTEN_TIMEZONE`. The message is
encrypted for the device (RFC 8291) and carries `{"title", "body", "path",
"line", "tag", "text"}`: `body` is the todo's words without its box, fields and
`⏰`, `text` the todo line as the note holds it, and a tap opens
`/?note=<path>&line=<line>`. Where the browser shows notification buttons
(`Notification.maxActions` above 0, as Android Chrome; not iOS), a reminder
gets **Done** and **Tomorrow**, which call
[POST /api/push/act](#post-apipushact) with `path` and `text`. Any answer but
its `204`, a redirect to sign-in or no answer within 4 seconds included, opens
the note at its line instead. A push service that answers `404` or
`410` drops that device; any other failure keeps it and is logged with the
first 200 characters of the push service's answer, such as Apple's
`BadJwtToken`. Should the loop itself stop on an error it does not expect, the
backend logs `push sender stopped` and no push goes out until it restarts.

Quiet hours, set in `/settings`, hold every reminder, the morning push and
the goals push, but not a timer, which you started yourself. At a tick inside
them nothing goes and nothing is recorded. At their end a reminder goes when it fell due
inside them, or up to an hour before they began, so its late hour starts again
from their end. Quiet hours whose start is after their end run across midnight.

The morning push, when its time is set, sends one message at that time with
every open todo due (`📅`) or scheduled (`⏳`) today: title `Today`, body the
todos' words one per line, and a tap opens today's daily note. It goes once a
day, recorded in `push_sent`, keeps the same late hour, waits out quiet hours,
and does not go on a day with nothing due.

The goals push, when its time is set, sends one message at that time for each
`min` goal of the [log config](/reference/food/log-format.md) that today's `## Log`
falls short of, read as the log pane reads goals: the built-in kinds, your own
kinds (a `last` kind with no line today counts as not met) and the food fields.
Title `Goal`, body such as `💧 water: 500 of 2000 ml`, and a tap opens today's
daily note. A `max` goal sends nothing. Each goal goes once a day, recorded in
`push_sent`, with the same late hour and quiet hours as the morning push; none
goes when every `min` goal is met.

## GET /api/push

The key a browser subscribes with, `null` when `KASTEN_PUSH_PRIVATE_KEY` is not
set, and every device, oldest first. The device's keys are never sent back.

```json
{ "public_key": "BP4z9KsN6nGRTbVYI_c7…", "devices": [{ "id": 1, "name": "Android Chrome", "endpoint": "https://fcm.googleapis.com/fcm/send/…", "created": "2026-11-08T21:40:02Z" }] }
```

## GET /api/push/settings

When pushes go: the morning push's time, the quiet hours and the goals push's
time, each `HH:MM` or `null` for off. All four are `null` until first saved. The one row sits in the
`push_settings` table.

```json
{ "morning": "07:30", "quiet_start": "22:00", "quiet_end": "07:00", "goals": "20:00" }
```

## PUT /api/push/settings

Stores the same body and answers it back; the sender reads it on its next tick.
`goals` may be left out, which stores `null`.
`422` when only one end of the quiet hours is set, when they start where they
end, or for a time that is not one.

## POST /api/push/devices

Subscribes a device. The body is the browser's `PushSubscription.toJSON()`
plus a `name`: `{"endpoint", "keys": {"p256dh", "auth"}, "name"}`. The endpoint
must be `https://`. The same endpoint again updates that device's keys and name
rather than adding a second one. Answers `201` with the device as `GET` lists
it, or `503` when push is not set up.

## POST /api/push/devices/{device_id}/test

Sends one device the push `{"title": "kasten", "body": "Test push: this device
gets reminders", "tag": "test"}` now and answers `200` with what its push
service said: `{"status", "reason", "gone"}`. `status` is the push service's
HTTP status, or `null` when it could not be reached, and then `reason` says
why. On a status of `300` or more `reason` holds the start of the push
service's answer, or `null` when it gave none. A `404` or `410` sets `gone`
and removes the device, as the loop does. `404` for an id no device has, and
`503` when push is not set up. A `2xx` means only that the push service took
the message: a browser or phone that blocks this site's notifications still
shows nothing.

## DELETE /api/push/devices/{device_id}

Removes a device, so no push goes to it again. `204`, or `404` for an id no
device has.

## POST /api/push/act

A button on a reminder: `{"path", "text", "action"}`, where `text` is the todo
line as the push carried it and `action` is `done` or `tomorrow`. The line is
found by its text in the note, since its number may have moved. `done` ticks it
as the share tick and the todo pane do: `✅` and today's date, a `🆔` when it
has none, its open parts taken along, and a `- ✅` line under `## Done` in
today's daily note. `tomorrow` moves its `⏰` to the day after today, time kept.
Today is read in `KASTEN_TIMEZONE`, and the history names the writer `push`.

`204` once written. `409` and nothing written when no line or two lines of
the note read `text`, or the line is no open todo with a `⏰`. `422` and nothing
written for `done` where the pane writes more than a tick: a recurring todo or
part, a `🆔` another todo carries, or a `🆔` a `⛔` names.

## Timers

A timer pushes its label to every subscribed device when it falls due. Timers
sit in the `push_timers` table and the same loop sends them, on every wake, so
one rings within 15 seconds of its time. A one-off timer is deleted once it
rings. A repeat, one with `every`, moves its `due` on by that many seconds
instead, to the first step after now, and is deleted once that step would pass
`until`. One down for more than an hour is moved on or deleted without a push,
as a missed todo reminder is. A timer rings through quiet hours, and rings,
moves on or goes even when no device is subscribed.

The message carries `{"title", "body", "tag", "renotify"}`: `body` is the label,
`tag` is `timer-<id>`, so a repeat's next push replaces its last one, and
`renotify` is `true`, so that replacement still sounds. With no `path`, a tap
opens `/`.

## GET /api/push/timers

Every running timer, the next to ring first. `due` is when it rings next.

```json
[{ "id": 4, "label": "Washer", "due": "2026-11-12T08:42:13Z", "every": null, "until": null, "created": "2026-11-12T07:17:13Z" }]
```

## POST /api/push/timers

Starts a timer: `{"label", "due", "every"?, "until"?}`. `label` is 1 to 200
characters, `due` and `until` are times with an offset, `every` is seconds, at
least 60. A `due` of now rings on the next wake. Answers `201` with the timer
as `GET` lists it, or `422` for an empty label, a time with no offset, an
`every` under 60, or an `until` before `due`, and `503` when push is not set
up, since the sender that rings and clears timers never starts then.

## DELETE /api/push/timers/{timer_id}

Stops a timer, or a repeat, before it rings again. `204`, or `404` for an id no
timer has.
