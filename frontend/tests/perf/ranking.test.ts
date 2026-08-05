/**
 * A guard on what one keystroke in the note prompt pays to rank the folders.
 *
 * `mise run fe:bench` records the number; this file is what turns a regression
 * red. The thresholds are loose enough that a busy runner still passes and
 * tight enough that a change costing an order of magnitude cannot land
 * quietly. It is a regression gate, not the frame budget: the recorded means
 * already exceed the ~4ms of JS a keystroke is allowed, and closing that gap
 * is a later job.
 */

import { folderPrefixes, rankFolderPrefixes, rankFolders } from "@/lib/fuzzy";
import { syntheticVault } from "../../bench/fixtures";

/** The size the bar is set at. 842 folders, which is what the cost tracks. */
const NOTES = 10000;

/** The query `bench/ranking.bench.ts` records with. The recorded mean belongs
 * to this query and no other: a query matching fewer folders skips more of the
 * sort and the map, so it would quietly measure a different multiple. */
const QUERY = "notes";

// Six times the means `mise run fe:bench` recorded at 0da7f21 on this machine,
// 4.958ms for the empty query and 7.505ms for the typed one. Six rather than
// three because the gate runs on ubuntu-latest, and that runner is about 2.0x
// slower than this machine: CI run 31029223471 timed against the same 15 jsdom
// files here, and duration, tests, environment and setup all put the ratio
// between 1.94 and 2.17. So three times a local mean would leave only 1.4x of
// headroom where it actually gates, which one noisy minute turns red.
const EMPTY_LIMIT_MS = 30;
const TYPED_LIMIT_MS = 45;

// Six times the 0.33ms median this file measured on this machine once the
// derivation moved out of the keystroke: three runs read 0.321, 0.327 and
// 0.334. Six for the same two reasons as above, three for a real regression and
// two for ubuntu-latest being about half this machine's speed.
const PREFIX_LIMIT_MS = 2;

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
    const prefixes = folderPrefixes(paths);
    const median = medianMs(() => rankFolderPrefixes(prefixes, ""), 25, 5);

    console.log(`rankFolderPrefixes, empty query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(PREFIX_LIMIT_MS);
  });
});
