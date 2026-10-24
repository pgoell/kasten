---
type: Reference
title: Phone performance
description: The script that traces a tab switch, a note open and typing on a phone, what it measures and how, and the numbers of 0.98.5 against 0.85.0.
resource: frontend/e2e/phone-trace.ts
tags: [performance, mobile, frontend, testing]
status: stable
---

# Phone performance

Two scripts trace the app the way a phone runs it and print what each tap cost.
They were written for #934, which reported that the app felt slower on a phone
after the redesign. This page states what they do, what each number means, and
what they found on 0.98.5 and on 0.85.0, the release before the tab strip of
#849.

## Run it

Build the release with source maps, from inside its `frontend`:

```sh
bun run build --sourcemap hidden
```

Then, from the repo:

```sh
mise run fe:trace:phone -- <dist dir> <label>   # one run, one trace
mise run fe:trace:report -- <prefix> [...]      # a table per label prefix
```

`fe:trace:phone` writes `frontend/traces/<label>.json`, the Chrome trace, and
`<label>.meta.json` beside it. Git ignores `frontend/traces/`; a trace runs to
tens of megabytes. To compare two releases, build each from its tag in a
worktree and alternate the runs, old and new, so both meet the same load.

## What the script does

`frontend/e2e/phone-trace.ts` serves a built `dist` and opens it in Chromium:

- a phone: 390 by 844 px, device scale 3, `isMobile` and `hasTouch`, and the
  CPU slowed four times with `Emulation.setCPUThrottlingRate`
- a stub vault of eight notes of about 300 lines each, answered in the page's
  `/api/` routes, so no backend runs
- six tabs, `Note 1` to `Note 6`, seeded under `kasten.workspace.coarse.1`, and
  vim off

It checks that the phone toolbar is on the page, so it never measures the
desktop layout by mistake, then traces four steps, each between two
`performance.mark` calls:

| Step | What it does | Ends when |
| --- | --- | --- |
| `tab` | taps the `Note 2` tab | Note 2 is in the editor, plus 1 s |
| `open` | taps File tree, then `Note 8` in the tree | Note 8 is in the editor, plus 1 s |
| `type` | taps the editor, End, types `abcdefghij`, 120 ms apart | the text is on screen, plus 1 s |
| `rest` | nothing, 1.5 s after `type` | 2 s later |

The tab step taps `Note 2` because 0.98.5 folds the later tabs behind "N more"
at 390 px. A step whose target is not there, or a page error, stops the run
with exit 1 and prints the page's text and the requests it made.

## What the report counts

`frontend/e2e/phone-trace-report.ts` reads the renderer's main thread between
each step's marks.

| Row | How it is counted |
| --- | --- |
| long tasks | `RunTask` events over 50 ms: how many, and their summed time |
| slowest frame gap | the longest gap between two `DrawFrame` events of the renderer |
| scripting | the union of `FunctionCall`, `EvaluateScript`, `FireAnimationFrame`, `TimerFire`, `EventDispatch` and compile events, nested ones counted once |
| layout | summed `Layout` time |
| style | summed `UpdateLayoutTree` time |
| forced layouts | `Layout` events that carry a JavaScript stack: count, time, and the first frame in `src/`, mapped through the build's source map |
| `FireAnimationFrame` | counted in `rest` only; above 0 means something animates while nothing moves |
| first-load JS | every script the first load fetched, gzipped and summed |

The slowest frame gap in `rest` is the idle gap between frames, not a slow
frame. Minified names show where the source map holds none, and a mapped line
is the nearest one the map gives.

## The numbers, 0.98.5 against 0.85.0

Recorded on 2026-10-24 on the VPS, under the load it had, three runs each in
the order old, new, old, new, old, new. Means; the runs of one release sit
within about 5% of each other.

| Step | Metric | 0.85.0 | 0.98.5 |
| --- | --- | ---: | ---: |
| tab | long tasks (count, ms) | 3, 958.7 | 3, 958.8 |
| tab | slowest frame gap | 576.5 | 623.6 |
| tab | scripting, layout, style | 1051.2, 20.7, 455.5 | 1047.3, 22.9, 504.6 |
| tab | forced layouts (count, ms) | 12, 20.0 | 12, 22.2 |
| open | long tasks (count, ms) | 2, 793.6 | 2, 805.9 |
| open | slowest frame gap | 573.1 | 567.9 |
| open | scripting, layout, style | 892.6, 22.4, 444.2 | 907.8, 23.1, 474.2 |
| open | forced layouts (count, ms) | 12, 19.8 | 12, 19.5 |
| type | long tasks (count, ms) | 1, 54.4 | 1, 62.6 |
| type | slowest frame gap | 160.2 | 140.1 |
| type | scripting, layout, style | 405.5, 16.0, 30.7 | 446.1, 16.2, 37.7 |
| type | forced layouts (count, ms) | 12, 7.3 | 12, 9.1 |
| rest | `FireAnimationFrame` | 0 | 0 |
| first load | JS gzip, raw, files | 854.9 KB, 2722.9 KB, 35 | 891.8 KB, 2839.6 KB, 35 |

Times in ms. The forced layouts per run, by caller:

- 0.85.0, tab and open: CodeMirror's measure (`@codemirror/view`, 3 or 4 a
  step), `src/lib/todo-refile.ts:59` (1, about 4 ms) and `src/lib/note-view.ts:307`
  (1, about 2 ms).
- 0.98.5, tab and open: `src/components/tab-strip.tsx` (4, about 10 ms), then
  CodeMirror's measure and `src/lib/note-view.ts:300`.
- Both, type: CodeMirror's `coordsIn`, 11 a run, one per keystroke and one more.

## What it found

Ranked by ms:

1. A tab switch and a note open hold the main thread for 0.8 to 1 s on both
   releases, about 450 ms of it style. The redesign did not bring it in
   (#972).
2. 0.98.5 costs more than 0.85.0: style +49 ms on a tab switch and +30 ms on a
   note open, scripting +41 ms over ten keystrokes, first-load JS +36.9 KB
   gzip. The forced layout callers do not name a cause (#973).
3. The tab strip of #849 forces four layouts per tab switch and per note open,
   about 10 ms each step: two layout effects that read `offsetWidth` and
   `offsetLeft`, each with a `ResizeObserver` on every tab (#974).

No spring runs at rest: `rest` holds no `FireAnimationFrame` on either release.
