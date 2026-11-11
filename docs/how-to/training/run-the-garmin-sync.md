---
type: How-to Guide
title: Run the Garmin sync
description: Make a Garmin personal API key, keep it in an env file on the server, check what the job would write with a dry run, and run it every hour on a systemd timer so walks, runs and rides reach the daily note within the hour.
tags: [training, jobs, garmin, deploy]
status: draft
---

# Run the Garmin sync

The Garmin sync writes the walks, runs and rides your watch records into the
daily note as training lines. Its settings and rules are in
[Garmin sync](/reference/training/garmin-sync.md).

You need a running prod kasten and a Garmin Connect account.

## 1. Make a personal API key

Sign in at [Garmin Connect](https://connect.garmin.com/app/settings/personalApiToken),
choose **Create Key**, accept the terms and pick how long the key lives. Garmin
shows the key once: copy it now. When it expires, make a new one and put it in
the env file.

## 2. Write the env file

Logins and state live in `~/.config/kasten/`, never in the repo:

```sh
install -d -m 700 ~/.config/kasten ~/.config/kasten/garmin-state
(umask 077; cat > ~/.config/kasten/garmin-sync.env <<'ENV'
TZ=Europe/Berlin
KASTEN_API=http://kasten-backend-prod:8000
GARMIN_API_KEY=paste-the-key-here
GARMIN_STATE=/state/garmin-sync.json
GARMIN_DAYS=2
ENV
)
```

Write each value bare, never in quotes: docker's `--env-file` keeps quotes as
part of the value. Change `GARMIN_WALK_NOTE`, `GARMIN_RUN_NOTE` or
`GARMIN_RIDE_NOTE` only if your cardio notes have other names.

## 3. Name the command once

Every run is a container of the image the backend runs:

```sh
garmin_sync() {
  sg docker -c "docker run --rm --network web --user $(id -u):$(id -g) \
    --env-file $HOME/.config/kasten/garmin-sync.env \
    --mount type=bind,src=$HOME/.config/kasten/garmin-state,dst=/state \
    $(docker inspect -f '{{.Config.Image}}' kasten-backend-prod) \
    kasten-garmin-sync $*"
}
```

## 4. Look first

```sh
garmin_sync --dry-run
```

It prints a line per walk, run and ride of today and the two days before, and
writes nothing. No line for an activity you see in Garmin Connect means its
sport makes none; the table in the reference says which do. A run that stops
with `No token in the answer` means Garmin's token answer has a shape the job
does not know yet: the message lists its fields, and the job needs a fix.

## 5. Run it once

```sh
garmin_sync; echo "exit $?"
```

Open today's note: the lines sit under `## Training`. A ride you had already
typed is left alone, and Garmin's copy is not added.

## 6. Start the timer

`kasten-garmin-sync.service` and `.timer` in server-infra's `jobs/`, beside the
bank sync. The service is a one-shot container as above, with
`TimeoutStartSec=5min`, and fails into `job-failed@.service`. The timer runs
it hourly with `OnCalendar=hourly`, `RandomizedDelaySec=5min` and
`Persistent=true`, so a ride shows up within the hour.

```sh
systemctl --user daemon-reload
systemctl --user enable --now kasten-garmin-sync.timer
journalctl --user -u kasten-garmin-sync.service -n 20
```

Each run logs, per day, how many lines were new.
