---
type: Reference
title: Training format
description: How a daily note records sets, cardio and mobility tests as lines under ## Training, every kind and its fields, the estimated one-rep max, what does not parse, and the table of cases both parsers are tested against.
resource: frontend/src/lib/log/cases/training-cases.json
tags: [vault, training, format, backend]
status: stable
---

# Training format

A set, a walk, a run, a ride or a mobility test is a line in the daily note,
under `## Training`, the way food is a line under `## Log`. The line is the
record: nothing about it lives anywhere else, and the note's date is its date.
`GET /api/training` reads the lines; see
[the HTTP API](/reference/http-api/log.md#get-apitraining).

```markdown
## Training
- 🏋 [[Kniebeuge]] 80 kg 8 7 7 @8
- 🏋 [[Klimmzüge]] bw 6 5 5
- 🏋 [[Plank]] 3x 45 s
- 🚶 [[Gehen]] 45 min 4.1 km
- 🏃 [[Joggen]] 32 min 5.0 km ❤ 148
- 🚲 [[Radfahren]] 25 min 8.2 km
- 📏 [[Knie-zur-Wand]] L 11 cm R 9 cm
- 📏 [[Schulter-Rotation]] außen L 95° R 90°, innen L 55° R 45°
```

## Where a line sits

A line counts where a `## Log` line would: in a daily note, under a heading
that reads exactly `## Training`, up to the next `# ` or `## ` heading, outside
fenced code and the frontmatter, opening with `- ` and no indent. A note may
hold more than one `## Training`; each counts.
[Log format](/reference/food/log-format.md#where-an-entry-sits) gives the rules in
full.

## The line

After `- ` comes the marker, then the link to the exercise note, then the
fields. Every marker may carry the variation selector U+FE0F, so `🏋️` reads as
`🏋`. Spaces or tabs part the pieces. A number is one to nine digits with an
optional decimal part, the mark a point or a comma. Units ignore case.

The link is a wikilink, `[[Kniebeuge]]`, and its target is the entry's
`exercise`: `[[Kniebeuge|Squat]]` is `Kniebeuge`. An empty link is no entry.
The exercise notes come from
[the exercise import](/reference/training/exercise-import.md). The phone's
[session screen](/reference/training/session-screen.md) writes these lines as
each set is done, and the [training pane](/reference/training/training-pane.md)
charts them.

| Kind | Marker | Fields |
| --- | --- | --- |
| strength | `🏋` | a weight in `kg` above zero, or `bw` for body weight; then the reps of each set, whole numbers from 1, up to three digits; then an optional RPE, `@8`, from 1 to 10 with an optional decimal |
| strength, timed | `🏋` | sets and time per set: `3x 45 s` or `2x 1,5 min`, the spaces optional |
| walk | `🚶` | minutes above zero with `min`; then optional km above zero with `km`; then an optional average heart rate, `❤ 148` |
| run | `🏃` | as walk |
| ride | `🚲` | as walk |
| test | `📏` | one or more groups split by a comma and a space |

The fields come in the order above, and nothing follows them: `- 🚲
[[Radfahren]] 25 min 8.2 km Arbeit` does not parse.

A strength line's `sets` is the count of its reps, and a timed line's `seconds`
is the time of one set.

### A test's groups

A group is an optional label, one word such as `außen`, then either one value
or one per side, `L` and then `R`, in that order. A value is a number with a
unit, or a result:

* `cm`, `°`, `Punkte`, `Punkt`, `point` or `points`, the space before the unit
  optional, and the number may be negative: `-3 cm`.
* `ok` for passed, `nicht ok` for not.

The commas inside a number, `10,5 cm`, do not split groups: only a comma
followed by a space does. The test notes in `03 Areas/11 Fitness/Übungen/Tests/`
(`kind: test`, with `unit` and `sides`) show the lines each test takes. The
parser does not read those notes, so a line's unit is the one written in it.

## Estimated one-rep max

A strength line with a weight in kg carries `e1rm`: the Epley estimate,
weight × (1 + reps / 30), of its best set, over the sets of ten reps or fewer,
rounded half up to one decimal. A line whose sets are all longer than ten reps,
a body weight line and a timed line carry none.

## What does not parse

A line that does not match is a plain bullet: it stays in the note as written
and counts for nothing. So does a line with zero reps, zero weight, an RPE past
10, zero minutes, a value with no unit or an unknown one, one side alone, or a
marker this page does not name.

## The cases

`frontend/src/lib/log/cases/training-cases.json` holds one row per case: a line
and the entry it parses to, or `null` for a plain bullet. The backend parser,
`backend/src/kasten_backend/training/lines.py`, and the browser's,
`frontend/src/lib/log/training/training-lines.ts`, run the whole table in their tests. A
change to the format is a change to that table first.
