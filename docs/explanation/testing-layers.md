---
type: Explanation
title: Testing layers
description: What each test layer (pytest, unit, frame, e2e) is for and what it may fake, why a bug fix adds its test at the highest layer that reproduces the bug, and why a new jsdom component test needs a reason.
tags: [testing, design]
status: stable
---

# Testing layers

kasten tests itself at four layers. Each one runs more of the real product than
the one below it, and costs more to run. A new test goes where it proves the
most for that cost, and the rule below says where that is.

## The four layers

| Layer | Where | Runs with | What is real | What it may fake |
|---|---|---|---|---|
| pytest | `backend/tests/` and `jobs/tests/` | `mise run test:py` | The FastAPI app in process, reached through `httpx`, and the Postgres at `KASTEN_DATABASE_URL` | Outside services, through `monkeypatch` or an `httpx` mock transport. A box with no database skips the tests that need one |
| unit | `frontend/tests/`, the `unit` project | `mise run fe:test` | The frontend's own code, in jsdom | The backend: a test that reaches it mocks `@/lib/core/api` with `vi.mock`. jsdom itself fakes the browser: no layout, no paint, and `tests/setup.ts` stubs what jsdom leaves out, such as `ResizeObserver` and `matchMedia` |
| frame | `frontend/tests/frame/`, the `frame` project | `mise run fe:frame` | React in a real Chromium, so layout, focus, touch and scroll behave as they do for you | The backend's HTTP: most frame tests mock `@/lib/core/api` too, and no backend server or database runs. An html page comes from the backend's own page writer, run as a script |
| e2e | `e2e/journeys/` | `mise run e2e` | Everything: the built frontend behind nginx, a backend and a database per test, a copy of the fixture vault on disk | Nothing in the API. The journeys block the service worker, which crashed Chromium at a context close (#1606) |

`mise run fe:e2e` is not the e2e layer. It is one script,
`frontend/e2e/offline.ts`, that proves offline capture against the build; the
journeys in `e2e/` are the layer this page means by e2e.

A unit test file that touches no `window` or `document` starts with
`// @vitest-environment node`. jsdom takes about half a second to build for
each file, and a file under node skips it. `tests/setup.ts` stubs the browser
only where there is a window, so it serves both kinds.

## Where a new test goes

A bug fix adds its test at the highest layer that reproduces the bug:

- **e2e** when the bug needs both halves: a write that reaches the disk, a
  route the backend answers, what the browser does with that answer.
- **frame** when it needs a real browser but not the backend: a layout, a
  keystroke landing in the right place, a touch, a scroll.
- **unit** when it is pure logic: a parser, a reducer, a function of text.
- **pytest** when the backend alone holds it.

The reason is what each layer fakes. A test proves only what it runs for real,
so a test below the bug fakes the very part that broke. A unit test of a save
mocks the API the save calls; it can pass while the note never reaches the
disk. The journey that types a note and reads the file cannot.

The highest layer is the one that reproduces the bug, not the highest one
there is. A slip in a pure parser needs no browser, and an e2e journey for it
would cost seconds to prove what a unit test proves in a millisecond.

## Why a jsdom component test needs a reason

A component test in jsdom mounts React with no layout and a mocked backend,
which is two fakes on the parts where kasten's bugs most often sit. Write a new
one only where no higher layer can reach the case, such as a state a journey
cannot set up in reasonable time, and say why in a comment in the test.

There is a plainer limit too. `frontend/tests/` holds 594 entries, which is its
baseline in `.fan-out-baseline`, so the folder is full: a new jsdom test goes
into a test file that exists.

## What CI runs

CI runs pytest in its Backend job and the unit project in four `Unit` jobs
side by side (`--shard=1/4` to `4/4`). The Test job merges their reports with
`vitest --merge-reports`, then runs the perf project. The frame project runs in
its Perf job and the journeys in `e2e/` in its E2E job.
E2E is not a required check yet (#1606: Chromium can die between tests, and
nothing retries), so a red E2E does not block a merge; read it anyway.

## Related

* [Run the checks](/how-to/run-the-checks.md): how to run each layer, the journeys included
* [Code quality checks](/explanation/code-quality-checks.md): the checks that run beside the tests
* [mise tasks](/reference/mise-tasks.md): every task named here
