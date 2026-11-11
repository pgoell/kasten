---
type: Reference
title: Training session
description: The training card on a daily note and the session screen it opens, what each part shows, what each button writes under ## Training and when a set extends a line, the rest timer, the defaults and steps, and the cardio form.
resource: frontend/src/lib/log/training/session-screen.ts
tags: [training, frontend, phone]
status: draft
---

# Training session

A screen for the gym: one exercise at a time over the whole window, every set
written to the daily note the moment it is done. The note is the only record,
so closing the screen, locking the phone or losing the tab loses nothing. The
lines it writes are [training lines](/reference/training/training-format.md).
Using it is [Log a session on your phone](/how-to/training/log-a-session-on-your-phone.md).

## The card

A daily note shows a training card when it has a `## Training` heading, under
that heading, and on today's note when it has none, under the title after the
Log card. It reads the day in short, `2 exercises · 6 sets · 25 min cardio`,
or "No training logged yet", and holds one button, `Start session`, or
`Continue session` once the day has a line. The day the card opens the
session for is the note's own.

## The screen

It asks to keep the screen on through the Wake Lock API, as cook mode does,
and says at the top whether it may. `Done` at the top closes it. A bar under
it holds a segment per exercise of this session: done ones filled, the current
one outlined. Every button is at least 48 px tall and needs no keyboard.

### The list

The first view, and the one each exercise goes back to. It holds:

* `Walk`, `Run` and `Ride`, each opening the cardio form for the notes
  `Gehen`, `Joggen` and `Radfahren`;
* a search field, which matches the start or any part of a name or an alias,
  ignoring case;
* with the field empty, `Today` (the exercises already in the note) and
  `Recent` (those trained in the 90 days before, most recent first), then
  `All`; with a search, `Found`. Each list shows at most 40.

The exercises are the notes
[`GET /api/training/exercises`](/reference/http-api/log.md#get-apitrainingexercises)
lists, without the tests. Each shows its primary muscles.

### An exercise

The exercise's name, `Exercise N · set M`, and below it a panel whose rows
follow the note's `counts`:

| `counts` | Rows | First value |
| --- | --- | --- |
| `weight-reps` | Weight, `−` and `+` by 2.5 kg, from 2.5 to 500; Reps, by 1 | The last set today, else the last line of the last day with this exercise, else 20 kg and 8 |
| `reps` | Reps, by 1, from 1 to 100; the line says `bw` | As above, else 8 |
| `time` | Time, by 5 s, from 5 to 600 | As above, else 45 s |

Every kind has an RPE row of 7, 8, 9 and 10. A press picks one, a press on the
picked one lets it go, and the pick stays for the next set until changed.

Under the panel come the sets the note holds for this exercise today, one row
each, `80 kg × 8 @8`, and "Last time" with the last earlier day's lines for it
in short, `80 kg · 8 7 7`.

`Set done, rest 2:00` writes the set and starts the rest timer.
`Skip exercise`, or `Next exercise` once a set is in, goes back to the list and
writes nothing.

### The cardio form

For a note whose `kind` is `cardio`, and for `Walk`, `Run` and `Ride`: Minutes
by 5 from 1, 30 to start, and Distance by 0.5 km, where 0 writes no distance.
Any cardio note but `Gehen`, `Joggen` and `Radfahren` also gets a choice of
Walk, Run or Ride for the line's marker; on those three the note sets it. `Save` writes the line and goes back to
the list. A run from the watch comes in on its own once the Garmin job exists
(#1720).

## What a button writes

Each write is one change to the open note, through the editor, so the note's
own save takes it, and one `u` takes back one set.

| Press | Writes |
| --- | --- |
| `Set done` on a weight or reps exercise | When the last strength line of this exercise under `## Training` has the same weight, or is `bw` for a reps exercise, and is not timed: the reps added to its end, and its RPE replaced by the set's when the set has one. Else a new line, `- 🏋 [[Kniebeuge]] 82.5 kg 8 @8` |
| `Set done` on a time exercise | When the last line of this exercise is timed at the same time: its count up by one, `2x 45 s` to `3x 45 s`. Else `- 🏋 [[Plank]] 1x 45 s` |
| `Save` on the cardio form | `- 🚲 [[Radfahren]] 25 min 8 km`, a marker of 🚶, 🏃 or 🚲 |

A line keeps one RPE, the format's rule, so a line whose sets were rated
7, 8 and 9 reads `@9`. An extended line keeps its marker, link and alias as
written. A new line goes at the end of the first `## Training`; a note without
one gets the heading at its end. The screen and the card read the lines under
every `## Training` of the note, spelled just so: a `### Training` or
`## training` is not the log. Weights and distances are written with a
point and no trailing zeros, `82.5`, `8`.

## The rest timer

A bar at the bottom: "Rest after set N" and the time left, starting at 2:00.
`+30 s` adds half a minute, also after the time is up; `Go` ends the rest. At
zero the phone vibrates three times and plays a short tone where it can, and
the bar reads "Rest over" until `Go` or the next set.

## What it does not do yet

The block note (#1719) will fill in the day's session and the sets its rule
asks for; until then each exercise is picked by hand.
