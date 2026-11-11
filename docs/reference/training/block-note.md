---
type: Reference
title: Block note
description: The note a training block is planned in, its frontmatter, the Weeks, Sessions, Days and Cardio sections, how each progression rule sets a week's target, the deload, the card with the calendar and the exercise library, and how the next block is planned.
resource: frontend/src/lib/log/training/block/block-note.ts
tags: [vault, training, format, frontend]
status: draft
---

# Block note

A training block is a few weeks of planned sessions in one note, such as
`03 Areas/11 Fitness/Blöcke/Block 2026-11 Grundlage.md`. Where it sits does
not matter; its frontmatter makes it a block. It is plain markdown, so
Obsidian shows and edits the same note, and every change kasten makes is an
edit to its text.

```markdown
---
type: Training Block
start: 2026-11-16
weeks: 4
---

# Block 2026-11 Grundlage

## Weeks
- 1: RPE 7
- 2: RPE 8
- 3: RPE 8-9
- 4: deload

## Sessions
### A
- [[Kniebeuge]] 3x8-10, double, 80 kg
- [[Bankdrücken]] 3x5 @8, +2.5 kg, 60 kg
### B
- [[Klimmzüge]] 3x6, +1 rep, bw
- [[Plank]] 3x45 s

## Days
- Mon: A
- Thu: B

## Cardio
- 🚶 [[Gehen]] 150 min
- 🏃 [[Joggen]] long 30 min
```

## Frontmatter

| Field | Holds |
| --- | --- |
| `type` | `Training Block`, in any case; without it the note is no block |
| `start` | the first day, `YYYY-MM-DD`; without a date the note is no block |
| `weeks` | how many weeks; without it, the weeks `## Weeks` lists, and at least 4 |

The block runs from `start` for `weeks` × 7 days. It need not start on a
Monday.

## Sections

Each section is a `##` heading spelled as below, in any case. A line that does
not read is plain text and changes nothing.

### Weeks

`- N: words`, N counting from 1. The words may hold `RPE 7` or `RPE 8-9`, the
week's target effort, and `deload`. A week not listed is a build week with no
RPE.

### Sessions

A `###` heading per session, named by a capital letter, `### A`. Under it, one
line per exercise: a link to the exercise note and what it asks for, in any
order, commas optional.

| Part | Means |
| --- | --- |
| `3x8` or `3x8-10` | 3 sets of 8 reps, or of 8 to 10; `×` works too; without it, 3x8 |
| `3x45 s` | 3 sets held for 45 seconds |
| `@8` | the target RPE, where the week sets none |
| `double` | double progression |
| `+2.5 kg` | the weight grows by 2.5 kg a build week |
| `+1 rep` | the reps grow by 1 a build week |
| `80 kg` | the weight of the first week |
| `bw` | body weight |

### Days

`- Mon: A`, a weekday and a session letter, the same every week of the block.
`Mon` to `Sun` are read, and so are `Mo`, `Di`, `Mi`, `Do`, `Fr`, `Sa`, `So`.
A day without a line is a rest day.

### Cardio

A line per cardio kind, its mark first as in
[the training format](/reference/training/training-format.md): `🚶`, `🏃` or
`🚲`, a link and minutes.

* `- 🚶 [[Gehen]] 150 min` asks for 150 minutes a week. The lines without
  `long` add up to the week's cardio target, which the
  [training pane](/reference/training/training-pane.md) draws.
* `- 🏃 [[Joggen]] long 30 min` is one long session that grows by 10 % each
  build week, `+15 %` setting another share, and holds in a deload.

## A week's targets

A build week is any week not marked `deload`. For an exercise line, with B the
build weeks before this one:

| Rule | Reps | Weight |
| --- | --- | --- |
| `double` | the low end plus B, back to the low end once past the top | plus 2.5 kg each time the reps go back |
| `+X kg` | the low end | plus X × B |
| `+N rep` | the low end plus N × B | as written |
| none | the low end | as written |

So `3x8-10, double, 80 kg` asks for 3 × 8 at 80 kg, then 3 × 9, then 3 × 10,
then 3 × 8 at 82.5 kg.

A deload week takes the last build week's target and drops it: the weight to
60 %, rounded to 2.5 kg, the sets by a third, at least one, and the reps to
the low end. The RPE is the week's from `## Weeks`, else the line's, and a
deload week has none unless `## Weeks` gives one.

## The card

Under the title of a block note, the card says where the block stands today,
`Week 2 of 4 · RPE 8 · session A today`, and draws the calendar: a row per
week, named `W1` and its RPE or `Deload`, a column per weekday.

| A day | Looks |
| --- | --- |
| planned, a session letter on it | outlined |
| done, a set logged that day | filled |
| in a deload week | tinted |
| with cardio logged | a `♥` in the corner |
| today | its date in the accent colour |

Each day also says all this in words to a screen reader, `Mon 16 Nov,
session A, done, cardio`.

On a pane 600 px wide or more, the exercise library sits beside the calendar:
the strength and mobility notes from
[`GET /api/training/exercises`](/reference/http-api/log.md#get-apitrainingexercises),
narrowed to one primary muscle by the select above them. Drag an exercise onto
a day, or press it and then press a day, and it joins the session on that day.
On a phone the library is hidden.

An exercise added to a day goes to the end of that day's session:

* `weight-reps`: `- [[Name]] 3x8-12, double`
* `reps`: `- [[Name]] 3x8, +1 rep, bw`
* `time`: `- [[Name]] 3x30 s`

A day with no session gets the next free letter: a new `### C` at the end of
`## Sessions` and `- Sat: C` under `## Days`, each section made at the foot of
the note if missing.

## The next block

From the first day of the block's last week, while no block starts after this
one ends, the card offers `Plan next block`. It writes a new note in the same
folder:

* `start` is the day after this block ends, or the next Monday when that day
  has passed;
* the name takes the new start's month, `Block 2026-12 Grundlage`, or its
  whole date when the month is the same; a name without a date gets the month
  added. The `#` title follows the name;
* every session line keeps its text, link, sets, reps and rule, and its weight becomes the
  heaviest set logged for the exercise in the last two build weeks, else the
  weight the last build week planned;
* the rest of the note is copied as it is, without its `id`, `created` and
  `modified`, which the server stamps anew.

## Elsewhere

* **Session screen**: on a day the block plans, the
  [session screen](/reference/training/session-screen.md) lists the session
  first and fills in each target.
* **Training pane**: the block's weekly cardio and deload weeks replace the
  pane's defaults for the weeks it holds.
* **API**: [`GET /api/training/blocks`](/reference/http-api/log.md#get-apitrainingblocks)
  lists the block notes; when two overlap on a day, the later start holds it.
