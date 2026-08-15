---
type: Reference
title: mise tasks
description: Every task defined in mise.toml, by group.
resource: mise.toml
tags: [commands, tooling, mise]
status: stable
---

# mise tasks

mise owns every command in this repo. `mise tasks` prints this list from
`mise.toml`; the descriptions here are the ones defined there.

## Bootstrap

| Task | What it does |
|---|---|
| `install` | Install git hooks, backend dependencies and frontend dependencies |
| `fe:install` | Install frontend dependencies only |

## Dev loop

| Task | What it does |
|---|---|
| `dev` | Run the backend with auto-reload on :8000 |
| `fe:dev` | Run the frontend dev server on :5173 |

## Hosted dev environment

Reload servers in containers with the working tree bind-mounted, reached
through Caddy. See [Two environments](/explanation/environments.md).

`dev:up` is the only task in this file that builds anything. The shell
container has no reload loop, so it is built from `shell/Dockerfile` on the box;
the other two services run stock images and rebuild nothing.

| Task | What it does |
|---|---|
| `dev:up` | Start the hosted dev environment, database included, rebuilding the shell image |
| `dev:down` | Stop it, keeping the database volume |
| `dev:restart` | Restart the reload servers, after a dependency change |
| `dev:status` | Show container status |
| `dev:logs` | Follow the reload server logs |

## Database

| Task | What it does |
|---|---|
| `db:up` | Start the dev Postgres on :5434 |
| `db:stop` | Stop it, keeping the volume |
| `db:reset` | Destroy the volume and start fresh. Destructive |
| `db:migrate` | Apply migrations to the dev database |
| `db:revision` | Autogenerate a migration. Takes `-- -m "message"` |
| `db:downgrade` | Roll back the last migration |

## Testing

| Task | What it does |
|---|---|
| `test` | Backend and frontend tests |
| `test:py` | Backend tests only |
| `fe:test` | Frontend tests only, the `unit` and `perf` projects |
| `fe:frame` | The end-to-end frame gates, in Chromium |
| `fe:bench` | Record the frontend benchmark numbers on this machine |

`fe:test` names its two projects rather than running every project, because the
third one boots a real browser. CI's Test job and lefthook's pre-push hook
install none, so `fe:frame` runs in its own CI job, after a
`playwright install chromium --with-deps`. Run it locally the same way, once.

`fe:bench` gates nothing. It prints a mean per benchmark and exits zero
whatever the number, because `vitest bench` has no threshold to fail against.
The thresholds are assertions in the test files instead. See
[Ranking performance](/reference/ranking-performance.md).

## Vault maintenance

| Task | What it does |
|---|---|
| `okf:backfill` | Write `type` into every note in the vault that has none |

`okf:backfill` runs the same pass the backend runs at startup, from a terminal.
It takes the vault as a path so the one command reaches any vault, `../vault` by
default because the task sets its own directory to `backend/`. It writes the one
field and nothing else, prints a line per note it changed, and changes nothing on
a second run. See
[OKF in the vault](/explanation/okf-in-the-vault.md#the-pass-over-the-notes-already-there).

## Lint, format and types

| Task | What it does |
|---|---|
| `lint` | ruff, ty, Biome and `tsc`. The pre-commit gate |
| `lint:py` | Backend lint, format check and type check |
| `fe:lint` | Biome on the frontend |
| `fmt` | Format everything |
| `fe:fmt` | Format the frontend |
| `fe:typecheck` | Build the frontend, then `tsc --noEmit` |
| `fe:build` | Build the frontend for production |
| `fe:types` | Regenerate the OpenAPI-derived frontend types |

`fe:typecheck` depends on `fe:build` because the TanStack Router plugin emits
`routeTree.gen.ts` during the build, and that file is gitignored. Without it
`tsc` cannot resolve the route graph.

`lint` runs it, so a commit is type-checked on both sides of the repo. The
build it drags in is what makes the gate two seconds rather than a third of
one, which is the price of the frontend being gated the way the backend
already was.

## Repo automation

| Task | What it does |
|---|---|
| `repo:apply-settings` | Apply GitHub repo and branch-protection settings from `.github/*.json` |
| `repo:check-settings` | Diff live branch protection against the checked-in file |

## Related

* [Run the checks](/how-to/run-the-checks.md) - which of these CI runs, and what to do when the hooks misbehave
* [Ranking performance](/reference/ranking-performance.md) - what `fe:test`, `fe:frame` and `fe:bench` measure, and every recorded number
