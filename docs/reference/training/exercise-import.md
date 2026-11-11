---
type: Reference
title: Exercise import
description: The one-shot job that seeds one note per exercise in the vault's exercise folder from wger, free-exercise-db and the mobility programme, its settings, the note it writes field by field, the fixed set of muscle groups, how kind and counts are chosen, and why a second run writes nothing.
resource: jobs/src/kasten_jobs/exercises/job.py
tags: [training, jobs, vault]
status: draft
---

# Exercise import

The job in `jobs/` that gives every exercise a note in
`03 Areas/11 Fitness/Übungen/`, so a [training line](/reference/training/training-format.md)
has a note to link and the planner a library to pick from. It ships in the
`kasten-backend` image as the command `kasten-exercise-import`, runs once by
hand, and writes through
[`POST /api/files/{path}`](/reference/http-api/notes.md#post-apifilespath).
Running it is [Import the exercise library](/how-to/training/import-the-exercise-library.md).

## Command

| Command | What it does | Exit code |
|---|---|---|
| `kasten-exercise-import` | Fetches the sources, names every exercise and creates each note not there yet. Logs how many it created, how many were there and how many kasten refused. | `0` every note made or there already; `1` kasten refused at least one |
| `kasten-exercise-import --dry-run` | Prints the path each note would take and writes nothing. | `0` |

A source that does not answer stops the job with a traceback and exit `1`
before anything is written.

## Settings

Read from the environment; neither is a secret.

| Variable | Default | Meaning |
|---|---|---|
| `KASTEN_API` | `http://kasten-backend-prod:8000` | The backend, by its name on the docker network `web` |
| `EXERCISE_FOLDER` | `03 Areas/11 Fitness/Übungen` | The vault folder the notes go in |

## Sources

| Source | Licence | What it gives |
|---|---|---|
| [wger](https://wger.de) API, `exerciseinfo` | CC-BY-SA 3 or 4, per exercise; a few CC0 | Every exercise with a German name: the name, the German description as cues, the English name and wger's aliases, muscles, equipment, the video if there is one |
| [free-exercise-db](https://github.com/yuhonas/free-exercise-db), pinned to a commit | Unlicense | Muscles, for the wger exercises whose English name it shares, ignoring case and punctuation |
| `jobs/src/kasten_jobs/exercises/mobility.tsv` | own | The stretches and loaded stretches of the vault's `Mobilitätsprogramm.md`, one per line |

free-exercise-db names its exercises in English only, so it adds no notes of its
own: an exercise with no German name and no German cues would break the rule
that the library reads in German. A wger exercise with no German name is left
out for the same reason. The [MuscleWiki API](https://api.musclewiki.com/) is
the fallback source should these two fall short; it is paid and not wired in.

## The note

```markdown
---
type: Reference
kind: strength
aliases: [Bench Press, Flachbankdrücken]
muscles_primary: [chest]
muscles_secondary: [triceps, front-deltoids]
equipment: [Langhantel, Bank]
counts: weight-reps
source: wger
source_url: "https://wger.de/de/exercise/192/view/"
license: CC-BY-SA 4
video: "https://wger.de/media/exercise-video/192/….mp4"
---

# Bankdrücken LH

- Auf die Bank legen …

*Quelle: [wger](https://wger.de/de/exercise/192/view/), Übung von …, Text von …, [CC-BY-SA 4](…).*

## Meine Notizen
```

kasten adds `id`, `created` and `modified` to the block as it writes the note.

| Field | Holds |
|---|---|
| `type` | `Reference`, as the test notes already in the folder carry |
| `kind` | `strength`, `cardio`, `mobility` or `test`; the import writes the first three, and the `test` notes already in the folder stay as they are |
| `aliases` | The English name first, then the source's other names, so search and [unlinked mentions](/reference/http-api/finding.md#get-apimentions) find either |
| `muscles_primary`, `muscles_secondary` | Groups from the set below; a group named as both stays primary only |
| `equipment` | In German: `Langhantel`, `Kurzhantel`, `Kabelzug`, `Bank`, `Schrägbank`, `Kettlebell`, `Matte`, `SZ-Stange`, `Klimmzugstange`, `Widerstandsband`, `Gymnastikball`; empty for body weight |
| `counts` | What a set is counted in: `weight-reps`, `reps` or `time` |
| `region`, `test` | Mobility notes only: the programme's region and the test note that measures it, as a wikilink |
| `source` | `wger` or `Mobilitätsprogramm` |
| `source_url`, `license` | wger notes only |
| `video` | wger's video when it has one, else empty for you to fill with a link |

The body is the cues, then the credit line in italics, then an empty
`## Meine Notizen`. A wger exercise whose German description is empty gets
"Die Quelle gibt keine Hinweise." in place of cues.

## Muscle groups

One fixed set, the keys of the body model the exercise note paints (#1721):

`chest`, `front-deltoids`, `back-deltoids`, `biceps`, `triceps`, `forearm`,
`abs`, `obliques`, `trapezius`, `upper-back`, `lower-back`, `gluteal`,
`abductors`, `adductor`, `quadriceps`, `hamstring`, `calves`, `neck`.

wger's serratus counts as `obliques` and its brachialis as `biceps`, the nearest
areas the model draws; free-exercise-db's lats and middle back are both
`upper-back`, and its shoulders `front-deltoids`. A wger exercise that names no
muscle takes one from its category: Abs `abs`, Back `upper-back`, Calves
`calves`, Chest `chest`, Legs `quadriceps`, Shoulders `front-deltoids`. Arms and
Cardio say too little, so those notes may name none.

## Kind and counts

* `cardio` for wger's Cardio category; `mobility` for a name holding "dehn" or
  "stretch", a free-exercise-db match in its stretching category, and every
  line of `mobility.tsv`; else `strength`.
* `counts` is `time` for cardio and mobility from wger and for a held exercise,
  a name holding plank, Planke, hold, halten, isometr, Unterarmstütz,
  Seitstütz or wall sit; `reps` when the equipment is none, a mat or a pull-up
  bar; else `weight-reps`. `mobility.tsv` states each line's own.

## Names, and why a second run writes nothing

The mobility programme goes first, then wger by id, so a clash resolves the
same way each run. A name loses `* ? " < > # ^ [ ]`, and `/ \ | :` become
` - `, so it works as a file name and inside a `[[link]]`. A name already taken,
ignoring case, takes its English name in brackets, `Bankdrücken LH (Barbell
Bench Press)`; one that clashes even so is skipped and logged.

Each note is a create, and kasten answers a create at a path that holds a note
with `409` and leaves that note alone. So a note you have edited, or one of the
test notes, is never overwritten, and with the same source data a second run
creates nothing. A note you rename or delete comes back on the next run.
