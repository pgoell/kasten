/**
 * A guard on what one keystroke pays to rank, in the prompt and in the finder.
 *
 * `mise run fe:bench` records the numbers; this file is what turns a regression
 * red. The thresholds are loose enough that a busy runner still passes and
 * tight enough that a change costing an order of magnitude cannot land
 * quietly. It is a regression gate, not the frame budget: `rankFolders` and
 * `rankNotes` both walk every path in the vault, which is more than a keystroke
 * pays now that each surface derives its candidates once and ranks the result.
 */

import { folderCandidates, noteCandidates, rankCandidates, rankFolders } from "@/lib/fuzzy";
import { syntheticVault } from "../../bench/fixtures";

/** The size the bar is set at. 842 folders, which is what the cost tracks. */
const NOTES = 10000;

/** The query `bench/ranking.bench.ts` records with. The recorded mean belongs
 * to this query and no other: a query matching fewer folders skips more of the
 * sort and the map, so it would quietly measure a different multiple. */
const QUERY = "notes";

// Every threshold below is six times a median measured on this machine, and
// six is two factors. Three carries a real regression, and two carries the
// runner: the gate runs on ubuntu-latest, which CI run 31029223471 timed at
// about 2.0x slower than this machine against the same jsdom files, the ratio
// landing between 1.94 and 2.17 across duration, tests, environment and setup.
// Three times a local median would therefore leave 1.5x of headroom where it
// actually gates, which one noisy minute turns red.
//
// These medians sit above the means `mise run fe:bench` records, because a hot
// loop amortises garbage collection across its iterations and a single call
// pays for it in full.
//
// All of them were re-measured on 2026-08-06, when one scorer replaced two and
// the finder started ranking notes through it. Three runs of
// `vitest run --project perf` read 4.609, 4.650 and 4.714ms for the empty query
// and 4.791, 4.659 and 4.793ms for the typed one. Both are down from the 5.40
// and 7.88 the old literals came from, and neither is where the change shows:
// these two still carry the derivation, which is the half a keystroke stopped
// paying long ago.
const EMPTY_LIMIT_MS = 28;
const TYPED_LIMIT_MS = 29;

// The half a keystroke in the prompt actually pays, and where the new scorer
// shows: 0.092ms median, from 0.090, 0.092 and 0.093, against the 0.372 the
// 2.2ms literal came from. Four times cheaper for having its lowercasing
// hoisted out and its rows reused.
const PREFIX_LIMIT_MS = 0.6;

/** The letter typed first, which is the dearest keystroke the finder answers. */
const WORST_QUERY = "a";

// The finder's three, measured the same day and the same way. Preparing the
// vault read 0.678, 0.683 and 0.687ms; the empty query 1.196, 1.207 and
// 1.208ms; one letter 3.680, 3.681 and 3.990ms; the typed query 3.465, 3.484
// and 3.550ms. One letter is the dearest because it rejects almost nothing, so
// nearly every note pays for the table.
const PREPARE_LIMIT_MS = 4.1;
const NOTES_EMPTY_LIMIT_MS = 7.2;
const NOTES_LETTER_LIMIT_MS = 22;
const NOTES_TYPED_LIMIT_MS = 21;

/** Median milliseconds of `runs` timed calls, after `warmup` untimed ones. */
function medianMs(fn: () => unknown, runs: number, warmup: number): number {
  for (let index = 0; index < warmup; index += 1) fn();

  const times: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  // A median rather than a mean, because one descheduled run would drag a mean
  // over the line while saying nothing about the code.
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] ?? 0;
}

describe(`rankFolders at ${NOTES} notes`, () => {
  const { paths } = syntheticVault(NOTES);

  it("ranks an empty query within six times its recorded cost", () => {
    const median = medianMs(() => rankFolders(paths, ""), 25, 5);

    console.log(`rankFolders, empty query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(EMPTY_LIMIT_MS);
  });

  it("ranks a typed query within six times its recorded cost", () => {
    const median = medianMs(() => rankFolders(paths, QUERY), 25, 5);

    console.log(`rankFolders, typed query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(TYPED_LIMIT_MS);
  });

  // The prompt derives the prefixes once per vault and ranks them once per
  // keystroke, so this is the half a keystroke actually pays. Gated apart from
  // `rankFolders` above, which still carries the derivation and would hide a
  // regression in either half behind the other.
  it("ranks derived prefixes within six times their recorded cost", () => {
    const folders = folderCandidates(paths);
    const median = medianMs(() => rankCandidates(folders, ""), 25, 5);

    console.log(`rankCandidates over folders, empty query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(PREFIX_LIMIT_MS);
  });
});

describe(`rankNotes at ${NOTES} notes`, () => {
  const { paths } = syntheticVault(NOTES);
  const notes = noteCandidates(paths);

  it("prepares the vault's notes within six times their recorded cost", () => {
    // Once per vault, not once per keystroke, which is the whole reason the
    // finder splits its two memos the way the prompt does.
    const median = medianMs(() => noteCandidates(paths), 25, 5);

    console.log(`noteCandidates: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(PREPARE_LIMIT_MS);
  });

  it("ranks an empty query within six times its recorded cost", () => {
    // What the finder opens with, and the one query that reaches the sort with
    // every note still in it.
    const median = medianMs(() => rankCandidates(notes, ""), 25, 5);

    console.log(`rankCandidates over notes, empty query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(NOTES_EMPTY_LIMIT_MS);
  });

  it("ranks the first letter typed within six times its recorded cost", () => {
    // The worst keystroke of the lot, and the reason it is gated apart. One
    // letter rejects almost nothing, so nearly every note pays for the table,
    // where a longer query throws most of the vault out on the cheap scan.
    const median = medianMs(() => rankCandidates(notes, WORST_QUERY), 25, 5);

    console.log(`rankCandidates over notes, one letter: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(NOTES_LETTER_LIMIT_MS);
  });

  it("ranks a typed query within six times its recorded cost", () => {
    const median = medianMs(() => rankCandidates(notes, QUERY), 25, 5);

    console.log(`rankCandidates over notes, typed query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(NOTES_TYPED_LIMIT_MS);
  });
});
