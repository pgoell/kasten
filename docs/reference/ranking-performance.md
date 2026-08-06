---
type: Reference
title: Ranking performance
description: The bar a keystroke in the note prompt and the note finder is held to, the harnesses that measure it, and every recorded number.
resource: frontend/tests/frame/note-finder.test.tsx
tags: [performance, benchmarks, frontend, testing]
status: stable
---

# Ranking performance

Two surfaces rank the vault as you type. The note prompt ranks every folder in
it, and the note finder ranks every note. Both rebuild a list under an input on
every keystroke, and both go through one scorer in `frontend/src/lib/fuzzy.ts`.
This page states the bar that work is held to, the three harnesses that measure
it, and the numbers each one recorded.

Every figure here comes from one machine, a 16-thread desktop. `ubuntu-latest`
is about 2.0x slower, which is why the gates carry the multiplier they do.

## The bar

| Surface | Bar | Gated |
| --- | --- | --- |
| Prompt keystroke at 10,000 notes | 16 ms end to end, about 4 ms of it JS | yes |
| Finder keystroke at 10,000 notes | 16 ms end to end, about 4 ms of it JS | yes |
| Either at 50,000 notes | under 100 ms end to end | no, recorded |
| Editor keystroke | no wasted re-renders, asserted as a count | yes, exact |
| `GET /api/files`, `buildTree`, load and first paint | none | no, recorded |

"End to end" counts the ranking, the path verdict where there is one, React's
reconciliation and the DOM commit. It does not count paint, for the reason under
[What these numbers are not](#what-these-numbers-are-not).

The finder is measured apart rather than assumed to cost what the prompt costs.
At 10,000 notes it ranks twelve times the candidates, 10,000 notes against 842
folders, and each candidate is longer.

## The harnesses

`frontend/vite.config.ts` splits the suite into three vitest projects. They
share the `@` alias and the synthetic vault, and nothing else.

| Project | Environment | Holds | Can measure | Cannot measure |
| --- | --- | --- | --- | --- |
| `unit` | jsdom | `tests/**`, minus the two below | behaviour, and how often a function is called | anything timed, since jsdom lays out nothing |
| `perf` | node | `tests/perf/**` and `bench/**` | pure functions, with little noise | React, the DOM, or a frame |
| `frame` | Chromium, through playwright | `tests/frame/**` | the whole keystroke, reconciliation and commit included | first contentful paint |

Both frame files log the surface they measure, `the prompt` or `the finder`,
because they print the same shape into the same run.

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
| `rankFolders`, empty query | `tests/perf/ranking.test.ts` | 10,000 paths, 842 folders | 4.650 ms | 28 ms |
| `rankFolders`, typed query | `tests/perf/ranking.test.ts` | the same, query `notes` | 4.791 ms | 29 ms |
| `rankCandidates` over folders | `tests/perf/ranking.test.ts` | 842 candidates already derived | 0.092 ms | 0.6 ms |
| `noteCandidates` | `tests/perf/ranking.test.ts` | preparing 10,000 notes | 0.683 ms | 4.1 ms |
| `rankCandidates` over notes, empty query | `tests/perf/ranking.test.ts` | 10,000 candidates already derived | 1.207 ms | 7.2 ms |
| `rankCandidates` over notes, one letter | `tests/perf/ranking.test.ts` | the same, query `a` | 3.681 ms | 22 ms |
| `rankCandidates` over notes, typed query | `tests/perf/ranking.test.ts` | the same, query `notes` | 3.484 ms | 21 ms |
| the prompt keystroke's commit | `tests/frame/note-prompt.test.tsx` | 10,000 notes in Chromium | 2.5 ms | 15 ms |
| the finder keystroke's commit | `tests/frame/note-finder.test.tsx` | 10,000 notes in Chromium | 6.7 ms | 40 ms |
| rows mounted, either surface | `tests/frame/*.test.tsx` | options in the listbox | 20 | 20, exact |
| wasted editor renders | `tests/note-editor.test.tsx` | renders per keystroke burst | 0 | 0, exact |

Read the rows in pairs. `rankFolders` and `rankNotes` each walk every path in
the vault to derive their candidates, which no keystroke pays: both surfaces
derive once per vault and call `rankCandidates` per keystroke. So rows three
through seven are what typing actually costs, and rows one and two are what
opening the list costs once.

The dearest keystroke the finder answers is the first letter typed, not a long
query. One letter rejects almost nothing, so nearly every note pays for the
scoring table, where a longer query throws most of the vault out on the cheap
subsequence scan that runs in front of it.

The 50,000-note measurements are logged and assert nothing. At that size the
finder's keystroke reads about 21 ms and does drop its frame.

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

The folder count is what the prompt's cost tracks and the note count is what the
finder's does, so every table below carries both. Names average 21 to 27
characters, the shape of a real vault. That is load-bearing rather than
cosmetic: scoring is linear in candidate length, and an earlier generator with
8.6-character names put every number about 1.7x low.

## Recorded numbers

### Ranking in node

Means from `mise run fe:bench`, in milliseconds, recorded 2026-08-06. Margin of
error at or under 1.3% except `noteCandidates`, which reaches 10.8% at every
size, and `rankFolders, empty query` at 500 notes, at 3.6%.

What a keystroke pays, both surfaces deriving their candidates once per vault:

| notes | folders | folders(empty) | notes(empty) | notes(letter) | notes(typed) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | 50 | 0.0049 | 0.060 | 0.177 | 0.177 |
| 2,000 | 176 | 0.0177 | 0.253 | 0.681 | 0.704 |
| 10,000 | 842 | 0.0878 | 1.263 | 3.421 | 3.378 |
| 50,000 | 4,176 | 0.4565 | 8.408 | 17.949 | 17.612 |

What opening a list pays, once per vault:

| notes | folders | folderCandidates | noteCandidates | describeNotePath | buildTree |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 500 | 50 | 0.229 | 0.056 | 0.0045 | 0.214 |
| 2,000 | 176 | 0.920 | 0.181 | 0.0131 | 0.968 |
| 10,000 | 842 | 4.515 | 0.890 | 0.0672 | 8.245 |
| 50,000 | 4,176 | 23.458 | 5.035 | 0.3626 | 144.58 |

Deriving the folders costs 51 times what ranking them does at 10,000 notes,
4.515 ms against 0.0878 ms, which is the whole reason each surface splits its
two memos the way it does. Notes are the other way round, 0.890 ms to prepare
against 1.263 ms to rank, because a note carries no deduplication and no set.

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

The prompt halved again when the finder arrived, without anything in the prompt
changing. One scorer now serves both surfaces, and it stopped building a
character array per candidate, stopped allocating a table row per query
character, and started rejecting a candidate the query does not read into before
the table is touched at all. Ranking 842 folders went from 0.372 ms to 0.092 ms.

| surface | notes | candidates | commit |
| --- | ---: | ---: | ---: |
| prompt | 10,000 | 842 folders | 2.5 ms |
| finder | 10,000 | 10,000 notes | 6.7 ms |
| prompt | 50,000 | 4,176 folders | 3.5 ms |
| finder | 50,000 | 50,000 notes | 21.0 ms |

The finder is the dearer of the two at every size, ranking every note where the
prompt ranks the folders on the way to one. It is inside the frame at 10,000
notes and outside it at 50,000, which is recorded and gated on nothing.

Ranking notes with the scorer as it stood before this work cost 156 ms for a
four-letter query at 10,000 notes, fourteen dropped frames per keystroke. That
number is why the scorer was rewritten rather than reused.

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
* [Editor keys](/reference/editor-keys.md) - the keys of both lists, and the cap they move through
* [Run the checks](/how-to/run-the-checks.md) - which of these CI runs
