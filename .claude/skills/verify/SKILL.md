---
name: verify
description: Drive kasten the way its user does and keep the proof. Runs the always-flow journeys and the journeys of the touched flow on the e2e harness (Playwright against a throwaway stack of its own), and looks at the hosted dev stack in a browser where a change needs it. Use before a commit that changes behaviour, and for the Testing section of a pull request.
---

# Verify kasten

kasten is a web page: a note editor (CodeMirror, vim mode on by default) over a
FastAPI backend and a vault of markdown files. Its user reaches it in a desktop
browser by keys and on a phone by touch. Prove a change there, not only in unit
tests.

## Launch

Use the e2e harness first. `e2e/harness/global-setup.ts` starts Postgres and
nginx as a compose project named `kasten-e2e-<8 hex>` on ports Docker picks, and
each journey gets its own vault copy, database and backend. It cannot collide
with the dev stack or another session's run.

```sh
.claude/skills/verify/run.sh                                  # the always-flows
.claude/skills/verify/run.sh notes/saving/edits.spec.ts -g "vim off"   # plus the touched flow
```

`run.sh` installs the frontend and e2e packages and the backend venv (`bun
install --frozen-lockfile`, `uv sync --frozen`), builds `frontend/dist` (the
journeys load the built page, so a stale build would prove old code), then runs
the journeys. Its arguments go to `bunx playwright test` as they are, with paths
under `e2e/journeys/`. It is ready when Playwright prints `Running N tests`; it
is done at `verify: ... passed`.

Use the hosted dev stack only for what the harness cannot show, such as a look
at the page with the dev vault's notes. It runs as the containers
`kasten-backend-dev`, `kasten-frontend-dev` and `kasten-shell-dev`, serves the
tree it was started from, and is shared with other sessions. If the Doctor
finds it up, use it as it is. Start it with `mise run dev:up` only when no
`kasten-*-dev` container runs: compose pins the project name `kasten`, so
`dev:up` while it runs would point the shared stack at your tree. It is up when
the three Doctor lines below for dev answer.

## Doctor

For the harness, before a run that fails at start:

```sh
docker info --format '{{.ServerVersion}}'          # Docker answers
docker image inspect kasten-postgres:17 --format ok # else: docker compose build db
```

For the dev stack, read only:

```sh
docker ps --filter name=kasten- --format '{{.Names}} {{.Status}}' | grep -- '-dev '
curl -s -m 5 http://127.0.0.1:8000/api/version                  # {"backend":"<short sha>"}
curl -s -m 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/   # 200
docker inspect kasten-frontend-dev --format '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}'
```

The last line names the tree the dev stack serves. If it is not the checkout
your change is in, the dev stack cannot show your change: use the harness.

## Drive

Reach a change as its user does. Two ways:

- **A journey** in `e2e/journeys`, run by `run.sh`. Find the journeys of the
  touched flow with `rg -l '<words of the flow>' e2e/journeys` and pass their
  files. The helpers in `e2e/harness/app.ts` (`openApp`, `findNote`,
  `leader`, `openNote`, `noteText`) show how a journey opens the app, presses
  keys and reads the vault on disk. Drive both ways a user has: vim on (the
  default) and off (`localStorage` key `kasten.vim` set to `off`), and a phone
  (the `phone` helper) where the flow exists on one.
- **A browser on the dev frontend** at `http://127.0.0.1:5173` (loopback, so no
  login). For a picture:
  `cd e2e && bunx playwright screenshot --wait-for-selector 'role=button[name="02 Projects"]' http://127.0.0.1:5173/ ../.verify/dev.png`
  (wait for a row of the file tree, a folder or note of the dev vault; the
  editor draws before the listing lands), and `--device "Pixel 7"` for a phone. Every write there lands in the dev
  vault other sessions use, so keep to reading; write in a journey instead.

The flows that must always work are in [the feature map](features/README.md),
one file each with the journey that proves it and its end state.

## Evidence

`run.sh` writes each run to `.verify/<UTC time>/` at the repo root (ignored by
git): `always.log` and, with arguments, `touched.log`, each the whole Playwright
output. Put the command and the last lines of its output into the pull
request's Testing section. A failing journey also leaves its trace and
screenshot under `e2e/test-results/`; read the trace with
`cd e2e && bunx playwright show-trace <path>`. A screenshot of the dev frontend
goes to `.verify/` too; say in the pull request what it shows.

## Cleanup

Stop only what this run started.

- The harness tears its compose project down when Playwright ends. If a run is
  killed first, `run.sh` on its exit removes each `kasten-e2e-*` project that
  came up during the run from this checkout (it reads the compose label
  `com.docker.compose.project.working_dir`), and no other.
- A dev stack this run started with `dev:up`: stop it with
  `docker compose -f compose.yaml -f compose.dev.yml stop`.
- Never run `mise run dev:down` or `mise run db:reset` on a stack that was
  already up: other sessions use it.
- Never touch prod: the `kasten-*-prod` containers, the live vault under `~/kasten-data` and the database `kasten_prod`.

Cleanup never deletes `.verify/`: the evidence stays.

## Rules

- Drive the touched flow and the always-flows (`run.sh` with the touched
  journeys as arguments does both) before a commit that changes behaviour.
- After three failed fixes for one failure, stop and ask.
- Never skip, rerun or sleep a check green. A journey that fails once is a
  finding: find its cause or report it.
