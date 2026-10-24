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
each step's marks. `frontend/e2e/phone-trace-work.ts` reads what runs inside the long tasks of the `tab` and `open` steps; see [After #972 and #974](#after-972-and-974).

| Row | How it is counted |
| --- | --- |
| long tasks | `RunTask` events over 50 ms: how many, and their summed time |
| slowest frame gap | the longest gap between two `DrawFrame` events of the renderer |
| scripting | the union of `FunctionCall`, `EvaluateScript`, `FireAnimationFrame`, `TimerFire`, `EventDispatch` and compile events, nested ones counted once |
| layout | summed `Layout` time |
| style | summed `UpdateLayoutTree` and `RecalculateStyles` time |
| forced layouts | `Layout` events that carry a JavaScript stack: count, time, and the first frame in `src/`, mapped through the build's source map |
| `FireAnimationFrame` | counted in `rest` only; above 0 means something animates while nothing moves |
| first-load JS | every script the first load fetched, gzipped and summed |

The slowest frame gap counts idle time too: `rest` reads about 495 ms with no
work at all, so a step's gap is not all jank. Scripting is the time inside
script events, and a style recalculation or layout run from script falls inside
it as well, so scripting and style overlap and do not add up. Minified names show where the source map holds none, and a mapped line
is the nearest one the map gives.

## The numbers, 0.98.5 against 0.85.0

Recorded on 2026-10-24 on the VPS, under the load it had, three runs each in
the order old, new, old, new, old, new. Means; the runs of one release sit
within about 9% of each other.

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

- Both, tab and open: the editor being built, `src/lib/note-view.ts` (4, about
  10 ms), CodeMirror's own measure (2 or 3) and the note head,
  `src/lib/note-head.ts` (1, about 2 ms).
- 0.85.0, tab and open: its tab strip, `src/components/pane-layout.tsx:370`
  (1, 4.3 ms on tab, 3.6 ms on open).
- 0.98.5, tab and open: its tab strip's fold, `src/components/tab-strip.tsx:134`
  (1, 5.5 ms on tab, 3.5 ms on open).
- Both, type: CodeMirror's `coordsIn`, 11 a run, one per keystroke and one more.

## What it found

Ranked by ms:

1. A tab switch and a note open hold the main thread for 0.8 to 1 s on both
   releases, about 450 ms of it style. The redesign did not bring it in
   (#972). The branch cuts its script time by about half; see
   [After #972 and #974](#after-972-and-974).
2. 0.98.5 costs more than 0.85.0: style +49 ms on a tab switch and +30 ms on a
   note open, scripting +41 ms over ten keystrokes, first-load JS +36.9 KB
   gzip. The forced layout callers do not name a cause (#973).
3. The tab strip of #849 forces one layout per tab switch and per note open,
   its fold reading `offsetWidth` of every tab in a layout effect: 5.5 ms on a
   tab switch, 3.5 ms on an open. The strip before it forced one too (4.3 and
   3.6 ms), so the change is about +1 ms. Both of its layout effects keep a
   `ResizeObserver` on every tab (#974). The branch removes both; see
   [After #972 and #974](#after-972-and-974).

No spring runs at rest: `rest` holds no `FireAnimationFrame` on either release.

## After #972 and #974

The report now also prints, for the `tab` and `open` steps, what runs inside
each long task: the style passes with their callers and element counts, the
style invalidations by reason, the CPU self time mapped through the source map,
and the top `FunctionCall` events. The code is in
`frontend/e2e/phone-trace-work.ts`.

On 0.98.5 the long tasks held four things:

- The CodeMirror `EditorView` built for the note that comes on screen. Its
  constructor reads `document.fonts.ready`, which makes Chromium update style
  and layout at once, over a tree it was still building. That is 4 forced style
  passes, about 400 ms a step.
- The note head read the content's padding in its constructor: one more pass,
  about 50 ms.
- The editor reconfigured its listings right after mount: one more full pass.
- The tab strip read every tab's width in a layout effect: 5 ms (#974).

The fix:

- The view is built off the page and joins it once built.
- The note head reads no padding: its height takes the place of the content's
  top padding, which the constructor's read always found at 0, the theme's
  classes not being on the editor yet.
- The editor skips the listings on mount.
- The tab strip keeps one `ResizeObserver` and works out the fold and the bar
  from the widths it stored, so a switch reads no geometry.

Recorded on 2026-10-24 on the VPS, under the load it had, three runs each,
alternating main (the 0.98.5 code) and the branch. Means, in ms:

| Step | Metric | main | branch |
| --- | --- | ---: | ---: |
| tab | long tasks (count, ms) | 3, 995.0 | 4, 486.7 |
| tab | slowest frame gap | 640.5 | 350.4 |
| tab | scripting, layout, style | 1081.9, 23.8, 515.9 | 556.1, 13.2, 50.9 |
| tab | forced layouts (count, ms) | 12, 23.3 | 7, 8.3 |
| open | long tasks (count, ms) | 2, 836.9 | 2, 334.7 |
| open | slowest frame gap | 581.8 | 336.9 |
| open | scripting, layout, style | 928.0, 24.2, 480.1 | 434.6, 13.6, 53.0 |
| open | forced layouts (count, ms) | 12, 20.5 | 7, 5.6 |

The longest single task is still over 200 ms on both steps (tab 269 to 320,
open 253 to 304). About 150 to 180 ms of it is the browser removing the old
note's editor from the page (`removeChild`). #983 tracks that. No
forced layout comes from `tab-strip.tsx` any more. The second branch run met
more load than the others (5 long tasks on tab).

## The old editor's removal (#983)

On 0.98.7 the longest task of each step is React's commit taking the old
note's pane off the page. Its CPU self time is `removeChild`, native: 140 ms
of a 265 ms task on a tab switch and 180 ms of a 257 ms task on a note open,
with React's own deletion walk (`pl`, 24 to 35 ms) beside it. No style or
layout event sits under it: the browser tears the CodeMirror subtree down
inside the call. On a tab switch the same task builds the new editor; on a
note open it holds the removal alone, the new note being fetched first and
built in a later task.
