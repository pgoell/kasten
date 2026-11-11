---
type: How-to Guide
title: Import the exercise library
description: Seed one note per exercise in the vault's exercise folder by running the one-shot import on the server, look first with a dry run, and run it again safely after wger grows.
tags: [training, jobs, deploy]
status: draft
---

# Import the exercise library

The import writes one note per exercise into `03 Areas/11 Fitness/Übungen/`
from wger and free-exercise-db, and one per exercise of the mobility programme,
grouped into subfolders such as `Kraft/Brust/` and `Mobilität/`.
It never touches a note that is there. What it writes and why is in
[Exercise import](/reference/training/exercise-import.md).

You need a running prod kasten on the server, and the box must reach `wger.de`
and `raw.githubusercontent.com`.

## 1. Name the command once

The job runs in the image the backend runs, on the network `web`:

```sh
exercise_import() {
  sg docker -c "docker run --rm --network web \
    $(docker inspect -f '{{.Config.Image}}' kasten-backend-prod) \
    kasten-exercise-import $*"
}
```

## 2. Look first

```sh
exercise_import --dry-run | wc -l
exercise_import --dry-run | head -20
```

The count is about 700 notes. Nothing is written.

## 3. Run it

```sh
exercise_import; echo "exit $?"
```

The last log line says how many notes it created, how many were there and how
many kasten refused. Exit `1` means at least one refusal; the warning above it
names the path and kasten's answer.

## 4. Run it again later

Running it again is safe: notes there are skipped, so only exercises wger has
added since get a note. To set the folder to another place, pass
`-e EXERCISE_FOLDER=…` to `docker run`.
