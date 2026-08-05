/**
 * A guard on what one keystroke in the note prompt pays to rank the folders.
 *
 * `mise run fe:bench` records the number; this file is what turns a regression
 * red. The thresholds sit at three times the recorded mean, which is loose
 * enough that a busy machine still passes and tight enough that a change
 * costing an order of magnitude cannot land quietly. It is a regression gate,
 * not the frame budget: the recorded means already exceed the ~4ms of JS a
 * keystroke is allowed, and closing that gap is a later job.
 */

import { rankFolders } from "@/lib/fuzzy";
import { syntheticVault } from "../../bench/fixtures";

/** The size the bar is set at. 842 folders, which is what the cost tracks. */
const NOTES = 10000;

/** The query `bench/ranking.bench.ts` records with. The recorded mean belongs
 * to this query and no other: a query matching fewer folders skips more of the
 * sort and the map, so it would quietly measure a different multiple. */
const QUERY = "notes";

// Three times the means `mise run fe:bench` recorded at 0da7f21 on this
// machine, 4.958ms for the empty query and 7.505ms for the typed one.
const EMPTY_LIMIT_MS = 15;
const TYPED_LIMIT_MS = 22;

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

  it("ranks an empty query within three times its recorded cost", () => {
    const median = medianMs(() => rankFolders(paths, ""), 25, 5);

    console.log(`rankFolders, empty query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(EMPTY_LIMIT_MS);
  });

  it("ranks a typed query within three times its recorded cost", () => {
    const median = medianMs(() => rankFolders(paths, QUERY), 25, 5);

    console.log(`rankFolders, typed query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(TYPED_LIMIT_MS);
  });
});
