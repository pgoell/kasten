---
type: Reference
title: Training pane
description: The training pane's tiles, what each one reads off the training lines and how it is worked out, the lift in depth with its deload weeks and records, the overview card and the week review's training section.
resource: frontend/src/components/log/training/training-pane.tsx
tags: [training, frontend, charts]
status: draft
---

# Training pane

A pane of tiles that shows how the training is going, read only off the
[training lines](/reference/training/training-format.md) under `## Training`
in the daily notes, and the weigh-ins under `## Log`. It writes nothing.
`<leader>gF` opens it in the focused pane; its keys are in
[the editor keys](/reference/editor-keys.md#the-training-pane).

## Span

Two tabs at the top: `12 weeks`, the default, and `Year`, 52 weeks. A week runs
Monday to Sunday, and the last week is the one holding today. The pane reads a
year of training in one request, `GET /api/training` from 364 days back to
today, so the records always count against the year before.

## Tiles

| Tile | Figure | Words | Chart |
| --- | --- | --- | --- |
| One per main lift | the lift's best e1RM in the last week that has one | the change between the first and last week with an e1RM | a sparkline of the best e1RM per week |
| Cardio | this week's minutes | the weekly target, 150 min | minutes per week stacked as walking, cycling and jogging, the target as a dashed line |
| Body weight | the last 7-day average | the change since the first weigh-in in the span | the 7-day average per day |
| Sessions | sessions in the span | sessions a week on average | none |
| 5 km pace | the pace of the latest run of 5 km or more | the best such pace | none |
| Records this week | records set since Monday | each record in words | none |

* **Main lifts**: the strength exercises that have an e1RM, most often trained
  first by days in the span, at most four. The e1RM is the line's own, the
  Epley estimate the training format gives.
* **Cardio target**: 150 minutes a week, the WHO's figure, until a block note
  sets its own (#1719). The words under the chart count the weeks that met it.
* **Body weight**: the log's last kind with the mark `⚖`, the 7-day average the
  log pane draws, over the span's days.
* **Session**: a day with at least one set or cardio line. A day with only a
  mobility test is no session.
* **5 km pace**: the minutes of a run line over its kilometres, for runs of
  5 km or more, written as `5:24 /km`.

A lift tile is a button: a click, a tap or `Enter` opens the lift in depth.
With no training line in the span, the pane says so under the tiles.

## A lift in depth

`All tiles` or `Escape` goes back.

* **Estimated 1RM**: the best e1RM per week, as a line, with the deload weeks
  shaded. A week reads as a deload when the lift's volume, kilograms times
  reps, falls under 60 % of the mean of the up to three trained weeks before.
  A block note will mark its own deload weeks (#1719).
* **Heaviest set**, **Most reps** (the most reps in one set, the heavier
  weight winning a tie) and **Most volume** (the most kilograms in one
  session) over the span.
* **Last sessions**: the last five days with the lift, newest first, each as
  "last time" reads on the session screen, `80 kg · 8 8 7`.

## Records

A day sets a record when it beats the best of every day before it in the year
read:

* the heaviest set of a lift;
* the most reps in one set at a given weight, one record per weight a day;
* the most kilograms of a lift in one day.

The first day of a lift, or of a lift at a weight, sets no record, since there
is nothing yet to beat. A body weight set has no weight, so it counts toward
none of them.

## Elsewhere

* **Overview**: a Training card, last of nine, with the sessions this week, the
  cardio minutes this week and the weeks in a row with a session, a week with
  none ending the run unless it is the current one. Its chart is sessions per
  week over 8 weeks; it opens this pane.
* **Week review**: a Training section in the weekly note with the week's
  sessions, sets and cardio minutes, and the records it set.
