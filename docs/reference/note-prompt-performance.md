---
type: Reference
title: Note prompt performance
description: The bar a keystroke in the new note prompt is held to, the harnesses that measure it, and every recorded number.
resource: frontend/tests/frame/note-prompt.test.tsx
tags: [performance, benchmarks, frontend, testing]
status: stable
---

# Note prompt performance

Typing in the new note prompt ranks every folder in the vault and rebuilds the
list under the input. This page states the bar that work is held to, the three
harnesses that measure it, and the numbers each one recorded.

Every figure here comes from one machine, a 16-thread desktop. `ubuntu-latest`
is about 2.0x slower, which is why the gates carry the multiplier they do.

## The bar

| Surface | Bar | Gated |
| --- | --- | --- |
| Prompt keystroke at 10,000 notes | 16 ms end to end, about 4 ms of it JS | yes |
| Prompt keystroke at 50,000 notes | under 100 ms end to end | no, recorded |
| Editor keystroke | no wasted re-renders, asserted as a count | yes, exact |
| `GET /api/files`, `buildTree`, load and first paint | none | no, recorded |

"End to end" counts the ranking, the path verdict, React's reconciliation and
the DOM commit. It does not count paint, for the reason under
[What these numbers are not](#what-these-numbers-are-not).

## The harnesses

`frontend/vite.config.ts` splits the suite into three vitest projects. They
share the `@` alias and the synthetic vault, and nothing else.

| Project | Environment | Holds | Can measure | Cannot measure |
| --- | --- | --- | --- | --- |
| `unit` | jsdom | `tests/**`, minus the two below | behaviour, and how often a function is called | anything timed, since jsdom lays out nothing |
| `perf` | node | `tests/perf/**` and `bench/**` | pure functions, with little noise | React, the DOM, or a frame |
| `frame` | Chromium, through playwright | `tests/frame/**` | the whole keystroke, reconciliation and commit included | first contentful paint |

Three tasks name those projects. None of them runs all three.

| Task | Projects | Where it runs |
| --- | --- | --- |
| `fe:test` | `unit`, `perf` | CI's Test job, and lefthook before a push |
| `fe:frame` | `frame` | CI's Perf job. Needs a Chromium install |
| `fe:bench` | `perf` | local only, and gates nothing |

`fe:test` names its projects rather than running everything, because CI's Test
job and lefthook install no browser. The Perf job installs one with
`playwright install chromium --with-deps` and runs `fe:frame` alone.

The `perf` project also carries `sequence: { groupOrder: 1 }`, which keeps it
out of the jsdom project's worker pool. Sharing one pool oversubscribes a
16-thread box and reads the same code 1.6x slower.

## What the gates assert

Each threshold is six times what the gate measures today: three for a real
regression, and two again for the runner being about half this machine's
speed. Three alone would leave 1.5x of headroom where the gate actually runs,
which one noisy minute turns red.

| Gate | File | Measures | Achieved | Threshold |
| --- | --- | ---: | ---: | ---: |
| `rankFolders`, empty query | `tests/perf/ranking.test.ts` | 10,000 paths, 842 folders | 5.40 ms | 32 ms |
| `rankFolders`, typed query | `tests/perf/ranking.test.ts` | the same, query `notes` | 7.88 ms | 47 ms |
| `rankFolderPrefixes`, empty query | `tests/perf/ranking.test.ts` | 842 prefixes already derived | 0.372 ms | 2.2 ms |
| the keystroke's commit | `tests/frame/note-prompt.test.tsx` | 10,000 notes in Chromium | 5.1 ms | 30 ms |
| rows mounted | `tests/frame/note-prompt.test.tsx` | options in the listbox | 20 | 20, exact |
| wasted editor renders | `tests/note-editor.test.tsx` | renders per keystroke burst | 0 | 0, exact |

The first two thresholds barely moved while the keystroke got three times
cheaper. `rankFolders` still walks every path in the vault to find its folders,
which is what it is for. The prompt stopped calling it once per keystroke and
calls `rankFolderPrefixes` instead, so the third row is the half a keystroke
now pays.

The 50,000-note measurements are logged and assert nothing.

The gated frame number is the synchronous commit, not a `requestAnimationFrame`
window. React flushes the change event synchronously, so when
`input.dispatchEvent` returns the new rows are already in the DOM and only the
paint is outstanding.

## Why the benchmark gates nothing

`vitest bench` cannot fail a build. It offers `--compare` and `--outputJson`,
no threshold flag, and no path to a non-zero exit. So the numbers and the
assertions split: `frontend/bench/*.bench.ts` records with tinybench's
statistics, and the test files above carry every threshold. Both read one
fixtures module.

`vitest bench` also fans out across projects. `benchmark.include` resolves per
project and ignores `test.include`, so an unpinned bench file runs once per
project and prints one benchmark under three labels. The config sets
`benchmark: { include: [] }` at the root and names the files under the `perf`
project only, and `fe:bench` passes `--project perf` on top.

Bench numbers are also not wired into CI. A shared runner is too noisy to be a
record, which is the same reason the gates are assertions rather than bench
comparisons.

## The synthetic vault

`frontend/bench/fixtures.ts` builds the vaults every harness measures.
`syntheticVault(n)` returns sorted paths and a folder count, deterministically,
so two runs on two machines compare.

| notes | folders |
| ---: | ---: |
| 500 | 50 |
| 2,000 | 176 |
| 10,000 | 842 |
| 50,000 | 4,176 |

The folder count is what the prompt's cost tracks, not the note count, so every
table below carries both. Folder names average 21 to 27 characters, the shape
of a real vault. That is load-bearing rather than cosmetic: scoring is linear
in candidate length, and an earlier generator with 8.6-character names put
every number about 1.7x low.

## Recorded numbers

### Ranking in node

Means from `mise run fe:bench`, in milliseconds. Margin of error at or under
1.1% except `buildTree` at 2,000 and 50,000 and `rank(typed)` at 50,000, where
it reaches 9.37%.

| notes | folders | rank(empty) | rank(typed) | describeNotePath | buildTree |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | 50 | 0.252 | 0.376 | 0.0045 | 0.237 |
| 2,000 | 176 | 1.011 | 1.482 | 0.0127 | 1.158 |
| 10,000 | 842 | 4.958 | 7.505 | 0.0802 | 8.737 |
| 50,000 | 4,176 | 25.868 | 40.954 | 0.4603 | 133.15 |

These means run below what the gates measure for the same code. A hot loop
amortises garbage collection across its iterations, and one keystroke pays for
it in full.

### The keystroke in Chromium

Medians of 15 keystrokes after 3 warmups, from `mise run fe:frame`. Each
keystroke is a distinct character, so no run times a render React bailed out
of.

| build | notes | folders | commit | options mounted |
| --- | ---: | ---: | ---: | ---: |
| as shipped | 10,000 | 842 | 16.8 ms | 842 |
| the list capped at 20 | 10,000 | 842 | 11.0 to 11.8 ms | 20 |
| capped, and folders derived once per vault | 10,000 | 842 | 4.8 to 5.2 ms | 20 |
| as shipped | 50,000 | 4,176 | 59.1 ms | 4,176 |
| the list capped at 20 | 50,000 | 4,176 | 24.0 to 25.2 ms | 20 |
| capped, and folders derived once per vault | 50,000 | 4,176 | 13.5 to 14.3 ms | 20 |

At 16.8 ms against a 16 ms frame, a third of keystrokes dropped a frame. Two
changes met the bar: the list mounts at most 20 rows, and the folder set is
derived from the paths once per vault rather than once per keystroke. Neither
clears the bar alone. Together they save 11.9 ms where they save 5.5 and 2.3
apart, because a garbage collection pass is charged to whichever half is
allocating when the nursery fills.

### The load side

Recorded, not gated, and nothing on this path was changed.

| measurement | value |
| --- | --- |
| `GET /api/files` at 10,000 notes | 155 to 161 ms |
| `buildTree` at 10,000 notes | 8.554 ms |
| time to the first tree row | 443 to 462 ms |
| time to the paint that carried it | 834 to 859 ms |
| rows mounted in the tree | 10,842 |
| first contentful paint | not obtainable, see below |

Two of those explain each other. The tree starts with nothing collapsed, so
10,000 notes means 10,842 buttons in one commit. React and the DOM are about
98% of the load cost, and `buildTree` is 2% of it despite being the largest
recorded pure function. The other half a cold open pays is the 158 ms request,
which walks 10,842 entries, sorts them and serialises 10,000 strings.

## What these numbers are not

**Every browser number is development-build React.** Vitest browser mode serves
through Vite in dev. Production reconciliation is materially cheaper, so 16.8 ms
is not what the deployed app costs. The figures are right to gate on, because
the gate runs identically every time, but nobody should quote them as
production numbers.

**First contentful paint is not obtainable here.** Chromium records paint
timing for the outermost frame only, and these tests run inside the vitest
runner's tester iframe, so there are zero paint entries. Timing the outer page
would measure vitest's own chrome. The commit and paint figures above stand in
for it.

**The two-rAF window measures the refresh rate, not the work.** Two animation
frames cannot resolve in under two refresh periods, about 33.3 ms at 60Hz, so
that number reads 33.3 ms however cheap the keystroke is and steps to about
50 ms once the work overruns its frame. It is logged as context and asserted on
by nothing. The commit figure is the gated one.

**An agent-driven run sees no logged numbers.** Vitest picks `MinimalReporter`
when `std-env` detects `CLAUDECODE`, `CLAUDE_CODE` or `AI_AGENT`, and that
reporter drops console output from passing tests. Pass `--reporter=default`, or
clear those variables, or the medians above will not appear.

## Related

* [mise tasks](/reference/mise-tasks.md) - what `fe:test`, `fe:frame` and `fe:bench` run
* [Editor keys](/reference/editor-keys.md) - the prompt's keys, and the capped list they move through
* [Run the checks](/how-to/run-the-checks.md) - which of these CI runs
