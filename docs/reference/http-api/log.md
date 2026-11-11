---
type: Reference
title: "HTTP API: log"
description: The route that adds up each day's water, coffee, alcohol and food from its daily note, the one that reads its training lines, the one that adds a job's training lines, the one that lists the exercise notes, and the one that lists the training block notes.
resource: backend/src/kasten_backend/log.py
tags: [api, backend, openapi]
status: stable
---

# HTTP API: log

The route that adds up each day's water, coffee, alcohol and food from its daily note,
the one that reads its training lines, the one that adds a job's training lines, the
one that lists the exercise notes, and the one that lists the training block notes.

## GET /api/log

Takes `from` and `to`, both `YYYY-MM-DD`, and answers with a list of days, oldest
first. A day is in the list when its daily note in the range has a `## Log`
heading. A day without one is absent. A day whose `## Log` is empty is there,
with zeros.

```
GET /api/log?from=2026-10-20&to=2026-10-20
```

```json
[
  {
    "date": "2026-10-20",
    "path": "01 Periodic/00 Daily/2026-10-20.md",
    "entries": [
      { "line": 7, "text": "- 🍺 1 0.5 l 5%", "kind": "alcohol", "ml": 500.0, "count": 1, "abv": 5.0, "grams": 19.7, "meal": null, "words": null, "kcal": null, "protein": null, "carbs": null, "fat": null },
      { "line": 8, "text": "- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g 🍞 10 g 🧈 0 g", "kind": "food", "ml": null, "count": null, "abv": null, "grams": null, "meal": "lunch", "words": "Skyr", "kcal": 160.0, "protein": 27.0, "carbs": 10.0, "fat": 0.0 }
    ],
    "totals": {
      "water": { "ml": 0.0 },
      "coffee": { "count": 0 },
      "alcohol": { "count": 1, "ml": 500.0, "grams": 19.7 },
      "food": { "kcal": 160.0, "protein": 27.0, "carbs": 10.0, "fat": 0.0 }
    }
  }
]
```

Every field of an entry is there, `null` where its kind has none. Every total
is there too, zero where nothing was logged, or `null` for a last kind with no
line that day. The lines are read as
[the log format](/reference/food/log-format.md) describes them.

### Kinds of your own

A line of a kind of your own, named in the config note `99 Misc/01 Config/log.md`,
is an entry with `"kind": "mine"`. It has four more fields: `mark`, `name`,
`amount` and `unit`. Built-in entries do not have these four fields at all.

```json
{ "line": 9, "text": "- 🍵 1 cup", "kind": "mine", "ml": null, "count": null, "abv": null, "grams": null, "meal": null, "words": null, "kcal": null, "protein": null, "carbs": null, "fat": null, "mark": "🍵", "name": "tea", "amount": 1.0, "unit": "cup" }
```

`totals.mine` holds one object per kind of your own the note names, in the
note's order, zero where nothing was logged. `total` is rounded to a tenth. On a
last kind (`- ⚖ weight: kg, last`), `total` is the amount of the day's last line
for that kind, as written, and `null` on a day with a `## Log` and no such line.

```json
"mine": [{ "mark": "🍵", "name": "tea", "unit": "cup", "total": 1.5 }]
```

A kind's line counts only when no built-in kind reads it first, and a built-in
kind counts whatever the note says. With no config note, `totals.mine` is left
out, and so are the four fields on every entry, so the answer is the one it gave
before the note was read. A note that is there gives `totals.mine`, which may be
`[]`. A note the backend cannot read, gone or not UTF-8, counts as no note.

## Errors

* `400` when `from` is after `to`.
* `422` when a date is not `YYYY-MM-DD` or names no day, `0` and `2026-02-30` among them.

## Reading

The route lists the daily folder once and reads the notes there whose names
fall in the range, so a wide range costs no more than the notes it holds. A
note it cannot read, gone or not UTF-8, is left out. The config note is read
once per request. It runs no search over the vault, and it keeps nothing in
Postgres or in an index. The archive is not read.

The route only reads. The log pane asks it twice: for the day shown, and for
the 7, 30 or 90 days that end on that day, from which the pane's Trends works
out its summary, charts, macro split and week table in the browser. Every line
the pane writes goes through the note's own save, never through this route.

## GET /api/training

Takes `from` and `to` as `GET /api/log` does, answers with the same errors, and
reads the daily notes the same way. A day is in the list when its note has a
`## Training` heading, and holds the lines under it that parse, in line order,
as [the training format](/reference/training/training-format.md) describes them. A day
whose `## Training` holds no such line is there with `"entries": []`. There are
no totals.

```
GET /api/training?from=2026-11-09&to=2026-11-15
```

```json
[
  {
    "date": "2026-11-09",
    "path": "01 Periodic/00 Daily/2026-11-09.md",
    "entries": [
      { "line": 11, "text": "- 🏋 [[Kniebeuge]] 80 kg 8 7 7 @8", "kind": "strength", "exercise": "Kniebeuge", "kg": 80.0, "bodyweight": null, "reps": [8, 7, 7], "sets": 3, "seconds": null, "rpe": 8.0, "e1rm": 101.3, "minutes": null, "km": null, "heart_rate": null, "groups": null },
      { "line": 12, "text": "- 🏃 [[Joggen]] 32 min 5.0 km ❤ 148", "kind": "run", "exercise": "Joggen", "kg": null, "bodyweight": null, "reps": null, "sets": null, "seconds": null, "rpe": null, "e1rm": null, "minutes": 32.0, "km": 5.0, "heart_rate": 148, "groups": null },
      { "line": 13, "text": "- 📏 [[Knie-zur-Wand]] L 11 cm R 9 cm", "kind": "test", "exercise": "Knie-zur-Wand", "kg": null, "bodyweight": null, "reps": null, "sets": null, "seconds": null, "rpe": null, "e1rm": null, "minutes": null, "km": null, "heart_rate": null, "groups": [{ "label": null, "left": { "amount": 11.0, "unit": "cm", "passed": null }, "right": { "amount": 9.0, "unit": "cm", "passed": null }, "value": null }] }
    ]
  }
]
```

Every field of an entry is there, `null` where its kind has none, and so is
every field of a test's group and value. `kind` is `strength`, `walk`, `run`,
`ride` or `test`.

## POST /api/training/days/{day}

Adds training lines under `## Training` in the daily note of `day`,
`YYYY-MM-DD`. The [Garmin sync](/reference/training/garmin-sync.md) writes
through it. The body holds one to fifty lines:

```json
{ "lines": ["- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131"] }
```

```json
{ "path": "01 Periodic/00 Daily/2026-11-11.md", "added": ["- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131"] }
```

`added` holds the lines written, in order. Every line is written, a copy of
one the note holds too, since two rides may read the same; the sender keeps
track of what it sent. A note without `## Training` gets the section at its end; a day with
no note gets one, made as `<leader>gd` makes it. Read and write share one hold
of the vault lock, so a browser save between them is not written over.

Every line must read as a [training line](/reference/training/training-format.md)
and hold no line break, or nothing is written and the answer is `422`. So is a
`day` that is no date, such as `2026-02-30`.

## GET /api/training/exercises

Every exercise note outside the archive folder, by name, ignoring case. An
exercise note is one whose frontmatter `kind` is `strength`, `cardio`,
`mobility` or `test`, in any case; where it sits does not matter.
[Exercise import](/reference/training/exercise-import.md#the-note) gives the
fields. Takes nothing and answers `200` with a list, empty in a vault with no
exercise notes.

```json
[
  {
    "path": "03 Areas/11 Fitness/Übungen/Kniebeuge.md",
    "name": "Kniebeuge",
    "kind": "strength",
    "counts": "weight-reps",
    "aliases": ["Squat"],
    "muscles_primary": ["quadriceps", "gluteal"],
    "muscles_secondary": ["hamstring"],
    "equipment": ["Langhantel"]
  }
]
```

`name` is the file name without `.md`, which is what a training line links.
`kind` comes back in lower case. `counts` is the note's when it is
`weight-reps`, `reps` or `time`; else `time` for cardio and mobility and
`weight-reps` for the rest. The lists are empty where the note gives none.
The session screen picks from this list; see
[Training session](/reference/training/session-screen.md).

## GET /api/training/blocks

Every training block note outside the archive folder, sorted by `start`, then
by path. A block note is one whose frontmatter `type` is `Training Block`, in
any case; where it sits does not matter. Takes nothing and answers `200` with a
list, empty in a vault with none.

```json
[
  {
    "path": "03 Areas/11 Fitness/Blöcke/Block 2026-11 Grundlage.md",
    "start": "2026-11-16",
    "text": "---\ntype: Training Block\nstart: 2026-11-16\nweeks: 4\n---\n\n# Block 2026-11 Grundlage\n…"
  }
]
```

`start` is the frontmatter's as written, empty when the note has none, and
`text` is the whole note. The browser reads the sections itself, as
[Block note](/reference/training/block-note.md) describes; the card, the
session screen and the training pane all read this list.
