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
| `dev:restart` | Restart the reload servers, after a change to `uv.lock` (the frontend installs on a `bun.lock` change by itself) |
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
| `test` | Backend, frontend and chat runner tests |
| `test:py` | Backend and host job (`jobs/`) tests |
| `fe:test` | Frontend tests only, the `unit` and `perf` projects |
| `shell:test` | The chat runner's tests, on node's own test runner against a scripted session |
| `chat:stub` | Run the chat runner on `127.0.0.1:7682` with a scripted session, no SDK and no login. `fe:dev` proxies `/chat` to it |
| `fe:frame` | The end-to-end frame gates, in Chromium |
| `fe:e2e` | Build, then prove offline capture in Chromium against `dist/`: the shell offline, dumps waiting and sent in order, a resend with the same id, a sign-in redirect kept out of the cache. Prints PASS or FAIL per step |
| `fe:e2e:release` | Build two releases into `dist-e2e-a/` and `dist-e2e-b/`, the second with every asset renamed, then prove in Chromium that a tab open across the release gets to its next route on the new one, reloading at most once, and keeps the text typed into a note. Prints PASS or FAIL per scenario |
| `fe:trace:phone` | `-- <dist> <label>`: trace a tab switch, a note open and ten typed characters in Chromium as a phone (390 px, touch, CPU 4x slower) against a built `dist`, into `frontend/traces/<label>.json` ([Phone performance](phone-performance.md)) |
| `fe:trace:report` | `-- <prefix> [...]`: print the long tasks, frames, script, layout, style and forced layouts of each step, and the first-load JS, for every trace whose label starts with a prefix |
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
| `index:backfill` | Write an `index.md` into every folder in the vault that has none |
| `model-use` | Write Claude Code's, codex's and grok's tokens and cost per day, model and project from a session folder, `~/.claude/projects`, `~/.codex/sessions` or `~/.grok/sessions`, into the monthly notes. Takes the source and the vault, then `--from` and `--to` for the days |

`okf:backfill` runs the same pass the backend runs at startup, from a terminal.
It takes the vault as a path so the one command reaches any vault, `../vault` by
default because the task sets its own directory to `backend/`. It writes the one
field and nothing else, prints a line per note it changed, and changes nothing on
a second run. See
[OKF in the vault](/explanation/okf-in-the-vault.md#the-pass-over-the-notes-already-there).

`index:backfill` gives every folder below the vault root that has no `index.md`
the listing kasten writes into a folder it makes: the folder's name as a
heading and a bullet per thing in it, with no descriptions. It takes the vault
as a path the way `okf:backfill` does, prints the path of each index it wrote,
and writes the lot as one jj change, `vault: index backfill`. Hidden folders are
not walked into, and the vault root is left alone, because OKF makes its index
optional. A second run writes nothing. The backend never runs it at startup, so
an index you deleted stays deleted. See
[Moving a note](/explanation/moving-notes.md#why-the-backfill-waits-to-be-asked).

The task is `python -m kasten_backend.indexes <vault>` under uv. The backend
container has no mise, so run that line there instead, as
`python -m kasten_backend.indexes /vault`.

## Lint, format and types

| Task | What it does |
|---|---|
| `lint` | ruff, ty, Biome on both JavaScript trees, `tsc`, the file-size and the copy check. The pre-commit gate and CI's Lint job |
| `lint:py` | Backend and host job lint, format check and type check |
| `lint:size` | Check every tracked file against the 5,000-token limit |
| `lint:dup` | Fail when more than 1% of `frontend/src`, `backend/src` and `jobs/src` is copied code (jscpd) |
| `fe:lint` | Biome on the frontend |
| `shell:lint` | Biome on `shell/chat`, with the frontend's binary and rules |
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

`lint:size` runs `scripts/file_size.py` with no arguments, so it checks every
tracked file. Pre-commit runs `lint`, so a commit fails while any tracked file is
over 5,000 tokens, staged or not. Pre-commit also runs the script on the staged
files, which names a staged file over the limit on its own. See
[The file size limit](/explanation/file-size-limit.md).

`lint:dup` runs jscpd with `.jscpd.json` at the root. jscpd alone takes about
6 s, but `lint` runs its parts side by side, so the copy check adds about 2.5 s
to the gate. It prints nothing when it passes and the list of clones when it
fails. See
[Get past the copy check](/how-to/run-the-checks.md#get-past-the-copy-check).

## Repo automation

| Task | What it does |
|---|---|
| `repo:apply-settings` | Apply GitHub repo and branch-protection settings and the Actions allowlist from `.github/*.json`, turn on vulnerability alerts and Dependabot security updates |
| `repo:check-settings` | Diff live branch protection against the checked-in file, check both security settings are on |

## Related

* [Run the checks](/how-to/run-the-checks.md): which of these CI runs, and what to do when the hooks misbehave
* [Ranking performance](/reference/ranking-performance.md): what `fe:test`, `fe:frame` and `fe:bench` measure, and every recorded number
