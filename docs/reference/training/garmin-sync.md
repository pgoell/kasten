---
type: Reference
title: Garmin sync
description: The job that brings walks, runs and rides from Garmin Connect into the daily notes as training lines, the Personal API it reads, its settings, which sports make a line, why no line is written twice, and the route it writes through.
resource: jobs/src/kasten_jobs/garmin/job.py
tags: [training, jobs, garmin]
status: draft
---

# Garmin sync

The job in `jobs/` that reads the last days' activities from Garmin Connect
and writes each walk, run and ride as a
[training line](/reference/training/training-format.md) under `## Training` in
that day's note. It ships in the `kasten-backend` image as the command
`kasten-garmin-sync` and runs as a one-shot container on the docker network
`web`. Setting it up is
[Run the Garmin sync](/how-to/training/run-the-garmin-sync.md).

It only reads from Garmin and only adds lines to kasten. It never changes or
removes a line, typed or its own.

## The way in

Garmin's [Personal API](https://developer.garmin.com/gc-developer-program/personal/),
with a personal API key made in Garmin Connect's settings. The key needs no
application and no approval, and reads only its owner's data. Each run trades
the key for an access token at
`POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token`
(header `Authorization: ApiKey <key>`), then reads
`GET /activitylist-service/activities/search/activities` with `startDate`,
`endDate`, `sortOrder=asc` and pages of 99, sending the token as a bearer.

The token's answer is read under `access_token`, `accessToken` or `token`. An
answer with none of them stops the run, and the log names the answer's fields,
never their values.

Two other ways in were set aside. Garmin's business programme wants a company
and an approval, and its reviews were paused in 2026. The community
`garminconnect` library logs in as the phone app does, and broke when Garmin
changed that login in March 2026.

## Commands

| Command | What it does | Exit code |
|---|---|---|
| `kasten-garmin-sync` | Reads the look-back and writes every new walk, run and ride. | `0` done, also with nothing new; `1` Garmin or kasten refused or did not answer; `2` no `GARMIN_API_KEY` |
| `kasten-garmin-sync --dry-run` | Prints the lines it would write, `2026-11-11 - 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131`, and writes nothing, the state included. | as above |

## Settings

Read from the environment, through `docker run --env-file`.

| Variable | Default | Holds |
|---|---|---|
| `GARMIN_API_KEY` | none | the personal API key; a secret |
| `KASTEN_API` | `http://kasten-backend-prod:8000` | the backend, by its container name on `web` |
| `GARMIN_STATE` | `/state/garmin-sync.json` | the state file: the ids of the activities written |
| `GARMIN_DAYS` | `2` | how many days before today each run reads, today included as well |
| `GARMIN_WALK_NOTE` | `Gehen` | the note a walk links |
| `GARMIN_RUN_NOTE` | `Joggen` | the note a run links |
| `GARMIN_RIDE_NOTE` | `Radfahren` | the note a ride links |
| `TZ` | UTC | the box's time zone, which says what today is |

An activity's day is its local start day, as Garmin gives it.

## Which activities make a line

Garmin's activity type key decides, by the word it holds:

| Type key holds | Line |
|---|---|
| `run`, as in `running`, `trail_running`, `treadmill_running` | `🏃` run |
| `cycl` or `bik`, as in `cycling`, `road_biking`, `indoor_cycling` | `🚲` ride |
| `walk` or `hik`, as in `walking`, `hiking` | `🚶` walk |

Any other sport, such as swimming or strength, makes no line, and nor does a
key holding `motor`, such as `motorcycling`. Neither does an
activity with no duration.

The line carries the minutes of the timer duration, rounded to whole minutes
and at least one; the distance in km to one decimal, left out under 50 m; and
the average heart rate after `❤`, left out when Garmin has none:

```markdown
- 🚲 [[Radfahren]] 22 min 7.4 km ❤ 131
- 🏃 [[Joggen]] 32 min 5 km
```

## Never twice

* **The state file.** Every activity written, or left out for a typed line, has
  its id kept in `GARMIN_STATE`, the newest 1000. An id there is never written
  again, so a line deleted by hand stays gone. The file is written through a
  temp file and a rename, so a crash leaves the old one whole. A dry run keeps
  no state.
* **A typed line.** An activity is left out when its day already has a line of
  the same kind whose minutes lie within 15 % of it, or 2 minutes, whichever is
  more. Its id goes into the state, so it is not looked at again. One typed
  line stands for one activity, on this run and every later one, so a second
  ride of the same length is still written.
* **Its own lines.** The state also keeps the day, kind and minutes of each
  line the job wrote, and those lines never count as typed while their minutes
  stay as written; edit them and the line counts as typed again. So a ride
  home after the morning's ride was written is written too. Without the state file,
  as after it is lost, every line on the day counts as typed, so nothing is
  written twice.

The state is saved after each day's lines, so a run cut off halfway writes no
day again. Kasten itself writes every line it is sent, a copy of one already
there too, since two rides may read the same.

## The route it writes through

[`POST /api/training/days/{day}`](/reference/http-api/log.md#post-apitrainingdaysday)
adds the lines under the day's `## Training`, making the section, and the note
as the daily key makes it, where they are missing. The
[training pane](/reference/training/training-pane.md) counts the lines as it
counts typed ones.
