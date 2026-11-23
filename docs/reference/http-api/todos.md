---
type: Reference
title: "HTTP API: todos"
description: The todo store's routes, the line reader the import uses, the devices a todo reminder is pushed to, when pushes go, and the timers that push.
resource: backend/src/kasten_backend/todos/serve/route.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: todos

The todo store's routes, the reader of the vault's todo lines the import uses, and the push reminders.

## GET /api/todos

Answers the todos in the store as the lines the app parses, each rendered from
its row, in the shape `GET /api/search` returns plus `project`, `shared` and
`todo`, the row itself. It takes the filters of
[`GET /api/todos/rows`](#get-apitodosrows). A part sits under its parent, one
indent deeper, in its top todo's note, so a part whose parent lives in another
note still reads as its part. Every line carries its id. A waiting todo shows
its look-again day as `🛫`. A soft due date shows as `📅` too; `todo.due_hard`
tells the two apart.

`line` numbers each todo within its note, in that order; the note holds no such
line, only the embed. With no filter it adds each running timer as the `## Time`
line the timer reads, `- 14:03- words kt-3f9a2c`, in the daily note of the day
it started.

```json
[{ "path": "02 Projects/kasten/plan.md", "line": 1, "text": "- [/] wire up the pane ⏫ ➕ 2026-08-09 📅 2026-08-14 🆔 kt-3f9a2c", "project": "02 Projects/kasten", "shared": false, "todo": { "id": "kt-3f9a2c", "due_hard": true } }]
```

## The line reader

Before the store, `GET /api/todos` answered the vault's lines. The import still
reads them, with [the line reader](/reference/todo-format/the-line-reader.md).

## The store

The routes of the todo store in Postgres
([Todos in Postgres](/explanation/vault-and-derived-index/todos-in-postgres.md)).
Nothing in the app calls them yet; the pane moves to them with the import. Each
write answers every row it touched, shaped as `GET /api/todos/rows` shapes one,
and records each row before and after under `by: browser`. An unknown id
answers `404`.

A row carries `id`, `words` (tags where typed), `description` (free text under
the words, whose `[[links]]` are the notes the todo links to), `state`, `tags`, `note`,
`shared_list`, `project`, `parent_id`, `position`, `round_of`, `epic`,
`epic_id`, `blocked_by`, `repeat`, `on_completion`, `priority`, `planned`,
`hold_until`, `due`, `due_hard`,
`assignee`, `waiting_on`, `waiting_since`, `look_again`, `remind_at`,
`estimate` and `worked` in minutes, `created`, `done`, `cancelled`, `updated`
and `version`.

On every write `tags` is read off `words`, and a todo with no parent and no
shared list left with no due date gets a soft one 14 days on. A `blocked_by`
naming a todo still open makes an open todo blocked, and taking the last one
off opens it. An id that names no todo holds nothing. A `parent_id` that names no todo, the todo itself or
one of its own parts answers `422`, as does an `epic_id` that names no todo
marked `epic`, or the todo itself. Setting `epic` to false clears `epic_id` on
every todo that counted toward it.

## GET /api/todos/rows

Every todo, in note, parent and position order. The archive's only with
`archive=true`.

## POST /api/todos/line

Adds the todo a typed line says: `{"text": "- [ ] call the bank 📅 2026-12-01",
"note": null, "parent_id": null}`. The fields read as the import reads them, and
the box names the state. With no note and no parent it lands in today's daily
note. Answers `201` with every row it wrote.

## PUT /api/todos/{todo_id}/line

Changes a todo to what its edited line says: `{"text": "…", "version": 3}`,
`version` being the one the line was read at. A stale version answers `409`
and writes nothing, as `PATCH` does. Words and fields
take the line's values, a field left off is cleared, and a box that changed
runs the state change with all it stamps and drags along. A due date the line
keeps as it was stays soft if it was soft. Stamps (`➕`, `✅`, `❌`) and the
worked time stay the store's. A line whose `#p/x` tag or project link names
another project than before sets the todo's project by
[the board's order](/explanation/the-todo-board.md), and each part whose project
that order gave it follows. Answers every row it touched.

## POST /api/todos/import

Moves the vault's todo lines into the store, as
[the import](/explanation/vault-and-derived-index/todos-in-postgres.md#the-import)
says, and answers `{"report": "…", "written": true}`. Without `write=true` it
writes nothing and reports what it would do: open lines against open rows, ids
not found, the count in each state and the parts. A second run finds no lines
left and changes nothing.

## POST /api/todos

Adds an open todo, created today, and answers `201` with the row. With no
`project`, it takes the folder a `#p/x` tag names, else its parent's. A
`blocked_by` id that names no todo answers `422` and writes nothing, here and
on `POST /api/todos/line`.

## PATCH /api/todos/{todo_id}

Changes the fields named. Takes the `version` it read and answers `409` for any
other. A `blocked_by` that adds an id naming no todo answers `422`; an id the
todo already had stays, as the rule above reads it.

## POST /api/todos/{todo_id}/state

Puts the todo in `state`, with what that drags along:

* **Done** stamps `done` and ticks every open part. On a todo with a `repeat` it
  writes the finished round as a done row of its own, `round_of` naming the todo
  and its parts copied under it, with their closed timer sessions. A session
  still running stays on the todo, so stopping it counts toward the next round. It moves the todo
  and its parts on by the rule, counted off a hard due date, else the planned
  date, else hold off until, else the soft due date, each of the three moved by
  the same step: open, with no `done`, `worked` or wait. The todo keeps
  its id.
* **Rejected** stamps `cancelled`. Leaving either state drops its stamp, and
  closing or reopening a todo moves what it blocks between open and blocked.
* **Waiting** stamps `waiting_since` unless it has one, and takes `look_again`
  (seven days on when not given) and `waiting_on`. Sent again to a waiting todo
  with either, it moves the wait on: chasing, or waiting longer. Leaving waiting
  clears all three.

## POST /api/todos/{todo_id}/cycle

Walks the todo one step: open, doing, done, open. Review goes to done, blocked
and waiting to doing, rejected to open.

## POST /api/todos/{todo_id}/timer

Starts a session, or stops every one running and sums the closed ones into
`worked`. A session running 12 hours or more was left on: it closes at 23:59 of the day it began.

## DELETE /api/todos/{todo_id}

Deletes the todo and its parts, answering `204`. Each one's delete is recorded
and its history stays. Their ids leave the `blocked_by` of every todo they
held, and a blocked one that nothing else holds opens.

## GET /api/todos/{todo_id}/history

Every write to the todo, oldest first: `at`, `by`, `before` and `after`, each
row as JSON or `null`.

## The day plan

A day's plan is blocks, each `focus` or `batch`, with the todos picked for it.
A pick sets the todo's `planned` to the plan's day and moves no other date;
when the day ends the pick is over and the todo keeps its dates. At most
`KASTEN_PLAN_FOCUS_BLOCKS` focus blocks a day (2) and `KASTEN_PLAN_FOCUS_TODOS`
todos in one (1); a week names at most `KASTEN_WEEK_OUTCOMES` outcomes (5). Past
a cap answers `422`, an unknown todo `404`.

## GET /api/plans/{day}

The day's plan: `day`, `saved`, `by`, and `blocks` in time order, each with
`starts`, `ends`, `kind`, `title` and `todos`, the picked ids in order. `404`
with none saved.

## PUT /api/plans/{day}

Saves the day's plan, `{"blocks": [{"starts": "09:00", "ends": "11:00",
"kind": "focus", "title": "memo", "todos": ["kt-3f9a2c"]}]}`, in place of the
one saved before, and answers it as `GET` does.

## GET /api/outcomes/{day}

The outcomes of the week `day` falls in, `[{"words": "ship it", "todo_id": "kt-3f9a2c"}]`.

## PUT /api/outcomes/{day}

Replaces the outcomes of that week with the list sent, and answers them.

## GET /api/brief/{day}

What a planning talk for the day starts from:

* `last_plan`: the latest plan before the day, each pick with its words and
  whether it got done (done or in review), and the counts `picked` and `done`
* `look_again`: waiting todos whose look-again day has come
* `due_soon`: todos with a hard due date in the next 14 days
* `outcomes`: the week's outcomes
* `todos`: the open todos the day's lists show, in a fixed order. First what
  the dates force, each with `why`: `planned` for that day, `due` within 3 days,
  `look again`. Then every other todo by priority, highest first and none
  between medium and low; within one priority a weekly outcome's todo first,
  then the nearer due date, then client work (`#client` on it or above it), then
  the older todo. `picked` counts the earlier plans that picked each.

## Reminders

A todo with a reminder (`remind_at`, written `⏰ YYYY-MM-DD HH:MM` on its line) sends a web push at that time to every device
subscribed here. The devices sit in the `push_devices` table in Postgres, and
each reminder sent in `push_sent`. A loop in the backend wakes every 15
seconds and reads the todo store for reminders on every fourth wake, so each minute;
only the worker holding a Postgres advisory lock sends. It sends what fell due in the
last hour and was not sent yet, so a missed reminder goes out late when it is
under an hour old and never after, bar quiet hours as below. A sent reminder is known by its note, time
and words, so a restart or a line moved within its note does not send it again.

Only an open todo reminds: not done or rejected, nor one whose note is in the
archive. The time is read in `KASTEN_TIMEZONE`. The message is
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
line as the push carried it and `action` is `done` or `tomorrow`. The todo is
found by the `🆔` on that line, in the store. `done` runs the store's done, as
the todo pane's tick does: its open parts, its next round, the todos that waited
on it. `tomorrow` moves its reminder to the same time on the day after today.
Today is read in `KASTEN_TIMEZONE`, and the history names the writer `push`.

`204` once written. `409` and nothing written when the line carries no id, or
the todo is closed or has no reminder. A push sent before the store carried no
id on its line, so its buttons answer `409`.

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
